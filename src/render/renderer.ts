import { BUILDINGS } from '@shared/data/buildings';
import { drawNameTags } from './nametags';
import { RESOURCES } from '@shared/data/items';
import { CAMP, CYCLE, MAP_SIZE, MAP_TILES, TILE } from '@shared/sim/constants';
import { clamp } from '@shared/sim/math';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import type {
  Belt,
  BuildingId,
  Direction,
  Machine,
  MachineId,
  Player,
  SimEvent,
  Vec2,
  World,
} from '@shared/sim/types';
import { Camera } from './camera';
import { Effects } from './effects';
import {
  drawBuilding,
  drawCampRing,
  drawMob,
  drawMobGlow,
  drawPickup,
  drawPlayer,
  drawNode,
  drawPlayerSilhouette,
  drawProjectile,
  type Tool,
} from './entities';
import { UI, rgba } from './palette';
import { GroundCache } from './groundcache';
import { setItemScale } from './items';
import { setPaintScale } from './paint';
import { polygon } from './shapes';
import { drawBelt, drawBeltAt, drawBeltItems, drawMachine, previewMachine, setFactoryScale } from './factory';
import { drawPowerCoverage, drawPowerWires } from './power';
import { dirAngle, tileCenter, tileKey } from '@shared/sim/grid';

/** How much coarser than the screen, in CSS pixels, the night's lights are gathered. */
const LIGHT_DOWNSCALE = 4;

/** Anything that needs depth sorting, collected once per frame. */
interface Drawable {
  y: number;
  draw: () => void;
}

export class Renderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  private ctx: CanvasRenderingContext2D;
  private ground = new GroundCache();
  private dpr = 1;
  /** Factory pieces on screen, gathered once a frame and reused across passes. */
  private visibleBelts: Belt[] = [];
  private visibleMachines: Machine[] = [];
  /**
   * The night layers stacked over the stage, where the browser supports
   * adding one layer onto another; see the constructor. Without them the night
   * is painted into the stage canvas as before.
   */
  private night: {
    dark: HTMLDivElement;
    lights: HTMLCanvasElement;
    lightsCtx: CanvasRenderingContext2D | null;
    /** Eyes glow onto the night; name tags sit plainly over it. */
    eyes: Overlay;
    tags: Overlay;
    /** The dark sheet's colour as last set, so the style is only touched on change. */
    shade: string;
  } | null = null;
  /** The night's lights, gathered at low resolution; see `drawLighting`. */
  private lights: HTMLCanvasElement | null = null;
  private lightsCtx: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    // Night is laid over the scene by the browser's compositor rather than
    // painted into it: a flat dark sheet, then the low-resolution light map
    // stretched over everything and added on. Painting both into the canvas
    // was a full-screen blend and a full-screen stretch every night frame.
    if (typeof CSS !== 'undefined' && CSS.supports('mix-blend-mode', 'plus-lighter')) {
      const dark = document.createElement('div');
      const lights = document.createElement('canvas');
      const eyes = new Overlay('plus-lighter');
      const tags = new Overlay('normal');
      for (const el of [dark, lights]) {
        Object.assign(el.style, {
          position: 'fixed',
          inset: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          display: 'none',
        });
      }
      lights.style.mixBlendMode = 'plus-lighter';
      canvas.after(dark, lights, eyes.canvas, tags.canvas);
      this.night = { dark, lights, lightsCtx: lights.getContext('2d'), eyes, tags, shade: '' };
    }
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
    if (this.night) {
      this.night.eyes.resize(this.canvas.width, this.canvas.height);
      this.night.tags.resize(this.canvas.width, this.canvas.height);
    }
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

    const view = this.camera.bounds();
    this.ground.draw(ctx, world, view, scale, originX, originY);
    ctx.setTransform(scale, 0, 0, scale, originX, originY);
    setItemScale(scale);
    setFactoryScale(scale);
    setPaintScale(scale);

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
      const tool = toolFor(world, player);
      layers.push({ y: player.pos.y, draw: () => drawPlayer(ctx, player, time, player.id === selfId, tool) });
    }

    // Painter's algorithm on Y — the whole reason the scene reads as 3/4 view.
    layers.sort((a, b) => a.y - b.y);
    for (const layer of layers) layer.draw();
    // Wires hang above everything standing on the ground, so they go last.
    drawPowerWires(ctx, world, view);

    for (const belt of this.visibleBelts) drawBeltItems(ctx, belt);

    for (const pickup of world.pickups) {
      if (visible(pickup.pos, 30)) drawPickup(ctx, pickup, time);
    }
    for (const projectile of world.projectiles) {
      if (visible(projectile.pos, 30)) drawProjectile(ctx, projectile);
    }

    this.drawOccludedSelf(world, selfId, time);
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

    // Names and eyes stay visible after dark, so they go over the night.
    const darkness = nightDarkness(world);
    const night = this.night;
    const names = world.players.size > 1;
    const tags = night ? night.tags.begin(names) : ctx;
    if (names && tags) {
      tags.save();
      tags.setTransform(scale, 0, 0, scale, originX, originY);
      drawNameTags(tags, world, selfId, visible);
      tags.restore();
    }

    // Eyes in the dark: drawn over the night layer so a raid gives itself away.
    const glowing = darkness > 0.05 && world.mobs.length > 0;
    const eyes = night ? night.eyes.begin(glowing) : ctx;
    if (glowing && eyes) {
      eyes.save();
      eyes.setTransform(scale, 0, 0, scale, originX, originY);
      eyes.globalCompositeOperation = 'lighter';
      for (const mob of world.mobs) {
        if (visible(mob.pos, 60)) drawMobGlow(eyes, mob, time, darkness);
      }
      eyes.restore();
    }
  }

  /** Take the ore changes the simulation reported; the ground cache repaints what they touch. */
  noteEvents(events: SimEvent[]): void {
    for (const event of events) {
      if (event.kind === 'oreChanged') this.ground.oreChanged(event.tx, event.ty);
    }
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
  private drawOccludedSelf(world: World, selfId: number, time: number): void {
    const player = world.players.get(selfId);
    if (!player || player.downed > 0) return;

    const occluded =
      world.nodes.some(
        (n) =>
          n.charges > 0 &&
          n.kind === 'tree' &&
          n.pos.y > player.pos.y &&
          n.pos.y - player.pos.y < 62 &&
          Math.abs(n.pos.x - player.pos.x) < 28,
      ) ||
      world.buildings.some(
        (b) =>
          b.pos.y > player.pos.y &&
          b.pos.y - player.pos.y < 34 &&
          Math.abs(b.pos.x - player.pos.x) < 24,
      );

    if (occluded) drawPlayerSilhouette(this.ctx, player, time, toolFor(world, player));
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

    if (ghost.what !== 'belt') drawPowerCoverage(ctx, world, ghost.what, ghost);

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
    const night = this.night;
    if (darkness <= 0.01) {
      if (night && night.shade !== '') {
        night.shade = '';
        night.dark.style.display = 'none';
        night.lights.style.display = 'none';
      }
      return;
    }

    const ctx = this.ctx;
    const { width, height } = this.camera;

    const shade = `rgba(12, 18, 38, ${(darkness * 0.72).toFixed(3)})`;
    if (night) {
      if (night.shade !== shade) {
        if (night.shade === '') {
          night.dark.style.display = 'block';
          night.lights.style.display = 'block';
        }
        night.shade = shade;
        night.dark.style.backgroundColor = shade;
      }
    } else {
      ctx.save();
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // The lights are soft by nature, so they are gathered at a quarter of the
    // screen's resolution and stretched over it. Filling each one's gradient
    // across the full screen was most of a night frame in a camp with a few
    // lamps.
    const lw = Math.max(1, Math.ceil(width / LIGHT_DOWNSCALE));
    const lh = Math.max(1, Math.ceil(height / LIGHT_DOWNSCALE));
    if (night) {
      this.lights = night.lights;
      this.lightsCtx = night.lightsCtx;
    } else if (!this.lights) {
      this.lights = document.createElement('canvas');
      this.lightsCtx = this.lights.getContext('2d');
    }
    const lights = this.lights;
    const lc = this.lightsCtx;
    if (!lights || !lc) return;
    if (lights.width !== lw || lights.height !== lh) {
      lights.width = lw;
      lights.height = lh;
      // Stretched by exactly the downscale, so a light sits where it was drawn.
      if (night) {
        lights.style.width = `${lw * LIGHT_DOWNSCALE}px`;
        lights.style.height = `${lh * LIGHT_DOWNSCALE}px`;
      }
    }
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, lw, lh);
    lc.setTransform(1 / LIGHT_DOWNSCALE, 0, 0, 1 / LIGHT_DOWNSCALE, 0, 0);
    lc.globalCompositeOperation = 'lighter';

    // Only the part of the screen some light reaches is stretched back over it.
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    const addLight = (world_pos: Vec2, radius: number, strength: number, color: string): void => {
      const sx = (world_pos.x - this.camera.pos.x) * this.camera.zoom + width / 2;
      const sy = (world_pos.y - this.camera.pos.y) * this.camera.zoom + height / 2;
      const r = radius * this.camera.zoom;
      if (sx < -r || sy < -r || sx > width + r || sy > height + r) return;
      x0 = Math.min(x0, sx - r);
      y0 = Math.min(y0, sy - r);
      x1 = Math.max(x1, sx + r);
      y1 = Math.max(y1, sy + r);
      const gradient = lc.createRadialGradient(sx, sy, 0, sx, sy, r);
      gradient.addColorStop(0, rgba(color, strength * darkness));
      gradient.addColorStop(1, rgba(color, 0));
      lc.fillStyle = gradient;
      lc.fillRect(sx - r, sy - r, r * 2, r * 2);
    };

    const flicker = 1 + Math.sin(time * 8) * 0.06;
    for (const building of world.buildings) {
      if (building.type === 'campfire') addLight(building.pos, 230 * flicker, 0.5, '#ffb960');
      else if (building.type === 'lamp') addLight(building.pos, 130 * flicker, 0.42, '#ffd98a');
    }
    for (const player of world.players.values()) {
      addLight(player.pos, 150, player.id === selfId ? 0.34 : 0.22, '#bcd8ff');
    }
    // Laid over the stage, the map is stretched by the compositor and added on.
    if (night) return;

    // Snapped to the light map's own pixels so the stretch lines up with it.
    const bx0 = Math.max(0, Math.floor(x0 / LIGHT_DOWNSCALE));
    const by0 = Math.max(0, Math.floor(y0 / LIGHT_DOWNSCALE));
    const bx1 = Math.min(lw, Math.ceil(x1 / LIGHT_DOWNSCALE));
    const by1 = Math.min(lh, Math.ceil(y1 / LIGHT_DOWNSCALE));
    if (bx1 > bx0 && by1 > by0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        lights,
        bx0,
        by0,
        bx1 - bx0,
        by1 - by0,
        bx0 * LIGHT_DOWNSCALE,
        by0 * LIGHT_DOWNSCALE,
        (bx1 - bx0) * LIGHT_DOWNSCALE,
        (by1 - by0) * LIGHT_DOWNSCALE,
      );
      ctx.restore();
    }
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

/** What a player is holding while they harvest, from what they are working. */
function toolFor(world: World, player: Player): Tool {
  if (player.gatherNodeId === null) return null;
  const node = world.nodes.find((n) => n.id === player.gatherNodeId);
  if (!node) return null;
  switch (node.kind) {
    case 'tree':
      return 'axe';
    case 'rock':
      return 'pick';
    case 'fish':
      return 'rod';
    default:
      return 'hand';
  }
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

/**
 * A full-screen canvas over the night for the few things drawn above it. It
 * is hidden, and never cleared, while it has nothing to show, which is most of
 * the time.
 */
class Overlay {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d');
  private used = false;

  constructor(blend: 'normal' | 'plus-lighter') {
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      display: 'none',
      mixBlendMode: blend,
    });
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.used = false;
  }

  /** Clear what the last frame left and show or hide the layer; null when hidden. */
  begin(show: boolean): CanvasRenderingContext2D | null {
    const ctx = this.ctx;
    if (this.used && ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (show !== this.used) this.canvas.style.display = show ? 'block' : 'none';
    this.used = show;
    return show ? ctx : null;
  }
}
