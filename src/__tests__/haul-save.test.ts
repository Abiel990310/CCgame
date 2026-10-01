import { beforeEach, describe, expect, it } from 'vitest';
import { MACHINES } from '@shared/data/machines';
import { at, advance, bench, lay } from '@shared/sim/__tests__/bench';
import { haulPartner } from '@shared/sim/factory';
import { pushOntoBelt } from '@shared/sim/systems/factory';
import type { Belt, Machine } from '@shared/sim/types';
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

describe('long-haul ports in a save', () => {
  it('keeps the pair and what is in flight between them', () => {
    const b = bench();
    const head = at(1, 1);
    const [feed] = lay(b, head.tx, head.ty, 0, ['belt', 'haul']) as [Belt, Machine];
    lay(b, at(24, 1).tx, at(24, 1).ty, 0, ['haul', 'belt', 'chest']);
    for (let i = 0; i < 5; i++) {
      pushOntoBelt(feed, 'ironOre');
      advance(b.world, 0.6);
    }
    const sender = b.world.machines.find((m) => m.type === 'haul')!;
    expect(sender.transit!.length).toBeGreaterThan(0);

    expect(saveWorld(b.world, 'slot')).toBe(true);
    const loaded = loadWorld('slot')!;

    const before = b.world.machines.find((m) => m.type === 'haul')!;
    const after = loaded.machines.find((m) => m.type === 'haul')!;
    const receiver = loaded.machines.find((m) => m.type === 'haulExit')!;
    expect(after.link).toBe(receiver.id);
    expect(receiver.link).toBe(after.id);
    expect(haulPartner(loaded, after)).toBe(receiver);
    expect(after.transit!.map((p) => p.item)).toEqual(before.transit!.map((p) => p.item));
    expect(after.transit!.length).toBe(before.transit!.length);
    expect(after.transit![0].left).toBeCloseTo(before.transit![0].left, 1);
  });

  it('turns a receiver whose sender is missing into a sender, rather than losing the island', () => {
    const b = bench();
    lay(b, at(2, 2).tx, at(2, 2).ty, 0, ['haul']);
    lay(b, at(12, 2).tx, at(12, 2).ty, 0, ['haul']);
    saveWorld(b.world, 'slot');
    const key = slotKey('slot') + FACTORY_SUFFIX;
    const section = JSON.parse(store.get(key)!);
    // Drop the sender from the file, as a hand edit might.
    section.machines = section.machines.filter((row: unknown[]) => row[1] !== 'haul');
    store.set(key, JSON.stringify(section));

    const loaded = loadWorld('slot')!;
    const port = loaded.machines.find((m) => m.tx === at(12, 2).tx)!;
    expect(MACHINES[port.type].haul).toBe('in');
    expect(port.link).toBeUndefined();
    expect(port.transit).toEqual([]);
  });
});
