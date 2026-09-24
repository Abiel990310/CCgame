import { beforeEach, describe, expect, it } from 'vitest';
import { MACHINES } from '@shared/data/machines';
import { makeSlots } from '@shared/sim/slots';
import type { Machine, MachineId, World } from '@shared/sim/types';
import { createWorld } from '@shared/sim/world';
import { forgetSlot, loadWorld, saveWorld } from '../save';
import { FACTORY_SUFFIX, slotKey } from '../saves';

/** The registry only ever talks to localStorage, so a Map stands in for it. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;
  return store;
}

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
  // The writer skips a section whose text it already wrote, and that memory
  // outlives the stub storage this test replaces.
  for (const slot of ['a', 'b', 'c']) forgetSlot(slot);
});

function machine(type: MachineId, tx: number, ty: number): Machine {
  const def = MACHINES[type];
  return {
    id: 100 + tx,
    type,
    tx,
    ty,
    dir: 0,
    recipe: null,
    filter: null,
    ore: null,
    progress: 0,
    input: makeSlots(def.inputSlots),
    output: makeSlots(def.outputSlots),
    stalled: false,
  };
}

function island(): World {
  const world = createWorld(7, true);
  world.machines.push(machine('inserter', 30, 30), machine('longInserter', 31, 30));
  return world;
}

describe('saving an island with inserters on it', () => {
  it('brings both arms and their filters back', () => {
    const world = island();
    world.machines[0].filter = 'ironPlate';
    world.machines[1].filter = 'coal';

    expect(saveWorld(world, 'a')).toBe(true);
    const loaded = loadWorld('a')!;

    expect(loaded.machines.map((m) => m.type)).toEqual(['inserter', 'longInserter']);
    expect(loaded.machines.map((m) => m.filter)).toEqual(['ironPlate', 'coal']);
  });

  it('reads an island saved before filters existed', () => {
    const world = island();
    // A version 3 save: the whole island in the header, and no `filter`
    // anywhere in it, written the way that version wrote it.
    const legacy = {
      version: 3,
      savedAt: Date.now(),
      seed: world.seed,
      tick: 0,
      time: 0,
      phase: 'day',
      phaseTime: 60,
      nightIndex: 0,
      nextId: world.nextId,
      rngState: world.rngState,
      players: [],
      nodes: world.nodes,
      buildings: world.buildings,
      belts: [],
      machines: world.machines.map((m) => {
        const { filter: _filter, ...rest } = m;
        return rest;
      }),
      peaceful: true,
    };
    store.set(slotKey('b'), JSON.stringify(legacy));

    const loaded = loadWorld('b')!;

    expect(loaded.machines.map((m) => m.type)).toEqual(['inserter', 'longInserter']);
    expect(loaded.machines.map((m) => m.filter)).toEqual([null, null]);
  });

  it('drops a filter naming an item this build no longer has', () => {
    const world = island();
    world.machines[0].filter = 'ironPlate';
    saveWorld(world, 'c');

    const factory = JSON.parse(store.get(slotKey('c') + FACTORY_SUFFIX)!);
    // The filter is the last field of a packed machine.
    factory.machines[0][9] = 'plasteel';
    store.set(slotKey('c') + FACTORY_SUFFIX, JSON.stringify(factory));

    expect(loadWorld('c')!.machines[0].filter).toBe(null);
  });
});
