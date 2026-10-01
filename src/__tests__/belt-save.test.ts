import { beforeEach, describe, expect, it } from 'vitest';
import { beltTier } from '@shared/data/machines';
import { beltAt, placeBelt } from '@shared/sim/factory';
import { at, bench } from '@shared/sim/__tests__/bench';
import { createWorld } from '@shared/sim/world';
import { loadWorld, saveWorld } from '../save';
import { FACTORY_SUFFIX, slotKey } from '../saves';

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

describe('belt tiers in a save', () => {
  it('keeps each belt’s tier, facing and cargo through a save', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    const kinds = ['belt', 'beltMk2', 'beltMk3'] as const;
    // Each faces a different way, so a tier packed into the facing would show
    // up as the wrong direction as readily as the wrong speed.
    kinds.forEach((kind, i) => {
      const belt = placeBelt(b.world, b.player, tx + i * 2, ty, i as 0 | 1 | 2, kind);
      expect(belt, kind).not.toBe(null);
      belt!.items.push({ item: 'ironOre', offset: 0.5 });
    });

    expect(saveWorld(b.world, 'slot')).toBe(true);
    const loaded = loadWorld('slot')!;

    kinds.forEach((kind, i) => {
      const belt = beltAt(loaded, tx + i * 2, ty)!;
      expect(beltTier(belt), kind).toBe(i + 1);
      expect(belt.dir).toBe(i);
      expect(belt.items).toEqual([{ item: 'ironOre', offset: 0.5 }]);
    });
    // A plain belt stays a plain belt, with no tier written on it.
    expect(beltAt(loaded, tx, ty)!.tier).toBeUndefined();
  });

  it('loads a belt row packed before tiers as a plain belt', () => {
    const world = createWorld(8803, true);
    saveWorld(world, 'slot');
    const key = slotKey('slot') + FACTORY_SUFFIX;
    const section = JSON.parse(store.get(key) ?? '{"belts":[],"machines":[]}');
    // The row an older build wrote: id, tile, facing, then item and offset pairs.
    section.belts = [[7001, 40, 41, 2, 'ironOre', 0.25]];
    store.set(key, JSON.stringify(section));

    const loaded = loadWorld('slot')!;
    const belt = loaded.belts.find((b) => b.id === 7001)!;
    expect(belt.dir).toBe(2);
    expect(belt.tier).toBeUndefined();
    expect(beltTier(belt)).toBe(1);
    expect(belt.items).toEqual([{ item: 'ironOre', offset: 0.25 }]);
  });
});
