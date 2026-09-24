import { LOCK_SUFFIX, slotKey } from './saves';

/**
 * One island, one tab. Every tab keeps the whole island in memory and saves it
 * wholesale, so two tabs playing the same slot take turns overwriting each
 * other — and because a save skips sections it believes are unchanged, one
 * tab can leave the other's factory half replaced. Whoever opens an island
 * last owns it; the tab it came from saves, steps back to the menu and never
 * writes to that slot again until it is opened there once more.
 *
 * The owner is recorded in storage beside the slot, which is what makes the
 * rule hold even when the tabs cannot talk. A broadcast handshake on top of
 * it lets the tab giving the island up save first, so handing over loses
 * nothing rather than the last few seconds of play.
 */

/** How long a new tab waits for the old one to finish saving before taking over. */
const HANDOVER_MS = 800;
const POLL_MS = 20;
const CHANNEL = 'ccgame.tabs';

interface LockRecord {
  tab: string;
  at: number;
}

interface Message {
  type: 'claim';
  slot: string;
  tab: string;
}

/**
 * Why a tab lost its island: `handover` when it was asked and still owned the
 * slot, so it may save first; `taken` when storage already names someone
 * else, so any save now would overwrite theirs.
 */
export type EvictReason = 'handover' | 'taken';

export class SlotLock {
  readonly tab = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  private held: string | null = null;
  /** False when storage refused the record, which leaves nothing to check against. */
  private recorded = false;
  private channel: BroadcastChannel | null = null;

  constructor(private onEvicted: (slot: string, reason: EvictReason) => void) {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e: MessageEvent<Message>) => this.receive(e.data);
    } catch {
      // Without a channel the storage record below still keeps the tabs apart;
      // only the save-before-handing-over courtesy is lost.
      this.channel = null;
    }

    // Fires in every other tab when one writes the record, so a tab that
    // missed the handshake still notices it has been replaced.
    window.addEventListener('storage', (e) => {
      if (!this.held || !this.recorded || e.key !== slotKey(this.held) + LOCK_SUFFIX) return;
      if (readLock(this.held)?.tab !== this.tab) this.evict(this.held, 'taken');
    });
  }

  /** Take a slot, giving any tab that has it open the chance to save first. */
  async claim(slot: string): Promise<void> {
    this.held = null;
    const current = readLock(slot);
    if (current && current.tab !== this.tab && this.channel) {
      this.post({ type: 'claim', slot, tab: this.tab });
      // The old tab answers by saving and then dropping its record. Watching
      // for that record, rather than for a reply on the channel, is what makes
      // the save visible here before the island is read: each tab sees
      // another's storage writes later than the channel's messages, but in the
      // order they were made.
      const deadline = Date.now() + HANDOVER_MS;
      while (readLock(slot)?.tab === current.tab && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    this.recorded = writeLock(slot, { tab: this.tab, at: Date.now() });
    this.held = slot;
  }

  /** Whether this tab may still write the slot. */
  owns(slot: string): boolean {
    if (this.held !== slot) return false;
    return !this.recorded || readLock(slot)?.tab === this.tab;
  }

  /** Let go of a slot on purpose, so the next tab to open it need not wait. */
  release(slot: string): void {
    if (this.held === slot) this.held = null;
    if (readLock(slot)?.tab === this.tab) removeLock(slot);
  }

  private receive(message: Message): void {
    if (message.type !== 'claim' || message.tab === this.tab || message.slot !== this.held) return;
    this.evict(message.slot, 'handover');
    this.release(message.slot);
  }

  private evict(slot: string, reason: EvictReason): void {
    if (this.held !== slot) return;
    // The callback may still save, which checks `owns`, so it runs first.
    this.onEvicted(slot, reason);
    this.held = null;
  }

  private post(message: Message): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel only costs the handshake.
    }
  }
}

function readLock(slot: string): LockRecord | null {
  try {
    const raw = localStorage.getItem(slotKey(slot) + LOCK_SUFFIX);
    if (raw === null) return null;
    const lock = JSON.parse(raw) as LockRecord;
    return typeof lock?.tab === 'string' ? lock : null;
  } catch {
    return null;
  }
}

function writeLock(slot: string, lock: LockRecord): boolean {
  try {
    localStorage.setItem(slotKey(slot) + LOCK_SUFFIX, JSON.stringify(lock));
    return true;
  } catch {
    // Storage that refuses the record will refuse saves too, so there is no
    // island to protect — but the game must still be playable.
    return false;
  }
}

function removeLock(slot: string): void {
  try {
    localStorage.removeItem(slotKey(slot) + LOCK_SUFFIX);
  } catch {
    // A stale record only makes the next opener wait out the handover.
  }
}
