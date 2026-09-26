import { MACHINES } from '@shared/data/machines';
import { MAP_TILES, TILE } from '@shared/sim/constants';
import { exploredShare } from '@shared/sim/explore';
import { minerOreLeft } from '@shared/sim/ore';
import type { Machine, ResourceKind, World } from '@shared/sim/types';
import type { Ledger } from '../ledger';
import { icon } from './icons';
import { LedgerView } from './ledger';
import './worldmap.css';

/** Terrain in the order `TERRAIN_ORDER` stores it: deep, water, sand, grass, forest, rock. */
const LAND: [number, number, number][] = [
  [22, 52, 82],
  [42, 104, 138],
  [208, 190, 142],
  [102, 148, 80],
  [64, 108, 62],
  [128, 130, 130],
];
/** Water right against the land, so the coast has a lighter shelf around it. */
const SHALLOWS: [number, number, number] = [74, 142, 160];
/** The surf line drawn on the land's edge where it meets the water. */
const FOAM: [number, number, number] = [226, 232, 214];
/** Ore in `ORE_ORDER`, index 0 being none. */
const ORE: ([number, number, number] | null)[] = [null, [120, 150, 190], [210, 128, 70], [40, 40, 48]];
/** Unseen ground is shown as a dim ghost of itself, so the coast still reads. */
const FOG = [18, 22, 30];
/** Map colours for the landmarks; anything else on the island is not marked. */
const LANDMARK_MARK: Partial<Record<ResourceKind, string>> = {
  cache: '#f2e6a8',
  ruin: '#c8c2b4',
  pod: '#ff7a5a',
  shrine: '#c49cff',
};
const FOG_SHOW = 0.16;
/** Roughly how many pixels across the painted map is, whatever the island's size. */
const MAP_PIXELS = 768;
/** How far the map zooms in, and how far it zooms itself to fit what has been explored. */
const MAX_ZOOM = 8;
const FIT_ZOOM = 4;
/** Terrain water indices in `TERRAIN_ORDER`. */
const DEEP = 0;
const WATER = 1;

/** A fixed pseudo-random value in [0, 1) for a pixel, so the grain never shimmers. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** `hash` over a 256-pixel square, looked up per pixel instead of computed: the map has a million of them. */
const GRAIN_SIZE = 256;
let grainTable: Float32Array | null = null;
function grainAt(x: number, y: number): number {
  if (!grainTable) {
    grainTable = new Float32Array(GRAIN_SIZE * GRAIN_SIZE);
    for (let i = 0; i < grainTable.length; i++) grainTable[i] = hash(i % GRAIN_SIZE, Math.floor(i / GRAIN_SIZE));
  }
  return grainTable[(y & (GRAIN_SIZE - 1)) * GRAIN_SIZE + (x & (GRAIN_SIZE - 1))];
}

/** Smooth noise over cells of `size` tiles, for meadow-sized patches of light and shade. */
function patch(x: number, y: number, size: number): number {
  const gx = x / size;
  const gy = y / size;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
  const b = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

export type MapTab = 'map' | 'ledger';

/**
 * Miners that have pulled up everything within reach. They never start again
 * on their own, so the map points them out rather than leaving the player to
 * notice which of forty miners went quiet.
 */
export function dryMiners(world: World): Machine[] {
  return world.machines.filter(
    (m) => MACHINES[m.type].family === 'miner' && m.ore !== null && minerOreLeft(world, m) === 0,
  );
}

/**
 * The island at a glance: what has been explored, where the ore lies, the
 * factory and the camp, and you. The terrain image is painted once per
 * change of what is known, and the markers every frame it is open.
 */
export class WorldMap {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private fogCanvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private share: HTMLElement;
  private open = false;
  private paintedKey = '';
  private refresh = 0;
  private tab: MapTab = 'map';
  private view: HTMLElement;
  private ledgerView: LedgerView;
  private tabs: HTMLElement[];
  private dryCount = 0;
  private dryTimer = 0;
  private frame: HTMLElement;
  private pan: HTMLElement;
  /** How far in the map is zoomed, and the point of the island (0 to 1 across) at the frame's centre. */
  private zoom = 1;
  private cx = 0.5;
  private cy = 0.5;
  private panStyle = '';
  /** The island the view was last fitted to; a new one is fitted to what has been explored of it. */
  private fittedKey = '';
  private recentre = false;
  private pointers = new Map<number, { x: number; y: number }>();
  /** The island fully known and as a ghost, painted once per island; see `paintBases`. */
  private seenBase: HTMLCanvasElement | null = null;
  private fogBase: HTMLCanvasElement | null = null;
  private baseKey = '';
  /** The known island with its trees and rocks, redone each time the map opens so felled forest shows. */
  private seenFull = document.createElement('canvas');
  private detailFresh = false;
  private detailLive = -1;
  /** The explored mask at one pixel a tile, and blurred at two, to soften the fog's edge. */
  private mask = document.createElement('canvas');
  private soft = document.createElement('canvas');
  /** How many tiles were known at the last repaint; the fog is only redone when it grows. */
  private knownCount = -1;

  constructor(parent: HTMLElement, private onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'worldmap hidden';
    this.root.innerHTML = `
      <div class="worldmap-inner panel">
        <header class="worldmap-head">
          <nav class="worldmap-tabs">
            <button data-tab="map" title="Island map (M)">Map</button>
            <button data-tab="ledger" title="Production (L)">Production</button>
          </nav>
          <span class="worldmap-share" data-role="share"></span>
          <button class="icon-btn worldmap-close" title="Close (M)" data-role="close">&times;</button>
        </header>
        <div class="worldmap-view" data-role="view">
        <div class="worldmap-frame" data-role="frame">
          <div class="worldmap-pan" data-role="pan">
            <canvas class="worldmap-land" data-role="fog"></canvas>
            <canvas class="worldmap-land" data-role="land"></canvas>
          </div>
          <canvas class="worldmap-marks" data-role="marks"></canvas>
          <div class="worldmap-zoom">
            <button class="icon-btn" data-zoom="in" title="Zoom in (scroll or pinch)">${icon('plus')}</button>
            <button class="icon-btn" data-zoom="out" title="Zoom out">${icon('minus')}</button>
            <button class="icon-btn" data-zoom="me" title="Centre on you">${icon('locate')}</button>
          </div>
        </div>
        <footer class="worldmap-key">
          <span><i style="background:rgb(120,150,190)"></i>Iron</span>
          <span><i style="background:rgb(210,128,70)"></i>Copper</span>
          <span><i style="background:rgb(40,40,48)"></i>Coal</span>
          <span><i class="dot-factory"></i>Factory</span>
          <span><i class="dot-camp"></i>Camp</span>
          <span><i class="dot-landmark"></i>Landmark</span>
          <span><i class="dot-dry"></i>Dry miner</span>
          <span><i class="dot-you"></i>You</span>
        </footer>
        </div>
      </div>`;
    const role = <T extends HTMLElement>(name: string) => this.root.querySelector<T>(`[data-role="${name}"]`)!;
    this.canvas = role<HTMLCanvasElement>('land');
    this.fogCanvas = role<HTMLCanvasElement>('fog');
    this.overlay = role<HTMLCanvasElement>('marks');
    this.share = role('share');
    this.view = role('view');
    this.frame = role('frame');
    this.pan = role('pan');
    this.bindZoom();
    this.ledgerView = new LedgerView(this.root.querySelector('.worldmap-inner')!, () => this.showTab('map'));
    this.tabs = [...this.root.querySelectorAll<HTMLElement>('[data-tab]')];
    for (const tab of this.tabs) tab.addEventListener('click', () => this.showTab(tab.dataset.tab as MapTab));
    role('close').addEventListener('click', () => this.onClose());
    // A click on the dimmed backdrop closes it, like every other sheet.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.onClose();
    });
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get currentTab(): MapTab {
    return this.tab;
  }

  setOpen(open: boolean, tab: MapTab = this.tab): void {
    this.open = open;
    this.root.classList.toggle('hidden', !open);
    this.paintedKey = '';
    this.detailFresh = false;
    this.knownCount = -1;
    this.recentre = open;
    this.pointers.clear();
    this.showTab(tab);
  }

  showTab(tab: MapTab): void {
    this.tab = tab;
    for (const el of this.tabs) el.classList.toggle('on', el.dataset.tab === tab);
    this.view.classList.toggle('hidden', tab !== 'map');
    this.share.classList.toggle('hidden', tab !== 'map');
    this.ledgerView.setVisible(tab === 'ledger');
    this.paintedKey = '';
    this.dryTimer = 0;
  }

  update(world: World, selfId: number, dt: number, ledger: Ledger): void {
    if (!this.open) return;
    if (this.tab === 'ledger') {
      this.dryTimer -= dt;
      if (this.dryTimer <= 0) {
        this.dryCount = dryMiners(world).length;
        this.dryTimer = 1;
      }
      this.ledgerView.update(ledger, this.dryCount);
      return;
    }
    // The explored mask only grows while walking, so repaint it now and then
    // rather than hashing it every frame.
    this.refresh -= dt;
    const key = `${world.seed}|${world.worldgen}|${MAP_TILES}`;
    if (key !== this.fittedKey) {
      this.fitView(world, selfId);
      this.fittedKey = key;
    } else if (this.recentre) {
      this.centreOn(world, selfId);
    }
    this.recentre = false;
    if (key !== this.paintedKey || this.refresh <= 0) {
      this.paintLand(world);
      this.paintedKey = key;
      this.refresh = 0.5;
      this.share.innerHTML = `${Math.round(exploredShare(world) * 100)}% explored${landmarkTally(world)}`;
    }
    this.paintMarks(world, selfId);
  }

  /**
   * The island is painted like a chart rather than one flat square per tile:
   * a grain over every colour, broad patches of light and shade, a pale shelf
   * of shallows and a surf line along the coast, and ore as speckles over the
   * ground it lies in. It is costly, so it is done once per island; only the
   * fog over it changes as you walk.
   */
  private paintBases(world: World): void {
    const n = MAP_TILES;
    const k = Math.max(2, Math.round(MAP_PIXELS / n));
    const size = n * k;
    const seen = document.createElement('canvas');
    seen.width = seen.height = size;
    const sctx = seen.getContext('2d');
    const ghost = document.createElement('canvas');
    ghost.width = ghost.height = n;
    const gctx = ghost.getContext('2d');
    if (!sctx || !gctx) return;
    const seenImg = sctx.createImageData(size, size);
    const ghostImg = gctx.createImageData(n, n);
    const sp = seenImg.data;
    const gp = ghostImg.data;
    const terrain = world.terrain;
    const wet = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) return true;
      const t = terrain[ty * n + tx];
      return t === DEEP || t === WATER;
    };

    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const i = ty * n + tx;
        const t = terrain[i];
        const land = LAND[t] ?? LAND[DEEP];
        // Unseen ground shows only its terrain, never its ore.
        gp[i * 4] = FOG[0] + (land[0] - FOG[0]) * FOG_SHOW;
        gp[i * 4 + 1] = FOG[1] + (land[1] - FOG[1]) * FOG_SHOW;
        gp[i * 4 + 2] = FOG[2] + (land[2] - FOG[2]) * FOG_SHOW;
        gp[i * 4 + 3] = 255;

        const water = t === DEEP || t === WATER;
        let base = land;
        if (t === WATER && (!wet(tx - 1, ty) || !wet(tx + 1, ty) || !wet(tx, ty - 1) || !wet(tx, ty + 1))) {
          base = SHALLOWS;
        }
        const ore = water ? null : ORE[world.ore[i]];
        // Which sides of a land tile face the sea, for the surf line.
        const surfW = !water && wet(tx - 1, ty);
        const surfE = !water && wet(tx + 1, ty);
        const surfN = !water && wet(tx, ty - 1);
        const surfS = !water && wet(tx, ty + 1);
        const shade = 0.9 + patch(tx, ty, water ? 14 : 7) * 0.2;
        for (let py = 0; py < k; py++) {
          const y = ty * k + py;
          const edgeY = (surfN && py === 0) || (surfS && py === k - 1);
          for (let px = 0; px < k; px++) {
            const x = tx * k + px;
            const g = grainAt(x, y);
            let c = base;
            let lit = shade * (0.95 + g * 0.1);
            if (ore && grainAt(y + 101, x + 37) < 0.62) {
              c = ore;
              lit = 0.85 + g * 0.3;
            }
            let r = c[0] * lit;
            let gr = c[1] * lit;
            let b = c[2] * lit;
            if (edgeY || (surfW && px === 0) || (surfE && px === k - 1)) {
              r = r * 0.35 + FOAM[0] * 0.65;
              gr = gr * 0.35 + FOAM[1] * 0.65;
              b = b * 0.35 + FOAM[2] * 0.65;
            }
            const o = (y * size + x) * 4;
            sp[o] = r;
            sp[o + 1] = gr;
            sp[o + 2] = b;
            sp[o + 3] = 255;
          }
        }
      }
    }
    sctx.putImageData(seenImg, 0, 0);
    gctx.putImageData(ghostImg, 0, 0);

    const fog = document.createElement('canvas');
    fog.width = fog.height = size;
    const fctx = fog.getContext('2d');
    if (!fctx) return;
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(ghost, 0, 0, size, size);

    // A faint survey grid, so distances on the map can be judged by eye.
    const step = 16 * k;
    for (const ctx of [sctx, fctx]) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      for (let v = step; v < size; v += step) {
        ctx.fillRect(v, 0, 1, size);
        ctx.fillRect(0, v, size, 1);
      }
    }
    this.seenBase = seen;
    this.fogBase = fog;
  }

  /** The known island with trees as dark crowns and rocks as pale flecks, so explored ground is not bare. */
  private paintDetail(world: World, seen: HTMLCanvasElement): void {
    const size = seen.width;
    const full = this.seenFull;
    if (full.width !== size) {
      full.width = size;
      full.height = size;
    }
    const ctx = full.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(seen, 0, 0);
    const scale = size / (MAP_TILES * TILE);
    const r = Math.max(1.5, TILE * scale * 0.42);
    const sprites = mapSprites(r);
    const half = sprites.size / 2;
    for (const node of world.nodes) {
      if (node.charges <= 0) continue;
      const sprite = node.kind === 'tree' ? sprites.trees[node.seed % 2] : node.kind === 'rock' ? sprites.rock : null;
      if (!sprite) continue;
      ctx.drawImage(sprite, Math.round(node.pos.x * scale - half), Math.round(node.pos.y * scale - half));
    }
  }

  private paintLand(world: World): void {
    const n = MAP_TILES;
    const key = `${world.seed}|${world.worldgen}|${n}`;
    if (key !== this.baseKey || !this.seenBase) {
      this.paintBases(world);
      this.baseKey = key;
      this.detailFresh = false;
      this.detailLive = -1;
      if (this.fogBase) {
        this.fogCanvas.width = this.fogCanvas.height = this.fogBase.width;
        this.fogCanvas.getContext('2d')?.drawImage(this.fogBase, 0, 0);
      }
    }
    const seen = this.seenBase;
    const fog = this.fogBase;
    if (!seen || !fog) return;
    if (!this.detailFresh) {
      // Stamping thousands of trees is the dearest part of opening the map,
      // so it is skipped when nothing has been felled or regrown since.
      let live = 0;
      for (const node of world.nodes) if (node.charges > 0) live++;
      if (live !== this.detailLive) {
        this.paintDetail(world, seen);
        this.detailLive = live;
        this.knownCount = -1;
      }
      this.detailFresh = true;
    }

    let known = 0;
    for (let i = 0; i < n * n; i++) known += world.explored[i];
    if (known === this.knownCount) return;
    this.knownCount = known;

    const size = seen.width;
    if (this.canvas.width !== size) {
      this.canvas.width = this.canvas.height = size;
    }
    const ctx = this.canvas.getContext('2d');
    const mctx = this.mask.getContext('2d');
    const sctx = this.soft.getContext('2d');
    if (!ctx || !mctx || !sctx) return;

    if (this.mask.width !== n) {
      this.mask.width = this.mask.height = n;
      this.soft.width = this.soft.height = n * 2;
    }
    const image = mctx.createImageData(n, n);
    const px = image.data;
    for (let i = 0; i < n * n; i++) px[i * 4 + 3] = world.explored[i] === 1 ? 255 : 0;
    mctx.putImageData(image, 0, 0);

    // The known part is cut out of the full-colour island by the explored
    // mask, blurred at low resolution and stretched smoothly so the fog's
    // edge is soft; the ghost of the island shows through from the canvas
    // beneath. Blurring at full size cost more than the rest of the map.
    sctx.clearRect(0, 0, n * 2, n * 2);
    sctx.filter = 'blur(3px)';
    sctx.drawImage(this.mask, 0, 0, n * 2, n * 2);
    sctx.filter = 'none';

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.soft, 0, 0, size, size);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(this.seenFull, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }


  private paintMarks(world: World, selfId: number): void {
    const frame = this.overlay.parentElement!;
    const size = Math.round(frame.clientWidth * (window.devicePixelRatio || 1));
    if (size <= 0) return;
    if (this.overlay.width !== size) {
      this.overlay.width = size;
      this.overlay.height = size;
    }
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    this.applyView();
    // Markers follow the zoomed island but keep their own size, so they
    // stay readable at any zoom.
    const scale = (size / (MAP_TILES * TILE)) * this.zoom;
    const ox = (0.5 - this.cx * this.zoom) * size;
    const oy = (0.5 - this.cy * this.zoom) * size;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(ox, oy);

    // The factory, one small square per piece, so a base reads as a shape.
    const cell = Math.max(2 * dpr, TILE * scale);
    for (const belt of world.belts) {
      ctx.fillStyle = 'rgba(40, 44, 52, 0.95)';
      ctx.fillRect(belt.tx * TILE * scale, belt.ty * TILE * scale, cell, cell);
    }
    for (const machine of world.machines) {
      ctx.fillStyle = MACHINES[machine.type].accent;
      ctx.fillRect(machine.tx * TILE * scale, machine.ty * TILE * scale, cell, cell);
    }

    const ring = (x: number, y: number, r: number, fill: string, line: string): void => {
      ctx.beginPath();
      ctx.arc(x * scale, y * scale, r * dpr, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = line;
      ctx.stroke();
    };
    ring(world.camp.x, world.camp.y, 6, '#f0b94a', '#3a2a08');

    // A dry miner gets a red ring big enough to find on a whole-island view.
    for (const miner of dryMiners(world)) {
      const cx = (miner.tx + 0.5) * TILE;
      const cy = (miner.ty + 0.5) * TILE;
      ctx.beginPath();
      ctx.arc(cx * scale, cy * scale, 9 * dpr, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = '#10141c';
      ctx.stroke();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#ef6171';
      ctx.stroke();
    }

    // Landmarks show once their tile has been seen: a diamond in the colour
    // of what is there, so the map remembers where to come back to.
    for (const node of world.nodes) {
      const color = LANDMARK_MARK[node.kind];
      if (!color || node.charges <= 0) continue;
      const tx = Math.floor(node.pos.x / TILE);
      const ty = Math.floor(node.pos.y / TILE);
      if (world.explored[ty * MAP_TILES + tx] !== 1) continue;
      const x = node.pos.x * scale;
      const y = node.pos.y * scale;
      const r = 5 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#10141c';
      ctx.stroke();
    }

    for (const player of world.players.values()) {
      const self = player.id === selfId;
      const x = player.pos.x * scale;
      const y = player.pos.y * scale;
      const angle = Math.atan2(player.facing.y, player.facing.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      const r = (self ? 8 : 6) * dpr;
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.7, r * 0.65);
      ctx.lineTo(-r * 0.35, 0);
      ctx.lineTo(-r * 0.7, -r * 0.65);
      ctx.closePath();
      ctx.fillStyle = self ? '#ffffff' : '#9fd3ff';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#10141c';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** Scroll, pinch, drag and the corner buttons all move the one view. */
  private bindZoom(): void {
    const frame = this.frame;
    frame.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    frame.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      try {
        frame.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer tracks; the drag still works while it stays on the map.
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      frame.classList.add('dragging');
    });
    frame.addEventListener('pointermove', (e) => {
      const was = this.pointers.get(e.pointerId);
      if (!was) return;
      const others = [...this.pointers.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
      const width = frame.clientWidth * this.zoom;
      if (others.length === 0) {
        this.cx -= (e.clientX - was.x) / width;
        this.cy -= (e.clientY - was.y) / width;
      } else {
        // Two fingers: the gap between them sets the zoom, about their midpoint.
        const o = others[0];
        const before = Math.hypot(was.x - o.x, was.y - o.y);
        const after = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (before > 4) this.zoomAt((e.clientX + o.x) / 2, (e.clientY + o.y) / 2, after / before);
      }
      was.x = e.clientX;
      was.y = e.clientY;
      this.applyView();
    });
    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) frame.classList.remove('dragging');
    };
    frame.addEventListener('pointerup', release);
    frame.addEventListener('pointercancel', release);
    for (const button of frame.querySelectorAll<HTMLElement>('[data-zoom]')) {
      button.addEventListener('click', () => {
        const kind = button.dataset.zoom;
        if (kind === 'me') {
          this.recentre = true;
          this.zoom = Math.max(this.zoom, 3);
          return;
        }
        const rect = frame.getBoundingClientRect();
        this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, kind === 'in' ? 1.6 : 1 / 1.6);
      });
    }
  }

  /** Zoom by `factor`, keeping the point of the island under (x, y) where it is. */
  private zoomAt(x: number, y: number, factor: number): void {
    const rect = this.frame.getBoundingClientRect();
    const w = rect.width;
    if (w <= 0) return;
    const fx = (x - rect.left) / w;
    const fy = (y - rect.top) / w;
    // The island's own coordinates under the pointer, before and after.
    const mx = this.cx + (fx - 0.5) / this.zoom;
    const my = this.cy + (fy - 0.5) / this.zoom;
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, this.zoom * factor));
    this.cx = mx - (fx - 0.5) / this.zoom;
    this.cy = my - (fy - 0.5) / this.zoom;
    this.applyView();
  }

  /** Close enough to see what has been explored so far, centred on you. */
  private fitView(world: World, selfId: number): void {
    const n = MAP_TILES;
    let x0 = n;
    let y0 = n;
    let x1 = -1;
    let y1 = -1;
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        if (world.explored[ty * n + tx] !== 1) continue;
        if (tx < x0) x0 = tx;
        if (tx > x1) x1 = tx;
        if (ty < y0) y0 = ty;
        if (ty > y1) y1 = ty;
      }
    }
    const span = x1 < 0 ? n : Math.max(x1 - x0, y1 - y0) + 1;
    this.zoom = Math.min(FIT_ZOOM, Math.max(1, n / (span + 24)));
    this.centreOn(world, selfId);
  }

  private centreOn(world: World, selfId: number): void {
    const self = world.players.get(selfId);
    if (!self) return;
    const size = MAP_TILES * TILE;
    this.cx = self.pos.x / size;
    this.cy = self.pos.y / size;
    this.applyView();
  }

  /** Keep the island filling the frame, then move the painted layers to match. */
  private applyView(): void {
    const half = 0.5 / this.zoom;
    this.cx = Math.min(1 - half, Math.max(half, this.cx));
    this.cy = Math.min(1 - half, Math.max(half, this.cy));
    const w = this.frame.clientWidth;
    const ox = (0.5 - this.cx * this.zoom) * w;
    const oy = (0.5 - this.cy * this.zoom) * w;
    const style = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px) scale(${this.zoom.toFixed(4)})`;
    if (style !== this.panStyle) {
      this.pan.style.transform = style;
      this.panStyle = style;
      this.frame.classList.toggle('zoomed', this.zoom >= 2);
    }
  }
}

let spriteCache: { r: number; size: number; trees: HTMLCanvasElement[]; rock: HTMLCanvasElement } | null = null;

/** A tree crown and a rock drawn once, then stamped for each of the island's thousands. */
function mapSprites(r: number): { size: number; trees: HTMLCanvasElement[]; rock: HTMLCanvasElement } {
  if (spriteCache && spriteCache.r === r) return spriteCache;
  const size = Math.ceil(r * 3);
  const make = (draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.translate(size / 2, size / 2);
      draw(ctx);
    }
    return c;
  };
  const tree = (crown: string) =>
    make((ctx) => {
      ctx.fillStyle = 'rgba(16, 36, 22, 0.55)';
      ctx.beginPath();
      ctx.arc(r * 0.3, r * 0.35, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = crown;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(160, 210, 130, 0.35)';
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.35, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    });
  const rock = make((ctx) => {
    ctx.fillStyle = 'rgba(20, 22, 26, 0.5)';
    ctx.fillRect(-r * 0.5, -r * 0.2, r * 1.3, r * 0.9);
    ctx.fillStyle = '#a9adb0';
    ctx.fillRect(-r * 0.65, -r * 0.55, r * 1.2, r * 0.9);
  });
  spriteCache = { r, size, trees: [tree('#356b3e'), tree('#3f7a4a')], rock };
  return spriteCache;
}

/**
 * Landmarks left to search, split by whether the map has shown them yet. A
 * searched one is gone from the island, so what remains is what is still
 * worth the walk. Islands grown before landmarks have none, and say nothing.
 */
function landmarkTally(world: World): string {
  let spotted = 0;
  let hidden = 0;
  for (const node of world.nodes) {
    if (!LANDMARK_MARK[node.kind] || node.charges <= 0) continue;
    const tx = Math.floor(node.pos.x / TILE);
    const ty = Math.floor(node.pos.y / TILE);
    if (world.explored[ty * MAP_TILES + tx] === 1) spotted++;
    else hidden++;
  }
  if (spotted + hidden === 0) return '';
  const parts = [
    spotted > 0 ? `${spotted} to search` : '',
    hidden > 0 ? `${hidden} undiscovered` : '',
  ].filter(Boolean);
  return `<span class="worldmap-finds" title="Landmarks on the island not yet searched"><i></i>${parts.join(' · ')}</span>`;
}
