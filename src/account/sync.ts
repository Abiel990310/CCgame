import {
  createSlot,
  findSlot,
  setSlotCloud,
  setSlotSummary,
  slotKey,
  SLOT_SUFFIXES,
  type SaveSlot,
} from '../saves';
import type { Cloud, CloudWorld, WorldAccess, WorldSummary } from './cloud';

/**
 * Islands in the cloud. The cloud keeps a slot exactly as this browser keeps
 * it, every localStorage entry `save.ts` writes, bundled as one text. Nothing
 * here knows what an island contains, so the save format can keep changing
 * without the cloud copy needing a migration of its own: an island that comes
 * down from the cloud goes through the same `loadWorld` as one that never left.
 *
 * Only one browser plays a cloud world at a time. It holds the world's lease,
 * refreshes it every few seconds, and is the only one the server lets save.
 * Opening the world anywhere else either waits for the lease to lapse or, on
 * the player's say-so, takes it, and the browser that had it stops at its next
 * heartbeat. That is the cloud's version of `tablock.ts`, and it is also how
 * friends learn that someone is on an island they may join.
 */

const BUNDLE_VERSION = 1;

interface Bundle {
  v: number;
  /** Suffix to the raw text stored under `slotKey(id) + suffix`. */
  e: Record<string, string>;
}

/** Every entry of one slot, as the text the cloud stores. */
export function packSlot(id: string): string {
  const bundle: Bundle = { v: BUNDLE_VERSION, e: {} };
  for (const suffix of SLOT_SUFFIXES) {
    const raw = localStorage.getItem(slotKey(id) + suffix);
    if (raw !== null) bundle.e[suffix] = raw;
  }
  return JSON.stringify(bundle);
}

/**
 * Replace a slot's entries with a bundle's. An entry the bundle does not have
 * is removed rather than kept, or a section from the old copy would be read
 * alongside a header from the new one.
 */
export function unpackSlot(id: string, data: string): void {
  const bundle = JSON.parse(data) as Bundle;
  if (!bundle || typeof bundle.e !== 'object' || typeof bundle.e[''] !== 'string') {
    throw new Error('That cloud save is not an island this game can read');
  }
  if (bundle.v > BUNDLE_VERSION) throw new Error('That island was saved by a newer version — reload the page');
  // Write everything first and only then drop what the bundle lacks, so a
  // full disk part way through leaves the old island rather than half of both.
  for (const suffix of SLOT_SUFFIXES) {
    const raw = bundle.e[suffix];
    if (raw !== undefined) localStorage.setItem(slotKey(id) + suffix, raw);
  }
  for (const suffix of SLOT_SUFFIXES) {
    if (bundle.e[suffix] === undefined) localStorage.removeItem(slotKey(id) + suffix);
  }
}

/** Whether a slot has ever been saved, as opposed to created and not yet played. */
export function slotHasData(id: string): boolean {
  try {
    return localStorage.getItem(slotKey(id)) !== null;
  } catch {
    return false;
  }
}

export function summaryOf(slot: SaveSlot): WorldSummary {
  return { night: slot.night, level: slot.level, playSeconds: slot.playSeconds };
}

/**
 * Who this browser is to the cloud. It is shared by every tab here, because
 * `tablock.ts` already keeps those tabs to one island each, and a second tab
 * taking over from the first should not look like another device doing it.
 */
export function deviceLease(): string {
  const key = 'ccgame.cloud.device';
  try {
    const known = localStorage.getItem(key);
    if (known) return known;
    const made = crypto.randomUUID();
    localStorage.setItem(key, made);
    return made;
  } catch {
    return crypto.randomUUID();
  }
}

/** Whether a slot is linked to the account signed in now. */
export function linkedTo(slot: SaveSlot, cloud: Cloud): boolean {
  return !!slot.cloud && slot.cloud.owner === cloud.userId;
}

/** Put a local island in the account. */
export async function uploadSlot(cloud: Cloud, slot: SaveSlot, access: WorldAccess = 'private'): Promise<SaveSlot> {
  const owner = cloud.userId;
  if (!owner) throw new Error('Sign in first');
  const current = findSlot(slot.id) ?? slot;
  const made = await cloud.createWorld(current.name, access, summaryOf(current), packSlot(slot.id));
  return setSlotCloud(slot.id, { id: made.id, owner, rev: made.rev, dirty: false }) ?? current;
}

/** Bring an island that is only in the account down into a new local slot. */
export async function downloadWorld(cloud: Cloud, world: CloudWorld): Promise<SaveSlot> {
  const owner = cloud.userId;
  if (!owner) throw new Error('Sign in first');
  const loaded = await cloud.loadWorld(world.id);
  if (!loaded) throw new Error('That island is no longer in your account');
  const slot = createSlot(loaded.name);
  try {
    unpackSlot(slot.id, loaded.data);
  } catch (error) {
    throw error instanceof Error ? error : new Error('Could not unpack that island');
  }
  setSlotSummary(slot.id, {
    night: world.summary.night ?? 0,
    level: world.summary.level ?? 1,
    playSeconds: world.summary.playSeconds ?? 0,
    updatedAt: world.updatedAt,
  });
  return setSlotCloud(slot.id, { id: world.id, owner, rev: loaded.rev, dirty: false }) ?? slot;
}

export interface SessionEvents {
  /** The code friends join with, when co-op is open. */
  room(): string | null;
  /** Another device took the world; this one must stop playing it. */
  onLost(): void;
  /** Something the player might want to know, such as the connection dropping. */
  onNotice(text: string, tone: 'good' | 'warn'): void;
}

export type OpenResult =
  | { kind: 'open'; session: CloudSession; access: WorldAccess; notes: string[] }
  | { kind: 'busy'; seenSecondsAgo: number }
  | { kind: 'missing' };

/** How often the lease is refreshed; the server lets it lapse after 45 seconds. */
export const BEAT_MS = 15_000;
/** How often play is pushed to the cloud. A quit pushes straight away. */
export const PUSH_MS = 60_000;

/**
 * One browser's hold on one cloud world while it is being played: the lease,
 * the heartbeat that keeps it, and the pushes that keep the cloud copy close
 * behind the local save.
 */
export class CloudSession {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPush = Date.now();
  private busy: Promise<unknown> | null = null;
  private offline = false;
  private ended = false;

  private constructor(
    private cloud: Cloud,
    readonly slotId: string,
    readonly worldId: string,
    private lease: string,
    private events: SessionEvents,
  ) {}

  /**
   * Take the world's lease and bring the local slot level with the cloud:
   * pull a newer copy down, or mark ours to go up. When both moved on since
   * they last matched, the local copy is kept as a separate island, so taking
   * one never throws away the other.
   */
  static async open(cloud: Cloud, slot: SaveSlot, events: SessionEvents, force = false): Promise<OpenResult> {
    const link = slot.cloud;
    if (!link || link.owner !== cloud.userId) throw new Error('This island is not in your account');
    const lease = deviceLease();
    const claim = await cloud.claimWorld(link.id, lease, force);
    if (!claim.ok) return claim.reason === 'busy' ? { kind: 'busy', seenSecondsAgo: claim.seenSecondsAgo } : { kind: 'missing' };

    const notes: string[] = [];
    if (claim.rev > link.rev || !slotHasData(slot.id)) {
      if (link.dirty && slotHasData(slot.id)) {
        const copy = createSlot(`${slot.name} (this device)`.slice(0, 40));
        for (const suffix of SLOT_SUFFIXES) {
          const raw = localStorage.getItem(slotKey(slot.id) + suffix);
          if (raw !== null) localStorage.setItem(slotKey(copy.id) + suffix, raw);
        }
        setSlotSummary(copy.id, { night: slot.night, level: slot.level, playSeconds: slot.playSeconds, updatedAt: slot.updatedAt });
        notes.push(`${slot.name} changed here and elsewhere, so this device's copy was kept as "${copy.name}"`);
      }
      const loaded = await cloud.loadWorld(link.id);
      if (!loaded) return { kind: 'missing' };
      unpackSlot(slot.id, loaded.data);
      setSlotCloud(slot.id, { ...link, rev: loaded.rev, dirty: false });
    }

    const session = new CloudSession(cloud, slot.id, link.id, lease, events);
    session.timer = setInterval(() => void session.beat(), BEAT_MS);
    // A copy that is ahead of the cloud goes up as soon as play starts.
    if (findSlot(slot.id)?.cloud?.dirty) session.lastPush = 0;
    return { kind: 'open', session, access: claim.access, notes };
  }

  get alive(): boolean {
    return !this.ended;
  }

  /** Refresh the lease, and push if play has moved on since the last push. */
  async beat(): Promise<void> {
    if (this.ended || this.busy) return;
    const work = (async () => {
      const kept = await this.cloud.beatWorld(this.worldId, this.lease, this.events.room());
      if (!kept) return this.lose();
      this.reconnected();
      if (Date.now() - this.lastPush >= PUSH_MS) await this.push();
    })();
    this.busy = work;
    try {
      await work;
    } catch {
      this.disconnected();
    } finally {
      this.busy = null;
    }
  }

  /** Send the local save up now. False when it could not go. */
  async push(): Promise<boolean> {
    if (this.ended) return false;
    const kept = await this.upload();
    if (!kept) this.lose();
    return kept;
  }

  /** The push itself. False only when the lease turned out to be gone. */
  private async upload(): Promise<boolean> {
    const slot = findSlot(this.slotId);
    if (!slot?.cloud) return true;
    if (!slot.cloud.dirty) {
      this.lastPush = Date.now();
      return true;
    }
    const stamp = slot.updatedAt;
    const rev = await this.cloud.saveWorld(this.worldId, this.lease, summaryOf(slot), packSlot(this.slotId));
    if (rev === null) return false;
    this.lastPush = Date.now();
    // A save that landed while this one was on its way is not in the cloud yet.
    const now = findSlot(this.slotId);
    if (now?.cloud) setSlotCloud(this.slotId, { ...now.cloud, rev, dirty: now.updatedAt !== stamp });
    return true;
  }

  /** Stop playing: push what is left and hand the lease back. */
  async close(): Promise<void> {
    if (this.ended) return;
    this.halt();
    try {
      await this.busy;
    } catch {
      // Whatever the heartbeat was doing, the final push below supersedes it.
    }
    try {
      if (await this.upload()) await this.cloud.releaseWorld(this.worldId, this.lease);
      else this.forgetLocalChanges();
    } catch {
      // Offline: the save stays marked to go up the next time this island opens.
    }
  }

  /**
   * Stop without a word to the server: another tab here took the island over
   * and shares this browser's lease, so releasing it would release theirs.
   */
  halt(): void {
    this.ended = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private lose(): void {
    if (this.ended) return;
    this.halt();
    this.forgetLocalChanges();
    this.events.onLost();
  }

  /**
   * What this device played since the last push is not wanted: the player
   * chose to carry on elsewhere. Marking it clean lets the next open here pull
   * the other device's copy instead of keeping this one aside.
   */
  private forgetLocalChanges(): void {
    const slot = findSlot(this.slotId);
    if (slot?.cloud) setSlotCloud(this.slotId, { ...slot.cloud, dirty: false });
  }

  private disconnected(): void {
    if (this.offline) return;
    this.offline = true;
    this.events.onNotice('Lost touch with your account — saving on this device until it is back', 'warn');
  }

  private reconnected(): void {
    if (!this.offline) return;
    this.offline = false;
    this.events.onNotice('Back in touch with your account', 'good');
  }
}
