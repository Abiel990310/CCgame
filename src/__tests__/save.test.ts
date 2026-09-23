import { beforeEach, describe, expect, it } from 'vitest';
import { placeBelt, placeMachine, setFilter, setRecipe } from '@shared/sim/factory';
import { addItem } from '@shared/sim/inventory';
import { addToSlots } from '@shared/sim/slots';
import { tileKey } from '@shared/sim/grid';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import { addPlayer, createWorld } from '@shared/sim/world';
import type { ItemId, World } from '@shared/sim/types';
import { forgetSlot, loadWorld, saveWorld } from '../save';
import { FACTORY_SUFFIX, SCENERY_SUFFIX, slotKey } from '../saves';

/** Counts writes as well as holding them, since skipping one is the point. */
function installStorage(): { store: Map<string, string>; writes: string[] } {
  const store = new Map<string, string>();
  const writes: string[] = [];
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      writes.push(k);
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;
  return { store, writes };
}

const SLOT = 'island';
/** Clear of the camp, and flattened below so anything will fit. */
const SITE = { tx: 20, ty: 60 };

let store: Map<string, string>;
let writes: string[];
beforeEach(() => {
  ({ store, writes } = installStorage());
  forgetSlot(SLOT);
});

function island(seed = 4242): World {
  const world = createWorld(seed, true);
  const player = addPlayer(world, 'You');
  for (const item of ['wood', 'stone', 'ironPlate'] as ItemId[]) addItem(player, item, 900);

  const grass = TERRAIN_ORDER.indexOf('grass');
  for (let ty = SITE.ty; ty < SITE.ty + 4; ty++) {
    for (let tx = SITE.tx; tx < SITE.tx + 8; tx++) {
      world.terrain[tileKey(tx, ty)] = grass;
      world.ore[tileKey(tx, ty)] = 0;
    }
  }
  // Scenery blocks placement, so clear the strip the factory tests build on.
  world.nodes = world.nodes.filter(
    (n) =>
      Math.floor(n.pos.x / 32) < SITE.tx ||
      Math.floor(n.pos.x / 32) >= SITE.tx + 8 ||
      Math.floor(n.pos.y / 32) < SITE.ty ||
      Math.floor(n.pos.y / 32) >= SITE.ty + 4,
  );
  return world;
}

function bytes(): number {
  return [...store.values()].reduce((total, text) => total + text.length, 0);
}

describe('saving an island', () => {
  it('does not store the scenery the seed already describes', () => {
    const world = island();
    expect(world.nodes.length).toBeGreaterThan(400);

    expect(saveWorld(world, SLOT)).toBe(true);

    // The old format wrote every node in full, which was about 110 kB of the
    // 110 kB it wrote at all.
    expect(bytes()).toBeLessThan(4000);
    for (const text of store.values()) expect(text).not.toContain('"maxCharges"');

    const back = loadWorld(SLOT);
    expect(back?.nodes.length).toBe(world.nodes.length);
    expect(back?.nodes[0].pos).toEqual(world.nodes[0].pos);
    expect(back?.nodes[0].seed).toBe(world.nodes[0].seed);
  });

  it('keeps scenery that has been worked or cleared', () => {
    const world = island();
    const chopped = world.nodes[3];
    const felled = world.nodes[7];
    chopped.charges -= 1;
    chopped.regrow = 12.5;
    world.nodes = world.nodes.filter((n) => n.id !== felled.id);

    saveWorld(world, SLOT);
    const back = loadWorld(SLOT);

    expect(back?.nodes.find((n) => n.id === felled.id)).toBeUndefined();
    const reloaded = back?.nodes.find((n) => n.id === chopped.id);
    expect(reloaded?.charges).toBe(chopped.charges);
    expect(reloaded?.regrow).toBeCloseTo(12.5, 2);
    // Everything else came back untouched.
    expect(back?.nodes.length).toBe(world.nodes.length);
  });

  it("keeps a splitter's sides, which nothing else on the grid has", () => {
    const world = island();
    const player = [...world.players.values()][0];

    const splitter = placeMachine(world, player, 'splitter', SITE.tx, SITE.ty, 2)!;
    const plain = placeMachine(world, player, 'chest', SITE.tx + 1, SITE.ty, 0)!;
    expect(setFilter(world, splitter.id, 1, 'copperOre')).toBe(true);
    splitter.turn = 1;

    saveWorld(world, SLOT);
    const back = loadWorld(SLOT)!;

    const reloaded = back.machines.find((m) => m.id === splitter.id)!;
    expect(reloaded.filters).toEqual([null, 'copperOre']);
    expect(reloaded.turn).toBe(1);
    // Every other machine still carries no sides at all.
    expect(back.machines.find((m) => m.id === plain.id)!.filters).toBeUndefined();
  });

  it('round-trips a production line through the packed factory', () => {
    const world = island();
    const player = [...world.players.values()][0];

    const chest = placeMachine(world, player, 'chest', SITE.tx, SITE.ty, 1);
    const machine = placeMachine(world, player, 'furnace', SITE.tx + 2, SITE.ty, 1);
    const belt = placeBelt(world, player, SITE.tx + 1, SITE.ty, 1);
    expect(chest).not.toBeNull();
    expect(machine).not.toBeNull();
    expect(belt).not.toBeNull();
    setRecipe(world, machine!.id, 'ironPlate');
    machine!.progress = 0.755;
    addToSlots(machine!.input, 'ironOre', 7);
    addToSlots(chest!.input, 'coal', 13);
    world.belts[0].items.push({ item: 'ironOre', offset: 0.4 });

    saveWorld(world, SLOT);
    const back = loadWorld(SLOT)!;

    const reloaded = back.machines.find((m) => m.id === machine!.id)!;
    expect(reloaded.type).toBe('furnace');
    expect(reloaded.recipe).toBe('ironPlate');
    expect(reloaded.progress).toBeCloseTo(0.755, 3);
    expect(reloaded.input[0]).toEqual({ id: 'ironOre', count: 7 });
    expect(reloaded.dir).toBe(machine!.dir);
    expect(back.belts[0].items).toEqual([{ item: 'ironOre', offset: 0.4 }]);
    // The tile index is rebuilt from what came back, not stored.
    expect(back.grid.get(tileKey(SITE.tx + 1, SITE.ty))).toBe(back.belts[0]);
    expect(back.machines.find((m) => m.type === 'chest')!.input[0]).toEqual({
      id: 'coal',
      count: 13,
    });
  });

  it('rewrites only the sections that moved', () => {
    const world = island();
    saveWorld(world, SLOT);
    expect(new Set(writes).size).toBe(3);

    writes.length = 0;
    world.tick += 240;
    saveWorld(world, SLOT);
    // Nothing was built and nothing was chopped, so only the header moved.
    expect(writes).toEqual([slotKey(SLOT)]);

    writes.length = 0;
    world.nodes[2].charges -= 1;
    saveWorld(world, SLOT);
    expect(writes).toContain(slotKey(SLOT) + SCENERY_SUFFIX);
    expect(writes).not.toContain(slotKey(SLOT) + FACTORY_SUFFIX);

    writes.length = 0;
    const player = [...world.players.values()][0];
    placeMachine(world, player, 'chest', SITE.tx, SITE.ty, 1);
    saveWorld(world, SLOT);
    expect(writes).toContain(slotKey(SLOT) + FACTORY_SUFFIX);
  });

  it('starts writing again after a slot is reopened', () => {
    const world = island();
    saveWorld(world, SLOT);
    store.clear();

    // A skipped write must never outlive what this tab knows about storage.
    forgetSlot(SLOT);
    expect(saveWorld(world, SLOT)).toBe(true);
    expect(loadWorld(SLOT)?.nodes.length).toBe(world.nodes.length);
  });
});

describe('older saves', () => {
  /** Exactly what a version 3 island looked like: the whole world in one key. */
  function writeLegacy(world: World, version = 3): void {
    localStorage.setItem(
      slotKey(SLOT),
      JSON.stringify({
        version,
        savedAt: Date.now(),
        seed: world.seed,
        tick: world.tick,
        time: world.time,
        phase: 'night',
        phaseTime: 10,
        nightIndex: 3,
        nextId: world.nextId,
        rngState: world.rngState,
        players: [...world.players.values()],
        nodes: world.nodes,
        buildings: world.buildings,
        belts: world.belts,
        machines: world.machines,
        peaceful: world.peaceful,
      }),
    );
  }

  it('loads an island written before the split', () => {
    const world = island();
    const player = [...world.players.values()][0];
    placeMachine(world, player, 'chest', SITE.tx, SITE.ty, 1);
    placeBelt(world, player, SITE.tx + 1, SITE.ty, 1);
    world.nodes[5].charges = 1;
    world.nodes.splice(9, 1);
    writeLegacy(world);

    const back = loadWorld(SLOT)!;
    expect(back.nodes.length).toBe(world.nodes.length);
    expect(back.nodes.find((n) => n.id === world.nodes[5].id)?.charges).toBe(1);
    expect(back.machines).toHaveLength(1);
    expect(back.belts).toHaveLength(1);
    expect(back.nightIndex).toBe(3);
    // However the session ended, you wake up in daylight.
    expect(back.phase).toBe('day');
  });

  it('turns an old island into the new format on its next save', () => {
    const world = island();
    world.nodes[5].charges = 1;
    writeLegacy(world);

    const back = loadWorld(SLOT)!;
    saveWorld(back, SLOT);

    expect(bytes()).toBeLessThan(4000);
    expect(store.has(slotKey(SLOT) + SCENERY_SUFFIX)).toBe(true);
    expect(loadWorld(SLOT)?.nodes.find((n) => n.id === world.nodes[5].id)?.charges).toBe(1);
  });

  it('refuses a save from a version it cannot understand', () => {
    writeLegacy(island(), 99);
    expect(loadWorld(SLOT)).toBeNull();
  });
});
