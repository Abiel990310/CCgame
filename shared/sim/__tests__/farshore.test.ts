import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../data/items';
import { MAP_TILES } from '../constants';
import { ORE_ORDER } from '../ore';
import { COAST_REACH, FAR_SHORE, FAR_TILES, HOME_TILES } from '../regions';
import { isWalkable, terrainAtIndex } from '../terrain';
import { createWorld } from '../world';

const SEEDS = [1, 7, 99, 2026, 4242, 65535];

const onHome = (tx: number, ty: number): boolean => tx < HOME_TILES && ty < HOME_TILES;

/** Chebyshev steps from the nearest tile of the mainland to every tile of the map. */
function distanceFromHome(terrain: Uint8Array): Int32Array {
  const dist = new Int32Array(FAR_TILES * FAR_TILES).fill(-1);
  const queue: number[] = [];
  for (let ty = 0; ty < HOME_TILES; ty++) {
    for (let tx = 0; tx < HOME_TILES; tx++) {
      if (!isWalkable(terrainAtIndex(terrain, tx, ty))) continue;
      dist[ty * FAR_TILES + tx] = 0;
      queue.push(ty * FAR_TILES + tx);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    const tx = at % FAR_TILES;
    const ty = (at - tx) / FAR_TILES;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= FAR_TILES || ny >= FAR_TILES) continue;
        if (dist[ny * FAR_TILES + nx] >= 0) continue;
        dist[ny * FAR_TILES + nx] = dist[at] + 1;
        queue.push(ny * FAR_TILES + nx);
      }
    }
  }
  return dist;
}

describe('the far shore', () => {
  it('grows the mainland of generation 3 unchanged, in the corner of a larger sea', () => {
    for (const seed of SEEDS) {
      const old = createWorld(seed, false, 3);
      const oldTerrain = old.terrain;
      const oldOre = old.ore;
      const oldLeft = old.oreLeft;
      const oldNodes = old.nodes;
      const oldCamp = { ...old.camp };

      const fresh = createWorld(seed, false, 4);
      expect(MAP_TILES).toBe(FAR_TILES);
      expect(fresh.camp).toEqual(oldCamp);

      for (let ty = 0; ty < HOME_TILES; ty++) {
        for (let tx = 0; tx < HOME_TILES; tx++) {
          const i = ty * FAR_TILES + tx;
          const j = ty * HOME_TILES + tx;
          if (fresh.terrain[i] !== oldTerrain[j] || fresh.ore[i] !== oldOre[j] || fresh.oreLeft[i] !== oldLeft[j]) {
            throw new Error(`seed ${seed}: tile ${tx},${ty} differs from generation 3`);
          }
        }
      }
      // Every tree, rock and landmark the mainland had stands where it did, with the same id.
      expect(fresh.nodes.slice(0, oldNodes.length)).toEqual(oldNodes);
      expect(fresh.nodes.length).toBeGreaterThan(oldNodes.length);
    }
  });

  it('builds the same island every time from a seed', () => {
    const a = createWorld(4242);
    const b = createWorld(4242);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.ore).toEqual(b.ore);
    expect(a.nodes).toEqual(b.nodes);
  });

  it('raises a real island with its own scenery and landmarks', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      let land = 0;
      for (let ty = 0; ty < FAR_TILES; ty++) {
        for (let tx = HOME_TILES; tx < FAR_TILES; tx++) {
          if (isWalkable(terrainAtIndex(world.terrain, tx, ty))) land++;
        }
      }
      // A radius of 46 would be about 6,600 tiles of land if it were a disc.
      expect(land, `seed ${seed}`).toBeGreaterThan(3000);

      const there = world.nodes.filter((n) => n.pos.x / 32 >= HOME_TILES);
      expect(there.length, `seed ${seed}`).toBeGreaterThan(100);
      const finds = there.filter((n) => RESOURCES[n.kind].landmark);
      expect(finds.length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      // The far island is wilder: more of its finds are guarded.
      expect(finds.some((n) => RESOURCES[n.kind].landmark?.guards), `seed ${seed}`).toBe(true);
    }
  });

  it('holds the only titanium, and plenty of it', () => {
    const titanium = ORE_ORDER.indexOf('titaniumOre');
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      let home = 0;
      let far = 0;
      for (let i = 0; i < world.ore.length; i++) {
        if (world.ore[i] !== titanium) continue;
        if (onHome(i % FAR_TILES, Math.floor(i / FAR_TILES))) home++;
        else far++;
      }
      expect(home, `seed ${seed}`).toBe(0);
      expect(far, `seed ${seed}`).toBeGreaterThan(80);
    }
  });

  it('keeps the strait wider than a grappling hook throws and narrow enough to bridge', () => {
    for (const seed of SEEDS) {
      const world = createWorld(seed);
      const dist = distanceFromHome(world.terrain);
      let nearest = Infinity;
      for (let ty = 0; ty < FAR_TILES; ty++) {
        for (let tx = HOME_TILES; tx < FAR_TILES; tx++) {
          if (!isWalkable(terrainAtIndex(world.terrain, tx, ty))) continue;
          nearest = Math.min(nearest, dist[ty * FAR_TILES + tx]);
        }
      }
      // The hook leaps 320 world units, ten tiles.
      expect(nearest, `seed ${seed}`).toBeGreaterThan(12);
      expect(nearest, `seed ${seed}`).toBeLessThan(48);
    }
  });

  it('puts the island on the map, with room around it', () => {
    expect(FAR_SHORE.cx + FAR_SHORE.radius * COAST_REACH).toBeLessThan(FAR_TILES);
    expect(FAR_SHORE.cx - FAR_SHORE.radius * COAST_REACH).toBeGreaterThan(HOME_TILES);
  });
});
