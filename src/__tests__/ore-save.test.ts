import { beforeEach, describe, expect, it } from 'vitest';
import { ORE } from '@shared/sim/constants';
import { tileKey } from '@shared/sim/grid';
import { oreAt, oreLeftAt } from '@shared/sim/ore';
import { createWorld } from '@shared/sim/world';
import type { World } from '@shared/sim/types';
import { loadWorld, saveWorld } from '../save';
import { ORE_SUFFIX, slotKey } from '../saves';

/** The save layer only ever talks to localStorage, so a Map stands in for it. */
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
});

const SEED = 8801;

/** A tile the generator actually filled with ore, for the seed under test. */
function anOreTile(world: World): number {
  for (let i = 0; i < world.ore.length; i++) {
    if (world.ore[i] !== 0) return i;
  }
  throw new Error('the island generated no ore at all');
}

describe('mined ore survives a save', () => {
  it('carries the tiles that were mined and nothing else', () => {
    const world = createWorld(SEED);
    const key = anOreTile(world);
    const before = world.oreLeft[key];
    world.oreLeft[key] = before - 25;

    expect(saveWorld(world, 'slot')).toBe(true);
    const loaded = loadWorld('slot')!;

    expect(loaded.oreLeft[key]).toBe(before - 25);
    // Every other tile came back from the seed, untouched.
    expect([...loaded.oreLeft].filter((n, i) => n !== world.oreMax[i])).toEqual([before - 25]);
  });

  it('writes only the worked tiles, not the whole grid', () => {
    const world = createWorld(SEED);
    world.oreLeft[anOreTile(world)] -= 1;
    saveWorld(world, 'slot');

    const mined = JSON.parse(store.get(slotKey('slot') + ORE_SUFFIX)!) as Record<string, number>;
    expect(Object.keys(mined)).toHaveLength(1);
  });

  it('brings an emptied tile back as bare ground', () => {
    const world = createWorld(SEED);
    const key = anOreTile(world);
    world.oreLeft[key] = 0;
    world.ore[key] = 0;
    saveWorld(world, 'slot');

    const loaded = loadWorld('slot')!;
    const tx = key % Math.sqrt(loaded.ore.length);
    const ty = (key - tx) / Math.sqrt(loaded.ore.length);
    expect(oreAt(loaded.ore, tx, ty)).toBe(null);
    expect(oreLeftAt(loaded, tx, ty)).toBe(0);
  });

  it('loads an island saved before ore was finite with its patches full', () => {
    const world = createWorld(SEED);
    saveWorld(world, 'slot');

    // Exactly what a version 4 save looks like: no record of the ground at all.
    const file = JSON.parse(store.get(slotKey('slot'))!) as Record<string, unknown>;
    file.version = 4;
    store.set(slotKey('slot'), JSON.stringify(file));
    store.delete(slotKey('slot') + ORE_SUFFIX);

    const loaded = loadWorld('slot')!;
    expect([...loaded.oreLeft]).toEqual([...world.oreMax]);
  });

  it('refuses to mint ore a hand-edited save claims is there', () => {
    const world = createWorld(SEED);
    const key = anOreTile(world);
    saveWorld(world, 'slot');

    const mined = JSON.parse(store.get(slotKey('slot') + ORE_SUFFIX)!) as Record<string, number>;
    mined[key] = ORE.tileAmount * 1000;
    mined['999999'] = 50;
    store.set(slotKey('slot') + ORE_SUFFIX, JSON.stringify(mined));

    const loaded = loadWorld('slot')!;
    expect(loaded.oreLeft[key]).toBe(world.oreMax[key]);
    expect(loaded.oreLeft.length).toBe(world.oreLeft.length);
  });

  it('remembers what a miner was pulling up', () => {
    const world = createWorld(SEED);
    const key = anOreTile(world);
    const tiles = Math.sqrt(world.ore.length);
    const tx = key % tiles;
    const ty = (key - tx) / tiles;

    world.machines.push({
      id: 1,
      type: 'miner',
      tx,
      ty,
      dir: 0,
      recipe: null,
      ore: 'ironOre',
      progress: 0,
      input: [],
      output: [null],
      stalled: false,
    });
    world.grid.set(tileKey(tx, ty), world.machines[0]);
    saveWorld(world, 'slot');

    expect(loadWorld('slot')!.machines[0].ore).toBe('ironOre');
  });
});
