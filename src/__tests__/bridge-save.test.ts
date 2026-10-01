import { beforeEach, describe, expect, it } from 'vitest';
import { placeBridge } from '@shared/sim/bridge';
import { addItem } from '@shared/sim/inventory';
import { tileKey } from '@shared/sim/grid';
import { BRIDGE_OVER_DEEP, BRIDGE_OVER_WATER, isBridgeByte, isWalkable, terrainAtIndex } from '@shared/sim/terrain';
import type { World } from '@shared/sim/types';
import { addPlayer, createWorld } from '@shared/sim/world';
import { MAP_TILES } from '@shared/sim/constants';
import { forgetSlot, loadWorld, saveWorld } from '../save';
import { BRIDGE_SUFFIX, slotKey } from '../saves';

const SLOT = 'spans';

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;
  forgetSlot(SLOT);
});

/** Lay `count` spans out from the first shore found, each beside the last. Returns their tiles. */
function bridgeOut(world: World, count: number): number[] {
  const player = [...world.players.values()][0];
  const laid: number[] = [];
  for (let n = 0; n < count; n++) {
    let done = false;
    for (let ty = 1; ty < MAP_TILES - 1 && !done; ty++) {
      for (let tx = 1; tx < MAP_TILES - 1 && !done; tx++) {
        if (isWalkable(terrainAtIndex(world.terrain, tx, ty))) continue;
        if (isBridgeByte(world.terrain[tileKey(tx, ty)])) continue;
        if (placeBridge(world, player, 'bridge', tx, ty)) {
          laid.push(tileKey(tx, ty));
          done = true;
        }
      }
    }
  }
  return laid;
}

describe('spans in a save', () => {
  it('are written down and laid back over the regrown sea', () => {
    const world = createWorld(4242, true);
    const player = addPlayer(world, 'You');
    addItem(player, 'wood', 200);
    addItem(player, 'ironPlate', 200);
    world.research.unlockedAll = true;
    const laid = bridgeOut(world, 6);
    expect(laid).toHaveLength(6);
    saveWorld(world, SLOT);

    const back = loadWorld(SLOT)!;
    expect(back.terrain).toEqual(world.terrain);
    for (const key of laid) expect([BRIDGE_OVER_WATER, BRIDGE_OVER_DEEP]).toContain(back.terrain[key]);
  });

  it('write nothing but an empty list on an island with none, and load one with no section', () => {
    const world = createWorld(4242, true);
    addPlayer(world, 'You');
    saveWorld(world, SLOT);
    expect(JSON.parse(store.get(slotKey(SLOT) + BRIDGE_SUFFIX)!)).toEqual([]);

    // An island saved before spans existed has no such entry at all.
    store.delete(slotKey(SLOT) + BRIDGE_SUFFIX);
    forgetSlot(SLOT);
    const back = loadWorld(SLOT)!;
    expect(back.terrain).toEqual(createWorld(4242, true).terrain);
  });

  it('never lay a span over ground, or past the map', () => {
    const world = createWorld(4242, true);
    addPlayer(world, 'You');
    saveWorld(world, SLOT);
    const land = world.terrain.findIndex((t) => t > 1 && t < 6);
    store.set(slotKey(SLOT) + BRIDGE_SUFFIX, JSON.stringify([[land, BRIDGE_OVER_WATER], [world.terrain.length + 5, 6], ['x', 6], [3, 99], 'junk']));
    forgetSlot(SLOT);
    const back = loadWorld(SLOT)!;
    expect(back.terrain).toEqual(createWorld(4242, true).terrain);
  });
});
