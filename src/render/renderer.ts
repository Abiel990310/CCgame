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
import { GroundMesh } from './terrain';
import { setItemScale } from './items';
import { polygon } from './shapes';
import { drawBelt, drawBeltAt, drawBeltItems, drawMachine, previewMachine, setFactoryScale } from './factory';
import { dirAngle, tileCenter, tileKey } from '@shared/sim/grid';

/** How far past the viewport the pre-scaled ground reaches, in device pixels. */
const GROUND_MARGIN = 320;

/** Anything that needs depth sorting, collected once per frame. */
interface Drawable {
  y: number;
  draw: () => void;
}

export class Renderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  private mesh: GroundMesh | null = null;
  private dpr = 1;
  /**
   * The island, pre-scaled to the zoom it is actually shown at, covering the
   * viewport plus a margin. Redrawn only when the camera walks off the edge of
   * it, so the common frame blits it one-to-one instead of painting the mesh
   * every time.
   */
  private ground: HTMLCanvasElement | null = null;
  private groundCtx: CanvasRenderingContext2D | null = null;
  private groundX = 0;
  private groundY = 0;
  private groundScale = 0;
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
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Zoom with viewport so a phone shows a sensible slice of the island.
    this.camera.zoom = clamp(Math.min(w, h) / 560, 1.15, 2.4);
  }

  /**
   * `alpha` is the fraction of a tick elapsed; entity positions are already
   * interpolated by the caller, so this only drives cosmetic animation.
   */
  render(
    world: World,
    selfId: number,
    time: number,
    ghost: GhostPreview | null,
    removal: RemovalPreview | null = null,
  ): void {
    const ctx = this.ctx;
    const { width, height } = this.camera;

    ctx.save();
    ctx.fillStyle = '#12232e';
    ctx.fillRect(0, 0, width, height);

    const shakeX = (Math.random() - 0.5) * this.effects.shake;
    const shakeY = (Math.random() - 0.5) * this.effects.shake;

    // The camera transform is built here rather than by `camera.apply` so the
    // translation can be snapped to a whole device pixel. A fractional offset
    // makes every blit resample; snapping the whole scene together keeps the
    // ground and the things standing on it locked to each other.
    const scale = this.camera.zoom * this.dpr;
    const originX = Math.round((width / 2 + shakeX) * this.dpr - this.camera.pos.x * scale);
    const originY = Math.round((height / 2 + shakeY) * this.dpr - this.camera.pos.y * scale);

    this.ensureGround(world);
    if (this.ground) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(
        this.ground,
        originX + this.groundX * this.groundScale,
        originY + this.groundY * this.groundScale,
      );
    }
    ctx.setTransform(scale, 0, 0, scale, originX, originY);
    setItemScale(scale);
    setFactoryScale(scale);

    const view = this.camera.bounds();
    const visible = (p: Vec2, pad = 0): boolean =>
      p.x >= view.minX - pad && p.x <= view.maxX + pad && p.y >= view.minY - pad && p.y <= view.maxY + pad;

    this.collectFactory(world, view);

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
    // The ghost over an occupied tile is red because of the very thing the
    // removal outline is showing, so only one of the two is drawn.
    const covered =
      removal?.kind === 'grid' &&
      ghost?.kind === 'grid' &&
      removal.tx === ghost.tx &&
      removal.ty === ghost.ty;
    if (ghost && !covered) this.drawGhost(world, ghost, time);
    if (removal) this.drawRemoval(removal);

    this.effects.draw(ctx);
    ctx.restore();

    this.drawLighting(world, selfId, time);
  }

  /**
   * Keep the pre-scaled ground covering the view. With a margin this wide the
   * cache only runs out about once a second while walking, and when it does it
   * scrolls and paints the strip that came in rather than the whole thing.
   */
  private ensureGround(world: World): void {
    if (this.mesh === null || this.mesh.seed !== world.seed) {
      this.mesh = new GroundMesh(world.seed);
    }

    const scale = this.camera.zoom * this.dpr;
    const w = Math.ceil(this.camera.width * this.dpr) + GROUND_MARGIN * 2;
    const h = Math.ceil(this.camera.height * this.dpr) + GROUND_MARGIN * 2;

    if (!this.ground || this.ground.width !== w || this.ground.height !== h) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      this.ground = canvas;
      this.groundCtx = canvas.getContext('2d', { alpha: false });
      this.groundScale = 0;
    }
    const ctx = this.groundCtx;
    if (!ctx) return;

    const coverW = w / scale;
    const coverH = h / scale;
    const halfW = this.camera.width / 2 / this.camera.zoom;
    const halfH = this.camera.height / 2 / this.camera.zoom;
    if (
      this.groundScale === scale &&
      this.camera.pos.x - halfW >= this.groundX &&
      this.camera.pos.x + halfW <= this.groundX + coverW &&
      this.camera.pos.y - halfH >= this.groundY &&
      this.camera.pos.y + halfH <= this.groundY + coverH
    ) {
      return;
    }

    const prevX = this.groundX;
    const prevY = this.groundY;
    const sameScale = this.groundScale === scale;

    // Land the cache's own origin on a whole device pixel, so blitting it is a
    // straight copy rather than a resample.
    this.groundX = Math.round((this.camera.pos.x - coverW / 2) * scale) / scale;
    this.groundY = Math.round((this.camera.pos.y - coverH / 2) * scale) / scale;
    this.groundScale = scale;

    const dx = Math.round((prevX - this.groundX) * scale);
    const dy = Math.round((prevY - this.groundY) * scale);

    // Walking shifts the cache by a fraction of its own size, so slide what is
    // still good and paint only the edges that have come into view. Zooming
    // changes every pixel of it, and that is the case that repaints the lot.
    if (sameScale && Math.abs(dx) < w && Math.abs(dy) < h) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(ctx.canvas, dx, dy);
      if (dx !== 0) this.paintGround(world, dx > 0 ? 0 : w + dx, 0, Math.abs(dx), h);
      if (dy !== 0) {
        this.paintGround(world, dx > 0 ? dx : 0, dy > 0 ? 0 : h + dy, w - Math.abs(dx), Math.abs(dy));
      }
      return;
    }

    this.paintGround(world, 0, 0, w, h);
  }

  /**
   * Repaint one rectangle of the ground cache, given in its own device pixels.
   * The clip is what makes a partial repaint safe: the mesh reaches a tile past
   * whatever it is asked for, and shore foam and ore are drawn with alpha, so
   * letting it spill onto cache that is already right would darken it twice.
   */
  private paintGround(world: World, x: number, y: number, w: number, h: number): void {
    const ctx = this.groundCtx;
    if (!ctx || !this.mesh || w <= 0 || h <= 0) return;
    const scale = this.groundScale;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#12232e';
    ctx.fillRect(x, y, w, h);
    ctx.setTransform(scale, 0, 0, scale, -this.groundX * scale, -this.groundY * scale);
    this.mesh.paint(ctx, world.terrain, world.ore, {
      x: this.groundX + x / scale,
      y: this.groundY + y / scale,
      w: w / scale,
      h: h / scale,
    });
    ctx.restore();
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

  /** Animated highlights over the painted water, so the sea is not a flat plate. */
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

  private drawGhost(world: World, ghost: GhostPreview, time: number): void {
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
    ctx.roundRect(x - TILE / 2 + 1, y - TILE / 2 + 1, TILE - 2, TILE - 2, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();

    // The piece itself, half there, so what lands is what was previewed —
    // facing, output port and all.
    ctx.globalAlpha = 0.62;
    if (ghost.what === 'belt') drawBeltAt(ctx, x, y, ghost.dir, time);
    else drawMachine(ctx, previewMachine(ghost.what, ghost.tx, ghost.ty, ghost.dir), time);
    ctx.globalAlpha = 1;

    // An arrow beyond the tile so facing is obvious before anything is committed.
    ctx.translate(x, y);
    ctx.rotate(dirAngle(ghost.dir));
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.moveTo(TILE * 0.78, 0);
    ctx.lineTo(TILE * 0.6, -TILE * 0.14);
    ctx.lineTo(TILE * 0.6, TILE * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * What `X` or right-click is about to take. A dashed outline and a cross, in
   * the danger tint — distinct from the ghost, which is a solid translucent fill
   * and says where a new piece would land.
   */
  private drawRemoval(removal: RemovalPreview): void {
    const ctx = this.ctx;
    // A piece that cannot be taken down says so by being drawn in neither tint.
    const tint = removal.fixed ? UI.inkDim : UI.danger;

    ctx.save();
    ctx.strokeStyle = tint;
    ctx.fillStyle = rgba(tint, 0.14);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);

    let x: number;
    let y: number;
    if (removal.kind === 'grid') {
      const center = tileCenter(removal.tx, removal.ty);
      x = center.x;
      y = center.y;
      ctx.beginPath();
      ctx.roundRect(x - TILE / 2 + 1, y - TILE / 2 + 1, TILE - 2, TILE - 2, 5);
    } else {
      x = removal.pos.x;
      y = removal.pos.y;
      ctx.beginPath();
      ctx.arc(x, y, removal.radius + 5, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    if (!removal.fixed) {
      // A small cross above the piece, so the art underneath stays readable.
      const reach = 4;
      const top = removal.kind === 'grid' ? y - TILE / 2 - 5 : y - removal.radius - 10;
      ctx.setLineDash([]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - reach, top - reach);
      ctx.lineTo(x + reach, top + reach);
      ctx.moveTo(x + reach, top - reach);
      ctx.lineTo(x - reach, top + reach);
      ctx.stroke();
    }
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

/**
 * What removal is pointing at. Factory pieces are a tile; camp pieces are a
 * radius around a point, and the campfire is the one that will refuse.
 */
export type RemovalPreview =
  | { kind: 'grid'; tx: number; ty: number; fixed: boolean }
  | { kind: 'building'; pos: Vec2; radius: number; fixed: boolean };

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
