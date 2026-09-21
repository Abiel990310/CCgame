import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSlot,
  deleteSlot,
  describeAge,
  describePlaytime,
  lastPlayed,
  listSaves,
  renameSlot,
  slotKey,
  suggestName,
  touchSlot,
} from '../saves';

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
});

describe('save slots', () => {
  it('starts with nothing to continue', () => {
    expect(listSaves()).toEqual([]);
    expect(lastPlayed()).toBeNull();
  });

  it('keeps each game separate and remembers the last one played', () => {
    const first = createSlot('Alpha');
    const second = createSlot('Beta');

    expect(listSaves().map((s) => s.name)).toContain('Alpha');
    expect(listSaves()).toHaveLength(2);
    expect(lastPlayed()?.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);
    expect(slotKey(first.id)).not.toBe(slotKey(second.id));
  });

  it('refreshes a slot summary on save, and makes it the one to continue', () => {
    const first = createSlot('Alpha');
    createSlot('Beta');

    touchSlot(first.id, { night: 4, level: 7, playSeconds: 3700 });

    const slot = listSaves()[0];
    expect(slot.id).toBe(first.id);
    expect(slot.night).toBe(4);
    expect(slot.level).toBe(7);
    expect(lastPlayed()?.id).toBe(first.id);
  });

  it('renames a slot without touching its world data', () => {
    const slot = createSlot('Alpha');
    localStorage.setItem(slotKey(slot.id), '{"version":1}');

    renameSlot(slot.id, '  Abiel Island  ');

    expect(listSaves()[0].name).toBe('Abiel Island');
    expect(localStorage.getItem(slotKey(slot.id))).toBe('{"version":1}');
    // An empty name is a slip, not a rename.
    renameSlot(slot.id, '   ');
    expect(listSaves()[0].name).toBe('Abiel Island');
  });

  it('deletes the world data along with the slot', () => {
    const doomed = createSlot('Alpha');
    const kept = createSlot('Beta');
    localStorage.setItem(slotKey(doomed.id), '{"version":1}');
    localStorage.setItem(slotKey(kept.id), '{"version":1}');

    deleteSlot(doomed.id);

    expect(listSaves().map((s) => s.id)).toEqual([kept.id]);
    expect(localStorage.getItem(slotKey(doomed.id))).toBeNull();
    expect(localStorage.getItem(slotKey(kept.id))).not.toBeNull();
    expect(lastPlayed()?.id).toBe(kept.id);
  });

  it('suggests a name that is not already taken', () => {
    const taken = suggestName();
    createSlot(taken);
    expect(suggestName()).not.toBe(taken);
  });

  it('adopts a pre-slots save as the first island', () => {
    const legacy = JSON.stringify({ version: 1, savedAt: 1000, seed: 42, nightIndex: 6 });
    store.set('ccgame.save.v1', legacy);

    const slots = listSaves();
    expect(slots).toHaveLength(1);
    expect(slots[0].name).toBe('The Island');
    expect(slots[0].night).toBe(6);
    // The island itself is carried over byte for byte, and the old key retired.
    expect(localStorage.getItem(slotKey(slots[0].id))).toBe(legacy);
    expect(localStorage.getItem('ccgame.save.v1')).toBeNull();
    // A second read finds the migrated slot rather than adopting again.
    expect(listSaves()).toHaveLength(1);
  });

  it('survives storage that throws on every call', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
    };

    expect(listSaves()).toEqual([]);
    expect(lastPlayed()).toBeNull();
    expect(() => createSlot('Alpha')).not.toThrow();
  });
});

describe('summaries', () => {
  it('describes how long ago a save was played', () => {
    expect(describeAge(Date.now())).toBe('just now');
    expect(describeAge(Date.now() - 20 * 60_000)).toBe('20m ago');
    expect(describeAge(Date.now() - 5 * 3_600_000)).toBe('5h ago');
    expect(describeAge(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });

  it('describes playtime', () => {
    expect(describePlaytime(12)).toBe('just started');
    expect(describePlaytime(20 * 60)).toBe('20m played');
    expect(describePlaytime(3 * 3600 + 25 * 60)).toBe('3h 25m played');
  });
});
