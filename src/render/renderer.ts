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
import { Grade } from './grade';
import { SWING_IMPACT, swingPhase } from './characters';
import { strikeNode } from './nature';
import type { GpuStage } from './gpu/stage';
import { setItemScale } from './items';
import { setPaintScale } from './paint';
import { polygon } from './shapes';
import { drawBelt, drawBeltAt, drawBeltItems, drawMachine, previewMachine, setFactoryScale } from './factory';
import { drawPowerCoverage, drawPowerWires } from './power';
import { dirAngle, stepN, tileCenter, tileKey } from '@shared/sim/grid';
import { MACHINES, TUNNEL_REACH } from '@shared/data/machines';
import { tunnelEnd, tunnelEntranceOf } from '@shared/sim/factory';

/** How much coarser than the screen, in CSS pixels, the night's lights are gathered. */
const LIGHT_DOWNSCALE = 4;

/** Anything that needs depth sorting, collected once per frame. */
interface Drawable {
  y: number;
  draw: () => void;
}

/** Where the choice of renderer is remembered; `?renderer=pixi` or `?renderer=canvas` sets it. */
const RENDERER_KEY = 'ccgame.renderer';

/**
 * Which renderer this player chose, or `auto` when they never chose. Auto
 * means Pixi: Abiel found it the smoother of the two on his machine
 * (2026-09-25), which is the case the switch existed to settle.
 */
function rendererChoice(): 'pixi' | 'canvas' | 'auto' {
  try {
    const asked = new URLSearchParams(location.search).get('renderer');
    if (asked === 'pixi' || asked === 'canvas') localStorage.setItem(RENDERER_KEY, asked);
    const stored = localStorage.getItem(RENDERER_KEY);
    return stored === 'pixi' || stored === 'canvas' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export class Renderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  /** What the frame is drawn with: the stage's own context, or the Pixi one once it is up. */
  private ctx: CanvasRenderingContext2D;
  private stageCtx: CanvasRenderingContext2D;
  /** The Pixi renderer, while it is switched on and has started. */
  private gpu: GpuStage | null = null;
  /** Milliseconds between frames, smoothed; see `fps`. */
  private frameGap = 0;
  private lastFrame = 0;
  private ground = new GroundCache();
  private grade = new Grade();
  private zoomStep = loadZoomStep();
  /** Told when a tool lands or a dash sets off, so the game can play it. */
  onCue: ((cue: Cue, pos: Vec2, self: boolean) => void) | null = null;
  /** Per player: last swing phase, time to next footstep, and whether dashing. */
  private motion = new Map<number, { swing: number; step: number; dashing: boolean }>();
  private lastObserved = -1;
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
    dark: HTMLCanvasElement;
    darkCtx: CanvasRenderingContext2D | null;
    lights: HTMLCanvasElement;
    lightsCtx: CanvasRenderingContext2D | null;
    /** Eyes glow onto the night; name tags sit plainly over it. */
    eyes: Overlay;
    tags: Overlay;
    showing: boolean;
  } | null = null;
  /** The night's shade and lights, gathered at low resolution; see `drawLighting`. */
  private dark: HTMLCanvasElement | null = null;
  private darkCtx: CanvasRenderingContext2D | null = null;
  private lights: HTMLCanvasElement | null = null;
  private lightsCtx: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.stageCtx = ctx;

    // Night is laid over the scene by the browser's compositor rather than
    // painted into it: the low-resolution shade with the lights cut out of it,
    // then their warm tint added on. Painting both into the canvas was a
    // full-screen blend and a full-screen stretch every night frame.
    if (typeof CSS !== 'undefined' && CSS.supports('mix-blend-mode', 'plus-lighter')) {
      const dark = document.createElement('canvas');
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
      canvas.after(dark, lights, ...this.grade.elements, eyes.canvas, tags.canvas);
      this.night = {
        dark,
        darkCtx: dark.getContext('2d'),
        lights,
        lightsCtx: lights.getContext('2d'),
        eyes,
        tags,
        showing: false,
      };
    }

    // Graded under the eyes and name tags, which have to stay readable.
    if (!this.night) canvas.after(...this.grade.elements);

    const choice = rendererChoice();
    // A browser that only offers WebGL in software would run Pixi far slower
    // than Canvas, so Pixi is taken by default only on a real graphics card.
    if (choice !== 'canvas') void this.startGpu(choice === 'auto');
  }

  /**
   * Switch to the Pixi renderer or back, remembering the choice. Resolves to
   * the renderer actually drawing, which stays Canvas where Pixi cannot start.
   */
  async setBackend(kind: 'pixi' | 'canvas'): Promise<'pixi' | 'canvas'> {
    try {
      localStorage.setItem(RENDERER_KEY, kind);
    } catch {
      // A private window forgets the choice; the switch still happens.
    }
    if (kind === 'pixi') {
      await this.startGpu(false);
    } else if (this.gpu) {
      const gpu = this.gpu;
      this.gpu = null;
      this.ctx = this.stageCtx;
      this.canvas.style.opacity = '';
      gpu.destroy();
      this.resize();
    }
    return this.backend;
  }

  /**
   * Step the camera in or out. Zoom moves in a few fixed steps rather than
   * smoothly because the ground and every baked sprite are cached at the exact
   * scale they are shown at; a smooth zoom would rebake them every frame.
   * Returns false at either end.
   */
  zoomBy(dir: 1 | -1): boolean {
    const next = clamp(this.zoomStep + dir, 0, ZOOM_STEPS.length - 1);
    if (next === this.zoomStep) return false;
    this.zoomStep = next;
    try {
      localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // A private window forgets the choice; the zoom still changes.
    }
    this.resize();
    return true;
  }

  private starting: Promise<void> | null = null;

  private startGpu(hardwareOnly: boolean): Promise<void> {
    // The Pixi renderer relies on the night being laid over it, since it has
    // no way to blend the dark and the lights into itself yet.
    if (this.gpu || !this.night) return Promise.resolve();
    this.starting ??= import('./gpu/stage')
      .then(({ GpuStage }) => GpuStage.create(hardwareOnly))
      .then((stage) => this.attachGpu(stage))
      .catch((err: unknown) => console.warn('Pixi renderer unavailable, staying on Canvas', err))
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  /** Frames drawn a second, smoothed over the last couple of seconds. */
  get fps(): number {
    return this.frameGap > 0 ? 1000 / this.frameGap : 0;
  }

  /** Put the Pixi canvas under the stage canvas, which stays on top, clear, to take the input. */
  private attachGpu(stage: GpuStage): void {
    Object.assign(stage.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
    });
    this.canvas.before(stage.canvas);
    this.canvas.style.opacity = '0';
    this.gpu = stage;
    this.ctx = stage.ctx as unknown as CanvasRenderingContext2D;
    this.resize();
  }

  /** Which renderer is drawing, for the settings and for tests. */
  get backend(): 'pixi' | 'canvas' {
    return this.gpu ? 'pixi' : 'canvas';
  }

  /** Sprites and shapes the GPU renderer drew last frame, for the frame meter. */
  get drawnObjects(): number {
    return this.gpu ? this.gpu.ctx.root.children.length : 0;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    // Under Pixi the stage canvas only takes input, so it keeps no pixels.
    this.canvas.width = this.gpu ? 1 : pw;
    this.canvas.height = this.gpu ? 1 : ph;
    this.gpu?.resize(pw, ph);
    this.camera.width = w;
    this.camera.height = h;
    this.dpr = dpr;
    this.stageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.night) {
      this.night.eyes.resize(pw, ph);
      this.night.tags.resize(pw, ph);
    }
    // Zoom with viewport so a phone shows a sensible slice of the island, then
    // by the player's own choice of how close to stand.
    this.camera.zoom = clamp(Math.min(w, h) / 500, 1.15, 2.6) * ZOOM_STEPS[this.zoomStep];
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

    const now = performance.now();
    const gap = now - this.lastFrame;
    // A gap of a second or more is the tab asleep, not a slow frame.
    if (this.lastFrame > 0 && gap < 1000) this.frameGap = this.frameGap > 0 ? this.frameGap * 0.97 + gap * 0.03 : gap;
    this.lastFrame = now;

    if (this.gpu) {
      this.gpu.ctx.begin();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
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
    this.observe(world, selfId, time);
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
    this.gpu?.present();

    this.drawLighting(world, selfId, time);

    // Names and eyes stay visible after dark, so they go over the night.
    const darkness = nightDarkness(world);
    this.grade.update(world, darkness);
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
  /**
   * Watch how each player is moving and turn it into small physical cues: a
   * shudder and flying chips when a swing lands, dust at each step, a puff as
   * a dash sets off. All of it is read from state the sim already has, so
   * nothing here needs an event or touches the island.
   */
  private observe(world: World, selfId: number, time: number): void {
    const dt = this.lastObserved < 0 ? 0 : time - this.lastObserved;
    this.lastObserved = time;
    // A jump back or a long gap is a load or a pause, not a stride.
    if (dt < 0 || dt > 0.25) {
      this.motion.clear();
      return;
    }
    for (const player of world.players.values()) {
      let m = this.motion.get(player.id);
      if (!m) {
        m = { swing: -1, step: 0, dashing: false };
        this.motion.set(player.id, m);
      }
      const feet = { x: player.pos.x, y: player.pos.y + 7 };
      const self = player.id === selfId;

      const node =
        player.gatherNodeId !== null && player.gatherProgress > 0 && toolFor(world, player) !== null
          ? world.nodes.find((n) => n.id === player.gatherNodeId)
          : undefined;
      const swing = node ? swingPhase(player, time) : -1;
      if (node && m.swing >= 0 && m.swing < SWING_IMPACT && swing >= SWING_IMPACT) {
        strikeNode(node.id, time);
        if (node.kind === 'tree' || node.kind === 'rock' || node.kind === 'bush') {
          this.effects.chips(node.pos, node.kind, player.pos.x);
        }
        if (self) this.effects.shake = Math.min(3, this.effects.shake + 0.9);
        this.onCue?.(node.kind === 'tree' ? 'chop' : node.kind === 'rock' ? 'chip' : 'rustle', node.pos, self);
      }
      m.swing = swing;

      const dashing = player.dashTime > 0;
      if (dashing && !m.dashing) {
        this.effects.dust(feet, 7, 1.8);
        this.onCue?.('dash', feet, self);
      }
      m.dashing = dashing;

      const speed = Math.hypot(player.vel.x, player.vel.y);
      if (speed > 40 && player.downed <= 0) {
        m.step -= dt * (dashing ? 3 : 1) * (speed / 150);
        if (m.step <= 0) {
          m.step = 0.3;
          this.effects.dust(feet, dashing ? 2 : 1, 0.7);
        }
      } else m.step = 0;
    }
    if (this.motion.size > world.players.size) {
      for (const id of this.motion.keys()) if (!world.players.has(id)) this.motion.delete(id);
    }
  }

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
    // An underground belt turns into an exit where it closes a tunnel, and the
    // ghost has to say which it is about to be before the click, not after.
    const what = ghost.what === 'belt' ? 'belt' : tunnelEnd(world, ghost.what, ghost.tx, ghost.ty, ghost.dir);
    if (what !== 'belt' && MACHINES[what].tunnel) drawTunnelSpan(ctx, world, what, ghost, tint);

    const { x, y } = tileCenter(ghost.tx, ghost.ty);
    ctx.beginPath();
    ctx.roundRect(x - TILE / 2 + 1, y - TILE / 2 + 1, TILE - 2, TILE - 2, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();

    // The piece itself, half there, so what lands is what was previewed —
    // facing, output port and all.
    ctx.globalAlpha = 0.62;
    if (what === 'belt') drawBeltAt(ctx, x, y, ghost.dir, time);
    else drawMachine(ctx, previewMachine(what, ghost.tx, ghost.ty, ghost.dir), time);
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
   * Night is a dark shade with the campfire, lamps and each player cut out of
   * it, and a faint warm tint where the fire is — cheap, and it makes camp feel
   * safe. The lights take the dark away rather than adding brightness on top:
   * added light lifts every colour by the same amount, which reads as fog and
   * washes out whoever is standing in it.
   */
  private drawLighting(world: World, selfId: number, time: number): void {
    const darkness = nightDarkness(world);
    const night = this.night;
    if (darkness <= 0.01) {
      if (night?.showing) {
        night.showing = false;
        night.dark.style.display = 'none';
        night.lights.style.display = 'none';
      }
      return;
    }
    if (night && !night.showing) {
      night.showing = true;
      night.dark.style.display = 'block';
      night.lights.style.display = 'block';
    }

    const ctx = this.ctx;
    const { width, height } = this.camera;

    // Both layers are soft by nature, so they are gathered at a quarter of the
    // screen's resolution and stretched over it. Filling each light's gradient
    // across the full screen was most of a night frame in a camp with a few
    // lamps.
    const lw = Math.max(1, Math.ceil(width / LIGHT_DOWNSCALE));
    const lh = Math.max(1, Math.ceil(height / LIGHT_DOWNSCALE));
    if (night) {
      this.dark = night.dark;
      this.darkCtx = night.darkCtx;
      this.lights = night.lights;
      this.lightsCtx = night.lightsCtx;
    } else if (!this.lights) {
      this.dark = document.createElement('canvas');
      this.darkCtx = this.dark.getContext('2d');
      this.lights = document.createElement('canvas');
      this.lightsCtx = this.lights.getContext('2d');
    }
    const { dark, darkCtx: dc, lights, lightsCtx: lc } = this;
    if (!dark || !dc || !lights || !lc) return;
    for (const layer of [dark, lights]) {
      if (layer.width === lw && layer.height === lh) continue;
      layer.width = lw;
      layer.height = lh;
      // Stretched by exactly the downscale, so a light sits where it was drawn.
      if (night) {
        layer.style.width = `${lw * LIGHT_DOWNSCALE}px`;
        layer.style.height = `${lh * LIGHT_DOWNSCALE}px`;
      }
    }

    dc.setTransform(1, 0, 0, 1, 0, 0);
    dc.globalCompositeOperation = 'source-over';
    dc.clearRect(0, 0, lw, lh);
    dc.fillStyle = `rgba(8, 12, 30, ${(darkness * 0.84).toFixed(3)})`;
    dc.fillRect(0, 0, lw, lh);
    dc.setTransform(1 / LIGHT_DOWNSCALE, 0, 0, 1 / LIGHT_DOWNSCALE, 0, 0);
    dc.globalCompositeOperation = 'destination-out';

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
    /** `clear` is how much of the dark it lifts at its heart; `tint` how much colour it adds. */
    const addLight = (world_pos: Vec2, radius: number, clear: number, tint: number, color: string): void => {
      const sx = (world_pos.x - this.camera.pos.x) * this.camera.zoom + width / 2;
      const sy = (world_pos.y - this.camera.pos.y) * this.camera.zoom + height / 2;
      const r = radius * this.camera.zoom;
      if (sx < -r || sy < -r || sx > width + r || sy > height + r) return;

      // Eased rather than linear, so the pool has a lit middle and a soft rim.
      const cut = dc.createRadialGradient(sx, sy, 0, sx, sy, r);
      cut.addColorStop(0, `rgba(0,0,0,${clear})`);
      cut.addColorStop(0.45, `rgba(0,0,0,${(clear * 0.7).toFixed(3)})`);
      cut.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = cut;
      dc.fillRect(sx - r, sy - r, r * 2, r * 2);

      if (tint <= 0) return;
      x0 = Math.min(x0, sx - r);
      y0 = Math.min(y0, sy - r);
      x1 = Math.max(x1, sx + r);
      y1 = Math.max(y1, sy + r);
      const glow = lc.createRadialGradient(sx, sy, 0, sx, sy, r * 0.8);
      glow.addColorStop(0, rgba(color, tint * darkness));
      glow.addColorStop(1, rgba(color, 0));
      lc.fillStyle = glow;
      lc.fillRect(sx - r, sy - r, r * 2, r * 2);
    };

    const flicker = 1 + Math.sin(time * 8) * 0.06;
    for (const building of world.buildings) {
      if (building.type === 'campfire') addLight(building.pos, 250 * flicker, 0.95, 0.16, '#ffab4a');
      else if (building.type === 'lamp') addLight(building.pos, 140 * flicker, 0.85, 0.12, '#ffd27a');
    }
    for (const player of world.players.values()) {
      addLight(player.pos, 150, player.id === selfId ? 0.6 : 0.4, 0, '#bcd8ff');
    }
    // Laid over the stage, both maps are stretched by the compositor.
    if (night) return;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(dark, 0, 0, lw, lh, 0, 0, lw * LIGHT_DOWNSCALE, lh * LIGHT_DOWNSCALE);
    // Snapped to the light map's own pixels so the stretch lines up with it.
    const bx0 = Math.max(0, Math.floor(x0 / LIGHT_DOWNSCALE));
    const by0 = Math.max(0, Math.floor(y0 / LIGHT_DOWNSCALE));
    const bx1 = Math.min(lw, Math.ceil(x1 / LIGHT_DOWNSCALE));
    const by1 = Math.min(lh, Math.ceil(y1 / LIGHT_DOWNSCALE));
    if (bx1 > bx0 && by1 > by0) {
      ctx.globalCompositeOperation = 'lighter';
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
    }
    ctx.restore();
  }
}

/**
 * Camp decoration is placed freely at a world position; factory pieces snap to
 * a tile and carry a facing, so the preview has to describe both cases.
 */
/**
 * Where an underground belt reaches. An entrance marks the tiles its exit may
 * stand on; an exit is joined to the entrance it closes, so the pairing is
 * seen before it is made.
 */
function drawTunnelSpan(
  ctx: CanvasRenderingContext2D,
  world: World,
  what: MachineId,
  ghost: { tx: number; ty: number; dir: Direction },
  tint: string,
): void {
  const probe = previewMachine(what, ghost.tx, ghost.ty, ghost.dir);
  ctx.save();
  if (MACHINES[what].tunnel === 'out') {
    const entrance = tunnelEntranceOf(world, probe);
    if (entrance) {
      const a = tileCenter(entrance.tx, entrance.ty);
      const b = tileCenter(ghost.tx, ghost.ty);
      ctx.strokeStyle = tint;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = tint;
    for (let d = 1; d <= TUNNEL_REACH + 1; d++) {
      const at = stepN(ghost.tx, ghost.ty, ghost.dir, d);
      const { x, y } = tileCenter(at.tx, at.ty);
      // Fading with distance, so the far end of the reach reads as the limit.
      ctx.globalAlpha = 0.5 - (d / (TUNNEL_REACH + 2)) * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

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

/**
 * 0 at full day, 1 at deep night. Each twilight straddles the change of phase,
 * half on either side, so the dark keeps going the same way across it rather
 * than finishing early and snapping back.
 */
/** Sounds the renderer notices from motion rather than from sim events. */
export type Cue = 'chop' | 'chip' | 'rustle' | 'dash';

/** How close the camera stands, as multiples of the size-based default. */
const ZOOM_STEPS = [0.7, 0.85, 1, 1.2, 1.45];
const DEFAULT_ZOOM_STEP = 2;
const ZOOM_KEY = 'ccgame.zoom';

function loadZoomStep(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_KEY));
    if (localStorage.getItem(ZOOM_KEY) !== null && Number.isInteger(stored)) {
      return clamp(stored, 0, ZOOM_STEPS.length - 1);
    }
  } catch {
    // Storage can be off entirely; the default view is fine.
  }
  return DEFAULT_ZOOM_STEP;
}

export function nightDarkness(world: World): number {
  const { twilightSeconds } = CYCLE;
  const half = (t: number): number => 0.5 * Math.min(Math.max(t / twilightSeconds, 0), 1);
  if (world.phase === 'day') {
    const into = CYCLE.daySeconds - world.phaseTime;
    return Math.max(half(twilightSeconds - world.phaseTime), half(twilightSeconds - into));
  }
  const into = CYCLE.nightSeconds - world.phaseTime;
  return 1 - Math.max(half(twilightSeconds - world.phaseTime), half(twilightSeconds - into));
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
