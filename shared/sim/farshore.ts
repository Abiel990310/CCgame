import { MAP_TILES, setMapTiles } from './constants';
import { makeRng } from './rng';
import { stampIsland } from './terrain';
import { stampIslandOre, type IslandPatches, type OreField } from './ore';
import { COAST_REACH, FAR_SHORE, FAR_TILES, HOME_TILES } from './regions';
import { placeLandmarkSet, scatterNodes, type TileBox } from './world';
import type { LandmarkKind, World } from './types';

/**
 * What the second island holds. Titanium is the reason to cross: it is found
 * nowhere on the mainland. Coal and a little iron are here too, so an outpost
 * can smelt where it digs instead of hauling every lump home.
 */
const PATCHES: IslandPatches[] = [
  { kind: 'titaniumOre', count: 12, radius: 3.2, richness: 2.6 },
  { kind: 'coal', count: 6, radius: 2.8, richness: 1.6 },
  { kind: 'ironOre', count: 5, radius: 3.0, richness: 1.6 },
];

/**
 * The finds on the island. Every one is a walk from the mainland and over a
 * bridge, so there are fewer than at home and the kinds lean to the good ones.
 */
const LANDMARKS: Array<{ kind: LandmarkKind; count: number; minTiles: number }> = [
  { kind: 'shrine', count: 2, minTiles: 0 },
  { kind: 'pod', count: 3, minTiles: 0 },
  { kind: 'ruin', count: 4, minTiles: 0 },
  { kind: 'cache', count: 4, minTiles: 0 },
];

/** Copy a row-major grid of the old side into the top-left of a bigger one. */
function embed<T extends Uint8Array | Uint16Array>(src: T, from: number, to: number): T {
  const out = new (src.constructor as new (n: number) => T)(to * to);
  for (let y = 0; y < from; y++) out.set(src.subarray(y * from, (y + 1) * from), y * to);
  return out;
}

/**
 * Turn generation 3's island into generation 4's: the same mainland in the
 * corner of a larger sea, and a second island beyond a strait. The mainland is
 * built whole by generation 3 first and only copied across, so its terrain,
 * ore, scenery and landmarks are exactly what a generation 3 island of that
 * seed has. Everything the new island adds comes from streams of its own.
 */
export function growFarShore(home: World, worldgen: number): World {
  const from = MAP_TILES;
  setMapTiles(FAR_TILES);

  home.worldgen = worldgen;
  home.terrain = embed(home.terrain, from, FAR_TILES);
  home.explored = embed(home.explored, from, FAR_TILES);
  home.ore = embed(home.ore, from, FAR_TILES);
  home.oreLeft = embed(home.oreLeft, from, FAR_TILES);
  home.oreMax = embed(home.oreMax, from, FAR_TILES);

  stampIsland(home.terrain, home.seed, FAR_SHORE);
  const field: OreField = { kind: home.ore, left: home.oreLeft };
  stampIslandOre(field, home.terrain, home.seed, FAR_SHORE, PATCHES);
  // What the map held when it was made, which a save diffs against.
  home.oreMax = Uint16Array.from(home.oreLeft);

  const reach = Math.ceil(FAR_SHORE.radius * COAST_REACH);
  const box: TileBox = {
    // Never back over the mainland's columns, whose scenery is already down.
    x0: Math.max(HOME_TILES, FAR_SHORE.cx - reach),
    y0: Math.max(0, FAR_SHORE.cy - reach),
    x1: Math.min(FAR_TILES, FAR_SHORE.cx + reach + 1),
    y1: Math.min(FAR_TILES, FAR_SHORE.cy + reach + 1),
  };
  scatterNodes(home, makeRng(home.seed ^ 0x6a09e667), box);
  placeLandmarkSet(home, makeRng(home.seed ^ 0x510e527f), box, LANDMARKS);
  return home;
}
