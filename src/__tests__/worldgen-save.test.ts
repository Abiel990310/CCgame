import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addItem } from '@shared/sim/inventory';
import { addPlayer, createWorld } from '@shared/sim/world';
import type { World } from '@shared/sim/types';
import { forgetSlot, loadWorld, saveWorld, type LoadNotes } from '../save';
import { slotKey } from '../saves';

// Pretend worldgen has moved on since generation 1, which is the only way to
// load an island grown by an older one while there has only ever been one.
vi.mock('@shared/sim/world', async (original) => ({
  ...(await original<typeof import('@shared/sim/world')>()),
  WORLDGEN: 2,
}));

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

describe('an island grown by an older worldgen', () => {
  it('takes the new ground whole and keeps what was built', () => {
    const world = createWorld(4242, true);
    const player = addPlayer(world, 'You');
    addItem(player, 'wood', 50);
    addItem(player, 'stone', 50);

    const felled = world.nodes[7];
    world.nodes = world.nodes.filter((n) => n.id !== felled.id);
    const tile = firstOreTile(world);
    world.oreLeft[tile] = 3;
    saveWorld(world, SLOT);

    // Rewrite it as an island saved under generation 1.
    const header = JSON.parse(store.get(slotKey(SLOT))!);
    expect(header.worldgen).toBe(2);
    header.worldgen = 1;
    store.set(slotKey(SLOT), JSON.stringify(header));

    const notes: LoadNotes = {};
    const back = loadWorld(SLOT, notes)!;
    expect(notes.regenerated).toBe(true);
    // The old deltas are not laid over ground they do not describe.
    expect(back.nodes.some((n) => n.id === felled.id)).toBe(true);
    expect(back.oreLeft[tile]).toBe(back.oreMax[tile]);
    // Buildings, the bag and progress are the player's, not the generator's.
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
