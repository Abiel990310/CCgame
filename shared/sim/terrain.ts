import { MAP_TILES, TILE } from './constants';
import { fbm } from './rng';
import type { Terrain, Vec2 } from './types';

export const TERRAIN_ORDER: Terrain[] = ['deep', 'water', 'sand', 'grass', 'forest', 'rock'];

export function terrainAtIndex(terrain: Uint8Array, tx: number, ty: number): Terrain {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return 'deep';
  return TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]] ?? 'deep';
}

export function terrainAt(terrain: Uint8Array, pos: Vec2): Terrain {
  return terrainAtIndex(terrain, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE));
}

export function isWalkable(t: Terrain): boolean {
  return t !== 'deep' && t !== 'water';
}

/**
 * Island shape: fbm noise multiplied by a radial falloff, so the landmass is
 * always a single island ringed by beach and open water regardless of seed.
 */
export function generateTerrain(seed: number): Uint8Array {
  const grid = new Uint8Array(MAP_TILES * MAP_TILES);
  const half = MAP_TILES / 2;

  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const nx = (tx - half) / half;
      const ny = (ty - half) / half;
      const dist = Math.hypot(nx, ny);

      const base = fbm(tx * 0.055, ty * 0.055, seed, 5);
      const detail = fbm(tx * 0.16, ty * 0.16, seed + 7777, 3);

      // Smooth radial falloff: 1 at the centre, 0 past the rim.
      const falloff = Math.max(0, 1 - Math.pow(dist * 1.08, 2.6));
      const height = base * 0.72 + detail * 0.28;
      const value = height * falloff * 1.55;

      let kind: Terrain;
      if (value < 0.2) kind = 'deep';
      else if (value < 0.31) kind = 'water';
      else if (value < 0.38) kind = 'sand';
      else if (value < 0.62) kind = 'grass';
      else if (value < 0.78) kind = 'forest';
      else kind = 'rock';

      grid[ty * MAP_TILES + tx] = TERRAIN_ORDER.indexOf(kind);
    }
  }

  carveCamp(grid, seed);
  return grid;
}

/** Guarantee a flat, walkable clearing at the island's heart for the camp. */
function carveCamp(grid: Uint8Array, _seed: number): void {
  const half = Math.floor(MAP_TILES / 2);
  const radius = 6;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.hypot(dx, dy) > radius) continue;
      const tx = half + dx;
      const ty = half + dy;
      grid[ty * MAP_TILES + tx] = TERRAIN_ORDER.indexOf('grass');
    }
  }
}

/** True when the tile is land bordering water — where fishing spots belong. */
export function isShore(terrain: Uint8Array, tx: number, ty: number): boolean {
  if (!isWalkable(terrainAtIndex(terrain, tx, ty))) return false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const n = terrainAtIndex(terrain, tx + dx, ty + dy);
    if (n === 'water' || n === 'deep') return true;
  }
  return false;
}
