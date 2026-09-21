import { MAP_TILES } from './constants';
import { makeRng } from './rng';
import { isWalkable, terrainAtIndex } from './terrain';
import { tileKey } from './grid';
import type { OreKind } from './types';

/** Index 0 is "no ore", so a zeroed grid means a bare island. */
export const ORE_ORDER: Array<OreKind | null> = [null, 'ironOre', 'copperOre', 'coal'];

export function oreAt(ore: Uint8Array, tx: number, ty: number): OreKind | null {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return null;
  return ORE_ORDER[ore[tileKey(tx, ty)]] ?? null;
}

interface PatchPlan {
  kind: OreKind;
  count: number;
  radius: number;
  /** Patches of this kind are kept at least this far from the camp. */
  minFromCamp: number;
}

/**
 * Ore is placed as discrete blobs rather than noise. Patches are the unit a
 * player reasons about — "that iron patch over there" — and a finite patch is
 * what eventually pushes them to expand outward, which is the long game.
 */
const PLAN: PatchPlan[] = [
  { kind: 'ironOre', count: 9, radius: 3.4, minFromCamp: 6 },
  { kind: 'copperOre', count: 7, radius: 3.0, minFromCamp: 8 },
  { kind: 'coal', count: 6, radius: 2.8, minFromCamp: 10 },
];

export function generateOre(terrain: Uint8Array, seed: number): Uint8Array {
  const ore = new Uint8Array(MAP_TILES * MAP_TILES);
  const rng = makeRng(seed ^ 0x2f8a19b3);
  const half = MAP_TILES / 2;

  for (const patch of PLAN) {
    const index = ORE_ORDER.indexOf(patch.kind);
    let placed = 0;
    let guard = 0;

    while (placed < patch.count && guard++ < 4000) {
      const cx = Math.floor(rng() * MAP_TILES);
      const cy = Math.floor(rng() * MAP_TILES);

      if (Math.hypot(cx - half, cy - half) < patch.minFromCamp) continue;
      if (!isWalkable(terrainAtIndex(terrain, cx, cy))) continue;

      // Reject a patch that would sit mostly on water, so it stays minable.
      if (!patchFits(terrain, cx, cy, patch.radius)) continue;

      stampPatch(ore, terrain, cx, cy, patch.radius, index, rng);
      placed++;
    }
  }

  return ore;
}

function patchFits(terrain: Uint8Array, cx: number, cy: number, radius: number): boolean {
  let land = 0;
  let total = 0;
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > radius) continue;
      total++;
      if (isWalkable(terrainAtIndex(terrain, cx + dx, cy + dy))) land++;
    }
  }
  return total > 0 && land / total > 0.8;
}

function stampPatch(
  ore: Uint8Array,
  terrain: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
  index: number,
  rng: () => number,
): void {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      // Ragged edges: the further out, the likelier a tile is skipped.
      if (rng() < (dist / radius) * 0.55) continue;

      const tx = cx + dx;
      const ty = cy + dy;
      if (!isWalkable(terrainAtIndex(terrain, tx, ty))) continue;
      ore[tileKey(tx, ty)] = index;
    }
  }
}
