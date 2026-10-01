import { describe, expect, it } from 'vitest';
import { MACHINES, placementCost } from '../../data/machines';
import { TECH_BY_ID } from '../../data/techs';
import { applyOrder } from '../commands';
import { TILE } from '../constants';
import { factoryPlacementError, placeBelt, removeAt, type FactoryError } from '../factory';
import { tileKey } from '../grid';
import { addItem, countItem } from '../inventory';
import { FAR_TILES, HOME_TILES } from '../regions';
import { isUnlocked } from '../research';
import { BRIDGE_OVER_DEEP, BRIDGE_OVER_WATER, isWalkable, terrainAtIndex } from '../terrain';
import { EMPTY_INPUT, step } from '../step';
import { makeSlots } from '../slots';
import { addPlayer, createWorld } from '../world';
import { at, bench } from './bench';

const WATER = 1;
const DEEP = 0;

/**
 * A strait three tiles wide across the bench, columns 4 to 9, with land at both
 * ends and either side. Its middle row is row 2, and is where the tests build.
 */
function strait(b: ReturnType<typeof bench>, kinds: number[] = [WATER, WATER, WATER, DEEP, DEEP, WATER]): void {
  for (let dy = 1; dy <= 3; dy++) {
    kinds.forEach((kind, i) => {
      b.world.terrain[tileKey(at(4 + i, dy).tx, at(4 + i, dy).ty)] = kind;
    });
  }
}

const lay = (b: ReturnType<typeof bench>, dx: number, dy: number): boolean => {
  const { tx, ty } = at(dx, dy);
  return applyOrder(b.world, { p: b.player.id, c: { k: 'machine', what: 'bridge', tx, ty, dir: 0 } }) === true;
};

describe('a bridge', () => {
  it('goes over water from the shore, one span at a time', () => {
    const b = bench();
    strait(b);
    const { ty } = at(0, 2);

    expect(lay(b, 4, 2)).toBe(true);
    expect(b.world.terrain[tileKey(at(4, 2).tx, ty)]).toBe(BRIDGE_OVER_WATER);
    // Each span is the shore for the next.
    expect(lay(b, 5, 2)).toBe(true);
    expect(lay(b, 6, 2)).toBe(true);
    // Open deep water takes a span too, and remembers it was deep.
    expect(lay(b, 7, 2)).toBe(true);
    expect(b.world.terrain[tileKey(at(7, 2).tx, ty)]).toBe(BRIDGE_OVER_DEEP);
  });

  it('refuses to float free of the shore, to cover ground, or to overbuild', () => {
    const b = bench();
    strait(b);
    const stand = (dx: number): FactoryError => factoryPlacementError(b.world, b.player, 'bridge', at(dx, 2).tx, at(dx, 2).ty);

    expect(stand(6)).toBe('anchor');
    // Ground needs no bridge.
    expect(stand(3)).toBe('water');
    expect(lay(b, 4, 2)).toBe(true);
    // A span already down is not water any more.
    expect(stand(4)).toBe('water');
    expect(lay(b, 4, 2)).toBe(false);
  });

  it('costs materials, and is refused without them', () => {
    const b = bench();
    strait(b);
    const wood = countItem(b.player, 'wood');
    const plates = countItem(b.player, 'ironPlate');
    expect(lay(b, 4, 2)).toBe(true);
    for (const { id, count } of placementCost('bridge')) {
      expect(countItem(b.player, id)).toBe((id === 'wood' ? wood : plates) - count);
    }

    for (const { id } of placementCost('bridge')) b.player.inventory = b.player.inventory.map((s) => (s && s.id === id ? null : s));
    const { tx, ty } = at(5, 2);
    expect(factoryPlacementError(b.world, b.player, 'bridge', tx, ty)).toBe('cost');
    expect(lay(b, 5, 2)).toBe(false);
  });

  it('is earned by researching causeways', () => {
    const b = bench();
    strait(b);
    b.world.research.unlockedAll = false;
    const { tx, ty } = at(4, 2);
    expect(isUnlocked(b.world, 'bridge')).toBe(false);
    expect(factoryPlacementError(b.world, b.player, 'bridge', tx, ty)).toBe('locked');
    expect(lay(b, 4, 2)).toBe(false);

    b.world.research.levels[TECH_BY_ID.get('causeways')!.id] = 1;
    expect(isUnlocked(b.world, 'bridge')).toBe(true);
    expect(lay(b, 4, 2)).toBe(true);
  });

  it('can be walked across, and a belt can be laid along it', () => {
    const b = bench();
    strait(b);
    for (let dx = 4; dx <= 9; dx++) expect(lay(b, dx, 2)).toBe(true);

    const start = at(2, 2);
    b.player.pos = { x: (start.tx + 0.5) * TILE, y: (start.ty + 0.5) * TILE };
    const east = new Map([[b.player.id, { ...EMPTY_INPUT, move: { x: 1, y: 0 } }]]);
    for (let i = 0; i < 90; i++) step(b.world, east);
    // Three tiles of wading would have stopped at the shore.
    expect(Math.floor(b.player.pos.x / TILE)).toBeGreaterThan(at(9, 2).tx);

    for (let dx = 4; dx <= 9; dx++) {
      const { tx, ty } = at(dx, 2);
      expect(placeBelt(b.world, b.player, tx, ty, 0)).not.toBe(null);
    }
  });

  it('comes back up, putting the right sea under it and returning its cost', () => {
    const b = bench();
    strait(b);
    const { tx: shallow, ty } = at(4, 2);
    const deep = at(7, 2).tx;
    for (let dx = 4; dx <= 7; dx++) lay(b, dx, 2);
    const wood = countItem(b.player, 'wood');

    // Stand somewhere else, so the deck is empty.
    b.player.pos = { x: (at(1, 5).tx + 0.5) * TILE, y: (at(1, 5).ty + 0.5) * TILE };
    expect(removeAt(b.world, b.player, deep, ty)).toBe(true);
    expect(removeAt(b.world, b.player, shallow + 3, ty)).toBe(false);
    expect(b.world.terrain[tileKey(deep, ty)]).toBe(DEEP);
    expect(countItem(b.player, 'wood')).toBe(wood + placementCost('bridge')[0].count);
    expect(removeAt(b.world, b.player, shallow + 2, ty)).toBe(true);
    expect(b.world.terrain[tileKey(shallow + 2, ty)]).toBe(WATER);
    // Gone, the tile is sea again: not walkable, and not anything to take up twice.
    expect(isWalkable(terrainAtIndex(b.world.terrain, shallow + 2, ty))).toBe(false);
    expect(removeAt(b.world, b.player, shallow + 2, ty)).toBe(false);
  });

  it('will not come up from under a belt, or from under someone standing on it', () => {
    const b = bench();
    strait(b);
    const { tx, ty } = at(4, 2);
    lay(b, 4, 2);
    placeBelt(b.world, b.player, tx, ty, 0);
    // The first removal takes the belt, and only the second the deck.
    expect(removeAt(b.world, b.player, tx, ty)).toBe(true);
    expect(isWalkable(terrainAtIndex(b.world.terrain, tx, ty))).toBe(true);

    b.player.pos = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    expect(removeAt(b.world, b.player, tx, ty)).toBe(false);
    b.player.pos = { x: (tx - 2.5) * TILE, y: (ty + 0.5) * TILE };
    expect(removeAt(b.world, b.player, tx, ty)).toBe(true);
  });

  it('is a command like any other, so it survives replay', () => {
    expect(MACHINES.bridge.solid).toBe(false);
    const b = bench();
    strait(b);
    const bad = applyOrder(b.world, { p: b.player.id, c: { k: 'machine', what: 'bridge', tx: 1.5, ty: 2, dir: 0 } });
    expect(bad).toBe(false);
  });
});

describe('crossing to the far shore', () => {
  it('takes a bridge of a few dozen tiles from the mainland to the island', () => {
    for (const seed of [1, 4242, 65535]) {
      const world = createWorld(seed, true);
      world.research.unlockedAll = true;
      const player = stockedBuilder(world);

      // The shortest run of water tiles from the mainland's land to the island's.
      const n = FAR_TILES;
      const prev = new Int32Array(n * n).fill(-2);
      const queue = walkableFrom(world, Math.floor(world.camp.x / TILE), Math.floor(world.camp.y / TILE));
      for (const at of queue) prev[at] = -1;
      let goal = -1;
      for (let head = 0; head < queue.length && goal < 0; head++) {
        const at = queue[head];
        const tx = at % n;
        const ty = (at - tx) / n;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n || prev[ny * n + nx] !== -2) continue;
          prev[ny * n + nx] = at;
          if (nx >= HOME_TILES && isWalkable(terrainAtIndex(world.terrain, nx, ny))) {
            goal = ny * n + nx;
            break;
          }
          if (!isWalkable(terrainAtIndex(world.terrain, nx, ny))) queue.push(ny * n + nx);
        }
      }
      expect(goal, `seed ${seed}`).toBeGreaterThanOrEqual(0);

      const path: number[] = [];
      for (let at = prev[goal]; prev[at] !== -1; at = prev[at]) path.unshift(at);
      expect(path.length, `seed ${seed}`).toBeGreaterThan(12);
      expect(path.length, `seed ${seed}`).toBeLessThan(60);

      for (const at of path) {
        const tx = at % n;
        const ty = (at - tx) / n;
        const placed = applyOrder(world, { p: player.id, c: { k: 'machine', what: 'bridge', tx, ty, dir: 0 } });
        expect(placed, `seed ${seed} span ${tx},${ty}`).toBe(true);
      }

      // Walkable from the camp all the way to the island's shore.
      const reach = walkableFrom(world, Math.floor(world.camp.x / TILE), Math.floor(world.camp.y / TILE));
      expect(reach.includes(goal), `seed ${seed}`).toBe(true);
    }
  });
});

/** Every tile a body could walk to from a tile, as map indices. */
function walkableFrom(world: ReturnType<typeof createWorld>, sx: number, sy: number): number[] {
  const n = FAR_TILES;
  const seen = new Uint8Array(n * n);
  const out = [sy * n + sx];
  seen[out[0]] = 1;
  for (let head = 0; head < out.length; head++) {
    const at = out[head];
    const tx = at % n;
    const ty = (at - tx) / n;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen[ny * n + nx]) continue;
      if (!isWalkable(terrainAtIndex(world.terrain, nx, ny))) continue;
      seen[ny * n + nx] = 1;
      out.push(ny * n + nx);
    }
  }
  return out;
}

/** A builder with a full purse, added through the door the game uses. */
function stockedBuilder(world: ReturnType<typeof createWorld>) {
  const p = addPlayer(world, 'Builder');
  p.inventory = makeSlots(40);
  addItem(p, 'wood', 999);
  addItem(p, 'ironPlate', 999);
  return p;
}
