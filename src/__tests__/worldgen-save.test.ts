import { beforeEach, describe, expect, it } from 'vitest';
import { addItem } from '@shared/sim/inventory';
import { WORLDGEN, WORLDGEN_TILES, addPlayer, createWorld } from '@shared/sim/world';
import { MAP_TILES } from '@shared/sim/constants';
import type { World } from '@shared/sim/types';
import { forgetSlot, loadWorld, saveWorld, type LoadNotes } from '../save';
import { slotKey } from '../saves';

const SLOT = 'old-ground';

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

function firstOreTile(world: World): number {
  return world.ore.findIndex((kind) => kind !== 0);
}

describe('islands from every worldgen', () => {
  it('regrows an older island with its own generator, size and all', () => {
    // A generation 1 island, saved and then loaded by today's game.
    const world = createWorld(4242, true, 1);
    const player = addPlayer(world, 'You');
    addItem(player, 'wood', 50);
    addItem(player, 'stone', 50);

    const felled = world.nodes[7];
    world.nodes = world.nodes.filter((n) => n.id !== felled.id);
    const tile = firstOreTile(world);
    world.oreLeft[tile] = 3;
    saveWorld(world, SLOT);
    expect(JSON.parse(store.get(slotKey(SLOT))!).worldgen).toBe(1);

    // Something else grows a new-generation island in between, as the menu does.
    createWorld(99);
    expect(MAP_TILES).toBe(WORLDGEN_TILES[WORLDGEN]);

    const notes: LoadNotes = {};
    const back = loadWorld(SLOT, notes)!;
    expect(notes.regenerated).toBe(false);
    expect(back.worldgen).toBe(1);
    expect(MAP_TILES).toBe(WORLDGEN_TILES[1]);
    expect(back.terrain.length).toBe(WORLDGEN_TILES[1] ** 2);
    // Its own deltas land on the ground they were written against.
    expect(back.nodes.some((n) => n.id === felled.id)).toBe(false);
    expect(back.oreLeft[tile]).toBe(3);
    expect(back.buildings.length).toBe(world.buildings.length);
    expect([...back.players.values()][0].inventory).toEqual(player.inventory);
  });

  it('keeps the deltas of an island grown by the current one', () => {
    const world = createWorld(4242, true);
    addPlayer(world, 'You');
    const felled = world.nodes[7];
    world.nodes = world.nodes.filter((n) => n.id !== felled.id);
    saveWorld(world, SLOT);

    const notes: LoadNotes = {};
    const back = loadWorld(SLOT, notes)!;
    expect(notes.regenerated).toBe(false);
    expect(back.nodes.some((n) => n.id === felled.id)).toBe(false);
  });
});
