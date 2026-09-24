import { MAP_TILES, TILE } from './constants';
import { perk } from './perks';
import type { World } from './types';

/**
 * How far a player sees, in tiles: about half a screen, so the map fills in
 * with what the player actually walked past rather than a vague blob.
 */
export const EXPLORE_RADIUS = 11;
/** Marking a disc of tiles is cheap, but there is no need to do it every tick. */
const EXPLORE_TICKS = 6;

/** Mark every tile within `radius` of a point as seen. True if any were new. */
export function reveal(world: World, x: number, y: number, radius = EXPLORE_RADIUS): boolean {
  const cx = Math.floor(x / TILE);
  const cy = Math.floor(y / TILE);
  const r2 = radius * radius;
  let fresh = false;
  for (let dy = -radius; dy <= radius; dy++) {
    const ty = cy + dy;
    if (ty < 0 || ty >= MAP_TILES) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = cx + dx;
      if (tx < 0 || tx >= MAP_TILES || dx * dx + dy * dy > r2) continue;
      const i = ty * MAP_TILES + tx;
      if (world.explored[i] === 0) {
        world.explored[i] = 1;
        fresh = true;
      }
    }
  }
  return fresh;
}

export function stepExploration(world: World): void {
  if (world.tick % EXPLORE_TICKS !== 0) return;
  for (const player of world.players.values()) {
    reveal(world, player.pos.x, player.pos.y, EXPLORE_RADIUS + 3 * perk(player, 'explorer'));
  }
}

/** Share of the island's land a player has seen, from 0 to 1. */
export function exploredShare(world: World): number {
  let land = 0;
  let seen = 0;
  for (let i = 0; i < world.terrain.length; i++) {
    // Terrain order puts deep and shallow water first.
    if (world.terrain[i] < 2) continue;
    land++;
    if (world.explored[i]) seen++;
  }
  return land === 0 ? 0 : seen / land;
}

/**
 * The explored mask as text for a save: run lengths of alternating unseen and
 * seen tiles. Exploration spreads out in blobs, so this stays a few kilobytes
 * even for a well-walked island.
 */
export function packExplored(explored: Uint8Array): string {
  const runs: number[] = [];
  let value = 0;
  let run = 0;
  for (let i = 0; i < explored.length; i++) {
    const v = explored[i] ? 1 : 0;
    if (v === value) run++;
    else {
      runs.push(run);
      value = v;
      run = 1;
    }
  }
  runs.push(run);
  return runs.map((n) => n.toString(36)).join('.');
}

export function unpackExplored(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0;
  let value = 0;
  for (const part of text.split('.')) {
    const n = parseInt(part, 36);
    if (!(n >= 0)) break;
    if (value) out.fill(1, i, Math.min(size, i + n));
    i += n;
    value ^= 1;
  }
  return out;
}
