import { MACHINES } from '@shared/data/machines';
import { TILE } from '@shared/sim/constants';
import type { World } from '@shared/sim/types';
import type { WorldMap } from './worldmap';

/** Tiles across the corner map: enough to see the next ore patch or a raid coming. */
const VIEW_TILES = 40;
/** Redraws a second; it follows the player, so it need not keep up with the frame. */
const RATE = 15;

/**
 * The island map, small, in the corner under the pouch: the ground around
 * the player drawn from the same painted chart as the M map, with the
 * factory, the camp, friends and anything hostile marked on it. A click
 * opens the full map.
 */
export class Minimap {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private timer = 0;
  private pending = 0;
  /**
   * The map's width, told by the browser when it changes; 0 while the corner
   * hides it. Reading layout every frame, after the HUD has changed the page,
   * made the browser lay out the whole interface again each frame to answer.
   */
  private width = 0;

  constructor(
    parent: HTMLElement,
    private map: WorldMap,
    onOpen: () => void,
  ) {
    this.root = document.createElement('button');
    this.root.className = 'minimap panel hidden';
    this.root.title = 'Island map (M)';
    this.root.setAttribute('aria-label', 'Open the island map');
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    this.root.addEventListener('click', onOpen);
    parent.appendChild(this.root);
    new ResizeObserver((entries) => {
      for (const entry of entries) this.width = entry.contentRect.width;
    }).observe(this.canvas);
  }

  update(world: World, selfId: number, dt: number): void {
    // The full map is up, or the corner is too narrow for one (see CSS).
    const shown = !this.map.isOpen && this.width > 0;
    this.root.classList.remove('hidden');
    this.pending += dt;
    this.timer -= dt;
    if (!shown || this.timer > 0) return;
    this.timer = 1 / RATE;
    const layers = this.map.layers(world, this.pending);
    this.pending = 0;
    const self = world.players.get(selfId);
    if (!layers || !self) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(this.width * dpr);
    if (size <= 0) return;
    if (this.canvas.width !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const span = VIEW_TILES * TILE;
    const scale = size / span;
    const left = self.pos.x - span / 2;
    const top = self.pos.y - span / 2;
    const k = layers.pixelsPerTile / TILE;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#12161e';
    ctx.fillRect(0, 0, size, size);
    for (const layer of [layers.fog, layers.land]) {
      ctx.drawImage(layer, left * k, top * k, span * k, span * k, 0, 0, size, size);
    }

    const at = (x: number, y: number): [number, number] => [(x - left) * scale, (y - top) * scale];
    const cell = Math.max(2, Math.round(TILE * scale));
    const inView = (x: number, y: number): boolean => x > -cell && y > -cell && x < size + cell && y < size + cell;

    ctx.fillStyle = 'rgba(40, 44, 52, 0.95)';
    for (const belt of world.belts) {
      const [x, y] = at(belt.tx * TILE, belt.ty * TILE);
      if (inView(x, y)) ctx.fillRect(Math.round(x), Math.round(y), cell, cell);
    }
    for (const machine of world.machines) {
      const [x, y] = at(machine.tx * TILE, machine.ty * TILE);
      if (!inView(x, y)) continue;
      ctx.fillStyle = MACHINES[machine.type].accent;
      ctx.fillRect(Math.round(x), Math.round(y), cell, cell);
    }

    const dot = (x: number, y: number, r: number, fill: string): void => {
      ctx.beginPath();
      ctx.arc(x, y, r * dpr, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#10141c';
      ctx.stroke();
    };
    const [campX, campY] = at(world.camp.x, world.camp.y);
    if (inView(campX, campY)) dot(campX, campY, 4, '#f0b94a');
    for (const mob of world.mobs) {
      const [x, y] = at(mob.pos.x, mob.pos.y);
      if (inView(x, y)) dot(x, y, 2.5, '#ef6171');
    }

    for (const player of world.players.values()) {
      const [x, y] = at(player.pos.x, player.pos.y);
      if (!inView(x, y)) continue;
      const mine = player.id === selfId;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(player.facing.y, player.facing.x));
      const r = (mine ? 6 : 5) * dpr;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.7, r * 0.65);
      ctx.lineTo(-r * 0.35, 0);
      ctx.lineTo(-r * 0.7, -r * 0.65);
      ctx.closePath();
      ctx.fillStyle = mine ? '#ffffff' : '#9fd3ff';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#10141c';
      ctx.stroke();
      ctx.restore();
    }
  }
}
