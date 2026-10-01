import { MAP_TILES, TILE } from '@shared/sim/constants';
import { hash2 } from '@shared/sim/rng';
import { isBridgeByte, isWalkable, TERRAIN_ORDER } from '@shared/sim/terrain';

/**
 * Bridges are laid over open water, so the sea underneath is left as the
 * ground painted it and the deck is drawn on top, one tile at a time, before
 * the belts and everything standing on it. Drawing them live rather than
 * baking them into the ground means laying or lifting a span costs no
 * repaint of the ground cache.
 */

/** Which sides of a tile face open water, as a mask. Those get a rail. */
export const OPEN_N = 1;
export const OPEN_E = 2;
export const OPEN_S = 4;
export const OPEN_W = 8;

const WOOD = ['#a98350', '#b08a56', '#a07a49', '#b5905c'];
const SEAM = '#6e4f2d';
const RAIL = '#7a5834';
const RAIL_LIT = '#d1ab70';
const FACE = '#5a3e24';
const POST = '#4a331d';

/**
 * One tile of deck at tile (tx, ty). `open` says which sides meet water, and
 * `planksAlongX` whether the boards run east to west (a span walked north to
 * south) rather than north to south: they always lie across the way you go.
 */
export function drawDeckTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, open: number, planksAlongX: boolean): void {
  const x = tx * TILE;
  const y = ty * TILE;

  // The shadow the deck throws on the water below its front edge.
  if (open & OPEN_S) {
    ctx.fillStyle = 'rgba(6, 22, 34, 0.38)';
    ctx.fillRect(x + 1, y + TILE, TILE - 2, 9);
  }

  // The top, in planks. Each is a hair lighter or darker than its neighbour.
  const planks = 4;
  const size = TILE / planks;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = WOOD[Math.floor(hash2(tx * 4 + i, ty, 77) * WOOD.length)];
    if (planksAlongX) ctx.fillRect(x, y + i * size, TILE, size);
    else ctx.fillRect(x + i * size, y, size, TILE);
  }
  ctx.fillStyle = SEAM;
  for (let i = 1; i < planks; i++) {
    if (planksAlongX) ctx.fillRect(x, y + i * size - 1, TILE, 1);
    else ctx.fillRect(x + i * size - 1, y, 1, TILE);
  }

  // The front face hangs below the south edge, so a span has thickness.
  if (open & OPEN_S) {
    ctx.fillStyle = FACE;
    ctx.fillRect(x, y + TILE, TILE, 5);
    ctx.fillStyle = POST;
    ctx.fillRect(x + 3, y + TILE, 3, 8);
    ctx.fillRect(x + TILE - 6, y + TILE, 3, 8);
  }

  // Rails along the sides that face the water, a dark rail with a lit top.
  if (open & OPEN_N) {
    ctx.fillStyle = RAIL;
    ctx.fillRect(x, y, TILE, 3);
    ctx.fillStyle = RAIL_LIT;
    ctx.fillRect(x, y, TILE, 1);
  }
  if (open & OPEN_S) {
    ctx.fillStyle = RAIL;
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.fillStyle = RAIL_LIT;
    ctx.fillRect(x, y + TILE - 3, TILE, 1);
  }
  if (open & OPEN_W) {
    ctx.fillStyle = RAIL;
    ctx.fillRect(x, y, 3, TILE);
    ctx.fillStyle = RAIL_LIT;
    ctx.fillRect(x, y, 1, TILE);
  }
  if (open & OPEN_E) {
    ctx.fillStyle = RAIL;
    ctx.fillRect(x + TILE - 3, y, 3, TILE);
    ctx.fillStyle = RAIL_LIT;
    ctx.fillRect(x + TILE - 3, y, 1, TILE);
  }
}

/** Whether the ground at a tile is open sea, as opposed to land or another span. */
function wet(terrain: Uint8Array, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return true;
  const kind = TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]];
  return !isWalkable(kind);
}

/** Every span in view, top row first so a front face is covered by the row below it. */
export function drawBridges(
  ctx: CanvasRenderingContext2D,
  terrain: Uint8Array,
  view: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const tx0 = Math.max(0, Math.floor(view.minX / TILE) - 1);
  const ty0 = Math.max(0, Math.floor(view.minY / TILE) - 1);
  const tx1 = Math.min(MAP_TILES - 1, Math.floor(view.maxX / TILE) + 1);
  const ty1 = Math.min(MAP_TILES - 1, Math.floor(view.maxY / TILE) + 1);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isBridgeByte(terrain[ty * MAP_TILES + tx])) continue;
      const n = wet(terrain, tx, ty - 1);
      const e = wet(terrain, tx + 1, ty);
      const s = wet(terrain, tx, ty + 1);
      const w = wet(terrain, tx - 1, ty);
      const open = (n ? OPEN_N : 0) | (e ? OPEN_E : 0) | (s ? OPEN_S : 0) | (w ? OPEN_W : 0);
      // A span running east to west has its rails on the north and south, and boards across it.
      drawDeckTile(ctx, tx, ty, open, !(n || s));
    }
  }
}
