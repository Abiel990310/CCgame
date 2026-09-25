import { MACHINES } from '@shared/data/machines';
import { MAP_TILES, TILE } from '@shared/sim/constants';
import { exploredShare } from '@shared/sim/explore';
import { minerOreLeft } from '@shared/sim/ore';
import type { Machine, ResourceKind, World } from '@shared/sim/types';
import type { Ledger } from '../ledger';
import { LedgerView } from './ledger';
import './worldmap.css';

/** Terrain in the order `TERRAIN_ORDER` stores it: deep, water, sand, grass, forest, rock. */
const LAND: [number, number, number][] = [
  [24, 58, 86],
  [48, 118, 146],
  [214, 196, 150],
  [108, 158, 84],
  [70, 118, 66],
  [134, 138, 140],
];
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
        <div class="worldmap-frame">
          <canvas class="worldmap-land" data-role="land"></canvas>
          <canvas class="worldmap-marks" data-role="marks"></canvas>
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
    this.overlay = role<HTMLCanvasElement>('marks');
    this.share = role('share');
    this.view = role('view');
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
    if (key !== this.paintedKey || this.refresh <= 0) {
      this.paintLand(world);
      this.paintedKey = key;
      this.refresh = 0.5;
      this.share.textContent = `${Math.round(exploredShare(world) * 100)}% explored`;
    }
    this.paintMarks(world, selfId);
  }

  private paintLand(world: World): void {
    const n = MAP_TILES;
    if (this.canvas.width !== n) {
      this.canvas.width = n;
      this.canvas.height = n;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(n, n);
    const px = image.data;
    for (let i = 0; i < n * n; i++) {
      const seen = world.explored[i] === 1;
      const ore = seen ? ORE[world.ore[i]] : null;
      const base = ore ?? LAND[world.terrain[i]] ?? LAND[0];
      const o = i * 4;
      if (seen) {
        px[o] = base[0];
        px[o + 1] = base[1];
        px[o + 2] = base[2];
      } else {
        px[o] = FOG[0] + (base[0] - FOG[0]) * FOG_SHOW;
        px[o + 1] = FOG[1] + (base[1] - FOG[1]) * FOG_SHOW;
        px[o + 2] = FOG[2] + (base[2] - FOG[2]) * FOG_SHOW;
      }
      px[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
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
    const scale = size / (MAP_TILES * TILE);
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, size, size);

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
  }
}
