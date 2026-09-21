import { BUILDINGS } from '@shared/data/buildings';
import { RESOURCES } from '@shared/data/items';
import { CAMP, CYCLE, MAP_SIZE, MAP_TILES, TILE } from '@shared/sim/constants';
import { clamp } from '@shared/sim/math';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import type { Belt, BuildingId, Direction, Machine, MachineId, Vec2, World } from '@shared/sim/types';
import { Camera } from './camera';
import { Effects } from './effects';
import {
  drawBuilding,
  drawCampRing,
  drawMob,
  drawPickup,
  drawPlayer,
  drawNode,
  drawPlayerSilhouette,
  drawProjectile,
} from './entities';
import { UI, rgba } from './palette';
import { bakeTerrain } from './terrain';
import { polygon } from './shapes';
import { drawBelt, drawBeltItems, drawMachine } from './factory';
import { dirAngle, tileCenter, tileKey } from '@shared/sim/grid';

/** Anything that needs depth sorting, collected once per frame. */
interface Drawable {
  y: number;
  draw: () => void;
}

export class Renderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  private baked: HTMLCanvasElement | null = null;
  private bakedSeed = -1;
  /** Factory pieces on screen, gathered once a frame and reused across passes. */
  private visibleBelts: Belt[] = [];
  private visibleMachines: Machine[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.camera.width = w;
    this.camera.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Zoom with viewport so a phone shows a sensible slice of the island.
    this.camera.zoom = clamp(Math.min(w, h) / 560, 1.15, 2.4);
  }

  /**
   * `alpha` is the fraction of a tick elapsed; entity positions are already
   * interpolated by the caller, so this only drives cosmetic animation.
   */
  render(world: World, selfId: number, time: number, ghost: GhostPreview | null): void {
    if (this.bakedSeed !== world.seed) {
      this.baked = bakeTerrain(world.terrain, world.ore, world.seed);
      this.bakedSeed = world.seed;
    }

    const ctx = this.ctx;
    const { width, height } = this.camera;

    ctx.save();
    ctx.fillStyle = '#12232e';
    ctx.fillRect(0, 0, width, height);

    const shakeX = (Math.random() - 0.5) * this.effects.shake;
    const shakeY = (Math.random() - 0.5) * this.effects.shake;
    this.camera.apply(ctx, shakeX, shakeY);

    const view = this.camera.bounds();
    const visible = (p: Vec2, pad = 0): boolean =>
      p.x >= view.minX - pad && p.x <= view.maxX + pad && p.y >= view.minY - pad && p.y <= view.maxY + pad;

    this.collectFactory(world, view);

    // Ore is part of the baked island now, so this one blit is the ground.
    if (this.baked) ctx.drawImage(this.baked, 0, 0);
    this.drawWaterShimmer(world, time, view);
    for (const belt of this.visibleBelts) drawBelt(ctx, belt, time);
    drawCampRing(ctx, world, CAMP.buildRadius);
    // Build mode snaps to tiles, so the tiles have to be visible while it is on.
    if (ghost) this.drawBuildGrid(view);

    const layers: Drawable[] = [];

    for (const machine of this.visibleMachines) {
      const pos = tileCenter(machine.tx, machine.ty);
      layers.push({ y: pos.y, draw: () => drawMachine(ctx, machine, time) });
    }

    for (const node of world.nodes) {
      if (!visible(node.pos, 60)) continue;
      layers.push({ y: node.pos.y, draw: () => drawNode(ctx, node, time) });
    }
    for (const building of world.buildings) {
      if (!visible(building.pos, 60)) continue;
      layers.push({ y: building.pos.y, draw: () => drawBuilding(ctx, building, time) });
    }
    for (const mob of world.mobs) {
      if (!visible(mob.pos, 60)) continue;
      layers.push({ y: mob.pos.y, draw: () => drawMob(ctx, mob, time) });
    }
    for (const player of world.players.values()) {
      if (!visible(player.pos, 60)) continue;
      layers.push({ y: player.pos.y, draw: () => drawPlayer(ctx, player, time, player.id === selfId) });
    }

    // Painter's algorithm on Y — the whole reason the scene reads as 3/4 view.
    layers.sort((a, b) => a.y - b.y);
    for (const layer of layers) layer.draw();

    for (const belt of this.visibleBelts) drawBeltItems(ctx, belt);

    for (const pickup of world.pickups) {
      if (visible(pickup.pos, 30)) drawPickup(ctx, pickup, time);
    }
    for (const projectile of world.projectiles) {
      if (visible(projectile.pos, 30)) drawProjectile(ctx, projectile);
    }

    this.drawOccludedSelf(world, selfId);
    this.drawGatherHint(world, selfId);
    if (ghost) this.drawGhost(world, ghost);

    this.effects.draw(ctx);
    ctx.restore();

    this.drawLighting(world, selfId, time);
  }

  /**
   * Belts and machines on screen, read out of the occupancy grid rather than by
   * scanning the factory. Walking the world's arrays costs what has ever been
   * built; walking the visible tiles costs what fits on the screen, which is
   * what stops a big base from being slower to look at than a small one.
   */
  private collectFactory(
    world: World,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const belts = this.visibleBelts;
    const machines = this.visibleMachines;
    belts.length = 0;
    machines.length = 0;
    if (world.grid.size === 0) return;

    // A tile's art can overhang its own bounds, so take a tile of margin.
    const tx0 = Math.max(0, Math.floor(view.minX / TILE) - 1);
    const ty0 = Math.max(0, Math.floor(view.minY / TILE) - 1);
    const tx1 = Math.min(MAP_TILES - 1, Math.floor(view.maxX / TILE) + 1);
    const ty1 = Math.min(MAP_TILES - 1, Math.floor(view.maxY / TILE) + 1);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const entity = world.grid.get(tileKey(tx, ty));
        if (entity === undefined) continue;
        if ('items' in entity) belts.push(entity);
        else machines.push(entity);
      }
    }
  }

  /** Animated highlights over baked water, so the sea is not a flat plate. */
  private drawWaterShimmer(
    world: World,
    time: number,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const ctx = this.ctx;
    const tx0 = Math.max(0, Math.floor(view.minX / TILE));
    const ty0 = Math.max(0, Math.floor(view.minY / TILE));
    const tx1 = Math.min(MAP_SIZE / TILE - 1, Math.ceil(view.maxX / TILE));
    const ty1 = Math.min(MAP_SIZE / TILE - 1, Math.ceil(view.maxY / TILE));

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#cfeaf7';
    ctx.lineWidth = 2;
    // Every highlight is the same colour and width, so they are one path and
    // one stroke. Stroking each separately was the single most expensive thing
    // the renderer did, on an empty island as much as on a built one.
    ctx.beginPath();
    for (let ty = ty0; ty <= ty1; ty += 2) {
      for (let tx = tx0; tx <= tx1; tx += 2) {
        const kind = TERRAIN_ORDER[world.terrain[ty * (MAP_SIZE / TILE) + tx]];
        if (kind !== 'water' && kind !== 'deep') continue;
        const phase = Math.sin(time * 1.2 + tx * 0.7 + ty * 0.4);
        if (phase < 0.3) continue;
        const x = tx * TILE + TILE * 0.5;
        const y = ty * TILE + TILE * 0.5;
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Trees and buildings that sort in front of the player can swallow them whole.
   * Anything rooted just below the player with overlapping canopy counts.
   */
  private drawOccludedSelf(world: World, selfId: number): void {
    const player = world.players.get(selfId);
    if (!player || player.downed > 0) return;

    const occluded =
      world.nodes.some(
        (n) =>
          n.charges > 0 &&
          n.kind === 'tree' &&
          n.pos.y > player.pos.y &&
          n.pos.y - player.pos.y < 46 &&
          Math.abs(n.pos.x - player.pos.x) < 26,
      ) ||
      world.buildings.some(
        (b) =>
          b.pos.y > player.pos.y &&
          b.pos.y - player.pos.y < 34 &&
          Math.abs(b.pos.x - player.pos.x) < 24,
      );

    if (occluded) drawPlayerSilhouette(this.ctx, player);
  }

  private drawGatherHint(world: World, selfId: number): void {
    const player = world.players.get(selfId);
    if (!player || player.gatherNodeId === null) return;
    const node = world.nodes.find((n) => n.id === player.gatherNodeId);
    if (!node) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = rgba(UI.gold, 0.6);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(node.pos.x, node.pos.y, RESOURCES[node.kind].radius + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The tile lattice, drawn only in build mode. Placement has always snapped
   * to it, but with nothing on screen to line a belt run up against it read
   * as though it did not.
   */
  private drawBuildGrid(view: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const ctx = this.ctx;
    const x0 = Math.max(0, Math.floor(view.minX / TILE));
    const x1 = Math.min(MAP_TILES, Math.ceil(view.maxX / TILE));
    const y0 = Math.max(0, Math.floor(view.minY / TILE));
    const y1 = Math.min(MAP_TILES, Math.ceil(view.maxY / TILE));
    if (x1 <= x0 || y1 <= y0) return;

    ctx.save();
    ctx.strokeStyle = rgba(UI.ink, 0.13);
    // A hairline whatever the zoom, so the grid never fights the art.
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.beginPath();
    for (let tx = x0; tx <= x1; tx++) {
      ctx.moveTo(tx * TILE, y0 * TILE);
      ctx.lineTo(tx * TILE, y1 * TILE);
    }
    for (let ty = y0; ty <= y1; ty++) {
      ctx.moveTo(x0 * TILE, ty * TILE);
      ctx.lineTo(x1 * TILE, ty * TILE);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawGhost(world: World, ghost: GhostPreview): void {
    const ctx = this.ctx;
    const tint = ghost.valid ? UI.good : UI.danger;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = rgba(tint, 0.42);
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2;

    if (ghost.kind === 'building') {
      polygon(ctx, ghost.pos.x, ghost.pos.y, BUILDINGS[ghost.type].radius, 6, 5, 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // The build radius only matters for camp pieces, so only show it then.
      drawCampRing(ctx, world, CAMP.buildRadius);
      return;
    }

    const { x, y } = tileCenter(ghost.tx, ghost.ty);
    ctx.beginPath();
    ctx.roundRect(x - TILE / 2 + 2, y - TILE / 2 + 2, TILE - 4, TILE - 4, 4);
    ctx.fill();
    ctx.stroke();

    // An arrow on the ghost so facing is obvious before anything is committed.
    ctx.translate(x, y);
    ctx.rotate(dirAngle(ghost.dir));
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.moveTo(TILE * 0.3, 0);
    ctx.lineTo(TILE * 0.06, -TILE * 0.17);
    ctx.lineTo(TILE * 0.06, TILE * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Night is a dark multiply layer punched through by warm radial lights from
   * the campfire, lamps and each player — cheap, and it makes camp feel safe.
   */
  private drawLighting(world: World, selfId: number, time: number): void {
    const darkness = nightDarkness(world);
    if (darkness <= 0.01) return;

    const ctx = this.ctx;
    const { width, height } = this.camera;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(12, 18, 38, ${darkness * 0.72})`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';
    const addLight = (world_pos: Vec2, radius: number, strength: number, color: string): void => {
      const sx = (world_pos.x - this.camera.pos.x) * this.camera.zoom + width / 2;
      const sy = (world_pos.y - this.camera.pos.y) * this.camera.zoom + height / 2;
      const r = radius * this.camera.zoom;
      if (sx < -r || sy < -r || sx > width + r || sy > height + r) return;
      const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      gradient.addColorStop(0, rgba(color, strength * darkness));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    };

    const flicker = 1 + Math.sin(time * 8) * 0.06;
    for (const building of world.buildings) {
      if (building.type === 'campfire') addLight(building.pos, 230 * flicker, 0.5, '#ffb960');
      else if (building.type === 'lamp') addLight(building.pos, 130 * flicker, 0.42, '#ffd98a');
    }
    for (const player of world.players.values()) {
      addLight(player.pos, 150, player.id === selfId ? 0.34 : 0.22, '#bcd8ff');
    }
    ctx.restore();
  }
}

/**
 * Camp decoration is placed freely at a world position; factory pieces snap to
 * a tile and carry a facing, so the preview has to describe both cases.
 */
export type GhostPreview =
  | { kind: 'building'; type: BuildingId; pos: Vec2; valid: boolean }
  | {
      kind: 'grid';
      what: MachineId | 'belt';
      tx: number;
      ty: number;
      dir: Direction;
      valid: boolean;
    };

/** 0 at full day, 1 at deep night, eased across the twilight windows. */
export function nightDarkness(world: World): number {
  const { twilightSeconds } = CYCLE;
  if (world.phase === 'day') {
    // Dusk creeps in over the last stretch of the day.
    const into = CYCLE.daySeconds - world.phaseTime;
    if (world.phaseTime < twilightSeconds) return 1 - world.phaseTime / twilightSeconds;
    if (into < twilightSeconds) return 1 - into / twilightSeconds;
    return 0;
  }
  if (world.phaseTime < twilightSeconds) return world.phaseTime / twilightSeconds;
  const into = CYCLE.nightSeconds - world.phaseTime;
  if (into < twilightSeconds) return into / twilightSeconds;
  return 1;
}
