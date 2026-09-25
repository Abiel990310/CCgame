import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cloud, ClaimResult, WorldAccess, WorldSummary } from '../account/cloud';
import { CloudSession, PUSH_MS, packSlot, unpackSlot, uploadSlot, type SessionEvents } from '../account/sync';
import { createSlot, findSlot, listSaves, slotKey, touchSlot, type SaveSlot } from '../saves';

/** The registry and the sync both only talk to localStorage, so a Map stands in for it. */
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

/**
 * The server's rules from `docs/cloud/schema.sql`, kept in memory: one lease
 * per world, only its holder saves, and a live lease is only taken by force.
 * `cloud-live.test.ts` checks the real schema keeps the same rules.
 */
class FakeServer {
  worlds = new Map<string, { data: string; rev: number; lease: string | null; access: WorldAccess; name: string; summary: WorldSummary }>();
  private next = 1;
  offline = false;

  as(userId: string): Cloud {
    const server = this;
    const check = (): void => {
      if (server.offline) throw new Error('offline');
    };
    return {
      userId,
      async createWorld(name: string, access: WorldAccess, summary: WorldSummary, data: string) {
        check();
        const id = `w${server.next++}`;
        server.worlds.set(id, { data, rev: 1, lease: null, access, name, summary });
        return { id, rev: 1 };
      },
      async claimWorld(id: string, lease: string, force = false): Promise<ClaimResult> {
        check();
        const w = server.worlds.get(id);
        if (!w) return { ok: false, reason: 'missing' };
        if (w.lease && w.lease !== lease && !force) return { ok: false, reason: 'busy', seenSecondsAgo: 3 };
        w.lease = lease;
        return { ok: true, rev: w.rev, access: w.access };
      },
      async loadWorld(id: string) {
        check();
        const w = server.worlds.get(id);
        return w ? { data: w.data, rev: w.rev, name: w.name, access: w.access } : null;
      },
      async beatWorld(id: string, lease: string) {
        check();
        return server.worlds.get(id)?.lease === lease;
      },
      async saveWorld(id: string, lease: string, summary: WorldSummary, data: string) {
        check();
        const w = server.worlds.get(id);
        if (!w || w.lease !== lease) return null;
        w.rev++;
        w.data = data;
        w.summary = summary;
        return w.rev;
      },
      async releaseWorld(id: string, lease: string) {
        check();
        const w = server.worlds.get(id);
        if (w?.lease === lease) w.lease = null;
      },
    } as unknown as Cloud;
  }
}

function events(): SessionEvents & { lost: number; notices: string[] } {
  const e = {
    lost: 0,
    notices: [] as string[],
    room: () => null,
    onLost: () => void e.lost++,
    onNotice: (text: string) => void e.notices.push(text),
  };
  return e;
}

/** Give a slot some island data, as `saveWorld` would, and mark it saved. */
function play(slot: SaveSlot, header: string): void {
  localStorage.setItem(slotKey(slot.id), header);
  localStorage.setItem(slotKey(slot.id) + '.w', `scenery of ${header}`);
  touchSlot(slot.id, { night: 1, level: 1, playSeconds: 10 });
}

/** Stand in for a second device: its own storage, the same server. */
function device(): Map<string, string> {
  return installStorage();
}

let server: FakeServer;
let cloud: Cloud;

beforeEach(() => {
  installStorage();
  server = new FakeServer();
  cloud = server.as('user-1');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cloud islands', () => {
  it('bundles every entry of a slot and unpacks it into another', () => {
    const a = createSlot('Alpha');
    play(a, 'header-a');
    localStorage.setItem(slotKey(a.id) + '.lock', 'not island data');
    const packed = packSlot(a.id);

    const b = createSlot('Beta');
    localStorage.setItem(slotKey(b.id) + '.f', 'stale factory');
    unpackSlot(b.id, packed);
    expect(localStorage.getItem(slotKey(b.id))).toBe('header-a');
    expect(localStorage.getItem(slotKey(b.id) + '.w')).toBe('scenery of header-a');
    // A section the bundle lacks must not survive beside the new header.
    expect(localStorage.getItem(slotKey(b.id) + '.f')).toBeNull();
    expect(localStorage.getItem(slotKey(b.id) + '.lock')).toBeNull();
  });

  it('refuses a bundle that is not an island', () => {
    const a = createSlot('Alpha');
    expect(() => unpackSlot(a.id, JSON.stringify({ v: 1, e: {} }))).toThrow();
  });

  it('uploads a local island and pushes play on the next beat', async () => {
    const slot = createSlot('Alpha');
    play(slot, 'day-1');
    const linked = await uploadSlot(cloud, slot);
    expect(linked.cloud).toMatchObject({ owner: 'user-1', rev: 1, dirty: false });

    const opened = await CloudSession.open(cloud, linked, events());
    expect(opened.kind).toBe('open');
    if (opened.kind !== 'open') return;

    play(slot, 'day-2');
    expect(findSlot(slot.id)?.cloud?.dirty).toBe(true);
    vi.setSystemTime(Date.now() + PUSH_MS);
    await opened.session.beat();
    const world = server.worlds.get(linked.cloud!.id)!;
    expect(world.rev).toBe(2);
    expect(JSON.parse(world.data).e['']).toBe('day-2');
    expect(findSlot(slot.id)?.cloud).toMatchObject({ rev: 2, dirty: false });

    await opened.session.close();
    expect(world.lease).toBeNull();
  });

  it('pushes the last of play when the island is closed', async () => {
    const slot = await uploadSlot(cloud, (() => {
      const s = createSlot('Alpha');
      play(s, 'day-1');
      return s;
    })());
    const opened = await CloudSession.open(cloud, slot, events());
    if (opened.kind !== 'open') throw new Error('not opened');
    play(slot, 'day-1-evening');
    await opened.session.close();
    expect(JSON.parse(server.worlds.get(slot.cloud!.id)!.data).e['']).toBe('day-1-evening');
  });

  it('brings a newer copy down from another device before play', async () => {
    const phone = device();
    const slot = createSlot('Alpha');
    play(slot, 'day-1');
    const linked = await uploadSlot(cloud, slot);
    const laptopSlot = { ...linked };

    // The phone plays on and closes, pushing day 5.
    const opened = await CloudSession.open(cloud, linked, events());
    if (opened.kind !== 'open') throw new Error('not opened');
    play(linked, 'day-5');
    await opened.session.close();
    expect(phone.size).toBeGreaterThan(0);

    // The laptop has the island as it was at day 1, untouched since.
    installStorage();
    const index = { version: 1, lastPlayed: laptopSlot.id, slots: [laptopSlot] };
    localStorage.setItem('ccgame.saves.v1', JSON.stringify(index));
    localStorage.setItem(slotKey(laptopSlot.id), 'day-1');
    const again = await CloudSession.open(cloud, laptopSlot, events());
    expect(again.kind).toBe('open');
    expect(localStorage.getItem(slotKey(laptopSlot.id))).toBe('day-5');
    expect(findSlot(laptopSlot.id)?.cloud).toMatchObject({ rev: 2, dirty: false });
  });

  it('keeps a copy aside when both devices moved on', async () => {
    const slot = createSlot('Alpha');
    play(slot, 'day-1');
    const linked = await uploadSlot(cloud, slot);
    const stale = { ...linked };

    const opened = await CloudSession.open(cloud, linked, events());
    if (opened.kind !== 'open') throw new Error('not opened');
    play(linked, 'phone-day-5');
    await opened.session.close();

    // This device played offline from day 1 without ever pushing.
    installStorage();
    localStorage.setItem('ccgame.saves.v1', JSON.stringify({ version: 1, lastPlayed: stale.id, slots: [stale] }));
    play(stale, 'laptop-day-3');
    const again = await CloudSession.open(cloud, findSlot(stale.id)!, events());
    if (again.kind !== 'open') throw new Error('not opened');
    expect(again.notes).toHaveLength(1);
    expect(localStorage.getItem(slotKey(stale.id))).toBe('phone-day-5');
    const kept = listSaves().find((s) => s.name === 'Alpha (this device)');
    expect(kept).toBeDefined();
    expect(kept?.cloud).toBeUndefined();
    expect(localStorage.getItem(slotKey(kept!.id))).toBe('laptop-day-3');
  });

  it('says so when another device has the island, and hands it over on request', async () => {
    const slot = createSlot('Alpha');
    play(slot, 'day-1');
    const linked = await uploadSlot(cloud, slot);
    const phoneEvents = events();
    const phone = await CloudSession.open(cloud, linked, phoneEvents);
    if (phone.kind !== 'open') throw new Error('not opened');

    // Another browser: its own device id, the same account.
    installStorage();
    localStorage.setItem('ccgame.saves.v1', JSON.stringify({ version: 1, lastPlayed: linked.id, slots: [linked] }));
    const busy = await CloudSession.open(cloud, linked, events());
    expect(busy.kind).toBe('busy');

    const taken = await CloudSession.open(cloud, linked, events(), true);
    expect(taken.kind).toBe('open');
    await phone.session.beat();
    expect(phoneEvents.lost).toBe(1);
    expect(phone.session.alive).toBe(false);
  });

  it('keeps playing through an outage and says when it is back', async () => {
    const slot = await uploadSlot(cloud, (() => {
      const s = createSlot('Alpha');
      play(s, 'day-1');
      return s;
    })());
    const e = events();
    const opened = await CloudSession.open(cloud, slot, e);
    if (opened.kind !== 'open') throw new Error('not opened');
    server.offline = true;
    await opened.session.beat();
    await opened.session.beat();
    expect(e.notices).toHaveLength(1);
    expect(opened.session.alive).toBe(true);
    server.offline = false;
    await opened.session.beat();
    expect(e.notices).toHaveLength(2);
  });
});
