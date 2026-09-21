import { BUILDINGS } from '@shared/data/buildings';
import { RESOURCES } from '@shared/data/items';
import { CAMP, CYCLE, MAP_SIZE, TILE } from '@shared/sim/constants';
import { clamp } from '@shared/sim/math';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import type { BuildingId, Vec2, World } from '@shared/sim/types';
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
      this.baked = bakeTerrain(world.terrain, world.seed);
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

    if (this.baked) ctx.drawImage(this.baked, 0, 0);
    this.drawWaterShimmer(world, time, view);
    drawCampRing(ctx, world, CAMP.buildRadius);

    const layers: Drawable[] = [];

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
    for (let ty = ty0; ty <= ty1; ty += 2) {
      for (let tx = tx0; tx <= tx1; tx += 2) {
        const kind = TERRAIN_ORDER[world.terrain[ty * (MAP_SIZE / TILE) + tx]];
        if (kind !== 'water' && kind !== 'deep') continue;
        const phase = Math.sin(time * 1.2 + tx * 0.7 + ty * 0.4);
        if (phase < 0.3) continue;
        const x = tx * TILE + TILE * 0.5;
        const y = ty * TILE + TILE * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.stroke();
      }
    }
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

  private drawGhost(world: World, ghost: GhostPreview): void {
    const ctx = this.ctx;
    const def = BUILDINGS[ghost.type];
    ctx.save();
    ctx.globalAlpha = 0.55;
    polygon(ctx, ghost.pos.x, ghost.pos.y, def.radius, 6, 5, 0.1);
    ctx.fillStyle = ghost.valid ? rgba(UI.good, 0.45) : rgba(UI.danger, 0.45);
    ctx.fill();
    ctx.strokeStyle = ghost.valid ? UI.good : UI.danger;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Show the build radius only while actually placing something.
    drawCampRing(ctx, world, CAMP.buildRadius);
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

export interface GhostPreview {
  type: BuildingId;
  pos: Vec2;
  valid: boolean;
}

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
