import type { ItemId, SimEvent } from '@shared/sim/types';
import { LEDGER_SUFFIX, slotKey } from './saves';

/** Seconds of island time per bar of the graph. */
export const LEDGER_BUCKET = 10;
/** Bars kept: ten minutes, which is long enough to see a line settle after a change. */
export const LEDGER_HISTORY = 60;
/** Bars that make up the minute a rate is quoted over. */
const PER_MINUTE = 60 / LEDGER_BUCKET;

interface Line {
  /** Items made per bar, oldest first, the last entry being the newest finished bar. */
  counts: number[];
  /** The highest rate any finished minute has reached, in items per minute. */
  best: number;
  /** Items made so far in the bar that is still filling. */
  open: number;
}

/** What is kept between sessions: the graph, so it does not start empty, and the bests. */
export interface LedgerSave {
  v: 1;
  /** The bar the counts end on. */
  bucket: number;
  lines: Partial<Record<ItemId, SavedLine>>;
}

interface SavedLine {
  counts: number[];
  best: number;
  /** The bar still filling, so a reload does not show a dip. */
  open?: number;
}

export interface LedgerRow {
  item: ItemId;
  /** Items per minute over the last finished minute. */
  rate: number;
  best: number;
  /** Items per minute for each finished bar, oldest first, `LEDGER_HISTORY` long. */
  series: number[];
}

/**
 * How fast the factory makes each thing. It is read off the `produced` events
 * rather than kept in the sim: nothing in the world depends on it, a guest
 * sees the same events by replaying the host's ticks, and so it needs no
 * command, no snapshot field and no save version.
 *
 * Time is island time, not the wall clock, so a paused game or a background
 * tab neither drags the rate down nor sets a false best.
 */
export class Ledger {
  private lines = new Map<ItemId, Line>();
  /** The bar currently filling; -1 until the first event says what time it is. */
  private bucket = -1;

  record(events: readonly SimEvent[], time: number): void {
    this.advance(time);
    for (const event of events) {
      if (event.kind !== 'produced') continue;
      this.line(event.item).open += event.count;
    }
  }

  /** Close every bar that has ended by `time`. */
  advance(time: number): void {
    const now = Math.floor(time / LEDGER_BUCKET);
    if (this.bucket < 0 || now < this.bucket) {
      // A first look, or time went backwards (a co-op guest took a fresh
      // snapshot of an older island): the graph restarts, the bests stand.
      if (this.bucket >= 0) for (const line of this.lines.values()) line.counts.fill(0);
      this.bucket = now;
      for (const line of this.lines.values()) line.open = 0;
      return;
    }
    const closed = Math.min(now - this.bucket, LEDGER_HISTORY);
    if (closed <= 0) return;
    for (const line of this.lines.values()) {
      for (let i = 0; i < closed; i++) {
        line.counts.shift();
        line.counts.push(i === 0 ? line.open : 0);
        // A best is only ever a whole minute: a burst inside one bar is not a rate.
        const minute = sumTail(line.counts, PER_MINUTE);
        if (minute > line.best) line.best = minute;
      }
      line.open = 0;
    }
    this.bucket = now;
  }

  /** Everything the factory has made in the last ten minutes, busiest first. */
  rows(): LedgerRow[] {
    const rows: LedgerRow[] = [];
    for (const [item, line] of this.lines) {
      if (line.best === 0 && line.open === 0 && line.counts.every((c) => c === 0)) continue;
      rows.push({
        item,
        rate: sumTail(line.counts, PER_MINUTE),
        best: line.best,
        series: line.counts.map((c) => c * PER_MINUTE),
      });
    }
    return rows.sort((a, b) => b.rate - a.rate || b.best - a.best || a.item.localeCompare(b.item));
  }

  toSave(): LedgerSave {
    const lines: LedgerSave['lines'] = {};
    for (const [item, line] of this.lines) lines[item] = { counts: [...line.counts], best: line.best, open: line.open };
    return { v: 1, bucket: this.bucket, lines };
  }

  static fromSave(save: LedgerSave | null): Ledger {
    const ledger = new Ledger();
    if (!save || save.v !== 1) return ledger;
    for (const [item, saved] of Object.entries(save.lines) as [ItemId, SavedLine][]) {
      const counts = new Array<number>(LEDGER_HISTORY).fill(0);
      const kept = (saved.counts ?? []).slice(-LEDGER_HISTORY).map((c) => (Number.isFinite(c) ? c : 0));
      counts.splice(LEDGER_HISTORY - kept.length, kept.length, ...kept);
      const open = Number.isFinite(saved.open) ? (saved.open as number) : 0;
      ledger.lines.set(item, { counts, best: Number.isFinite(saved.best) ? saved.best : 0, open });
    }
    ledger.bucket = Number.isFinite(save.bucket) ? save.bucket : -1;
    return ledger;
  }

  private line(item: ItemId): Line {
    let line = this.lines.get(item);
    if (!line) {
      line = { counts: new Array<number>(LEDGER_HISTORY).fill(0), best: 0, open: 0 };
      this.lines.set(item, line);
    }
    return line;
  }
}

function sumTail(values: number[], n: number): number {
  let total = 0;
  for (let i = Math.max(0, values.length - n); i < values.length; i++) total += values[i];
  return total;
}

/** The island's ledger as last written, or an empty one. */
export function loadLedger(slot: string): Ledger {
  try {
    const raw = localStorage.getItem(slotKey(slot) + LEDGER_SUFFIX);
    return Ledger.fromSave(raw ? (JSON.parse(raw) as LedgerSave) : null);
  } catch {
    return new Ledger();
  }
}

export function saveLedger(slot: string, ledger: Ledger): void {
  try {
    localStorage.setItem(slotKey(slot) + LEDGER_SUFFIX, JSON.stringify(ledger.toSave()));
  } catch {
    // A full disk costs a few minutes of graph, never the island.
  }
}
