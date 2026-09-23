import { MAP_TILES, ORE } from './constants';
import { hash2, makeRng } from './rng';
import { isWalkable, terrainAtIndex } from './terrain';
import { tileKey } from './grid';
import type { Machine, OreKind, World } from './types';

/** Index 0 is "no ore", so a zeroed grid means a bare island. */
export const ORE_ORDER: Array<OreKind | null> = [null, 'ironOre', 'copperOre', 'coal'];

/** A generated field: what each tile holds, and how much of it is left. */
export interface OreField {
  kind: Uint8Array;
  left: Uint16Array;
}

export function oreAt(ore: Uint8Array, tx: number, ty: number): OreKind | null {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return null;
  return ORE_ORDER[ore[tileKey(tx, ty)]] ?? null;
}

export function oreLeftAt(world: World, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return 0;
  return world.oreLeft[tileKey(tx, ty)];
}

/**
 * How full a tile looks, from 0 (bare) to 4 (untouched centre of a patch).
 *
 * The renderer draws one step of thinning per band and the simulation only
 * reports a change when a tile crosses one, so a tile is repainted four times
 * over its whole life rather than once per ore pulled out of it. Ore is baked
 * into the cached ground, and repainting that is the expensive thing here.
 */
export function oreBand(left: number): number {
  if (left <= 0) return 0;
  if (left >= ORE.tileAmount * 0.75) return 4;
  if (left >= ORE.tileAmount * 0.5) return 3;
  if (left >= ORE.tileAmount * 0.25) return 2;
  return 1;
}

/**
 * Take one ore out of a tile. Emptying it clears the kind as well, so every
 * existing reader — placement, the renderer, the miner — sees bare ground
 * without having to learn about amounts.
 */
export function takeOre(world: World, tx: number, ty: number): boolean {
  const key = tileKey(tx, ty);
  const before = world.oreLeft[key];
  if (before <= 0) return false;

  const after = before - 1;
  world.oreLeft[key] = after;
  if (after === 0) world.ore[key] = 0;
  if (oreBand(after) !== oreBand(before)) world.events.push({ kind: 'oreChanged', tx, ty });
  return true;
}

/**
 * The tile a miner pulls its next ore from: the one it stands on while that
 * still has any, then the ring around it, in a fixed order so a patch hollows
 * out one tile at a time rather than thinning everywhere at once.
 */
export function minerSource(world: World, machine: Machine, kind: OreKind): { tx: number; ty: number } | null {
  if (oreAt(world.ore, machine.tx, machine.ty) === kind) {
    return { tx: machine.tx, ty: machine.ty };
  }

  const reach = ORE.minerReach;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (dx === 0 && dy === 0) continue;
      const tx = machine.tx + dx;
      const ty = machine.ty + dy;
      if (oreAt(world.ore, tx, ty) === kind) return { tx, ty };
    }
  }
  return null;
}

/** Ore of the miner's own kind still within its reach, for the machine screen. */
export function minerOreLeft(world: World, machine: Machine): number {
  const kind = machine.ore ?? oreAt(world.ore, machine.tx, machine.ty);
  if (!kind) return 0;

  const reach = ORE.minerReach;
  let total = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const tx = machine.tx + dx;
      const ty = machine.ty + dy;
      if (oreAt(world.ore, tx, ty) === kind) total += oreLeftAt(world, tx, ty);
    }
  }
  return total;
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

export function generateOre(terrain: Uint8Array, seed: number): OreField {
  const field: OreField = {
    kind: new Uint8Array(MAP_TILES * MAP_TILES),
    left: new Uint16Array(MAP_TILES * MAP_TILES),
  };
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

      stampPatch(field, terrain, cx, cy, patch.radius, index, rng, seed);
      placed++;
    }
  }

  return field;
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
  field: OreField,
  terrain: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
  index: number,
  rng: () => number,
  seed: number,
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
      const key = tileKey(tx, ty);
      field.kind[key] = index;
      field.left[key] = tileAmount(dist / radius, tx, ty, seed);
    }
  }
}

/**
 * A patch is richest at its centre and thin at the rim, so it is worth mining
 * inward and it visibly wears away from the edges.
 *
 * The jitter comes from a hash rather than the patch's own generator: the
 * sequence of `rng()` calls above is what decides where every later patch on
 * the island lands, so drawing from it here would move the ore under the
 * miners on every island already saved.
 */
function tileAmount(edge: number, tx: number, ty: number, seed: number): number {
  const richness = ORE.edgeShare + (1 - ORE.edgeShare) * (1 - edge);
  const jitter = 0.88 + hash2(tx, ty, seed ^ 0x6b1f) * 0.24;
  return Math.max(1, Math.round(ORE.tileAmount * richness * jitter));
}
