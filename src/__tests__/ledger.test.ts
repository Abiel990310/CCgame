import { describe, expect, it } from 'vitest';
import type { ItemId, SimEvent } from '@shared/sim/types';
import { LEDGER_BUCKET, LEDGER_HISTORY, Ledger } from '../ledger';

function made(item: ItemId, count = 1): SimEvent {
  return { kind: 'produced', pos: { x: 0, y: 0 }, machine: 'furnace', item, count };
}

/** Run the ledger through `seconds` of island time, `perMinute` of one item arriving evenly. */
function run(ledger: Ledger, start: number, seconds: number, item: ItemId, perMinute: number): number {
  const gap = 60 / perMinute;
  let t = start;
  for (; t < start + seconds; t += gap) ledger.record([made(item)], t);
  ledger.advance(start + seconds);
  return start + seconds;
}

describe('production ledger', () => {
  it('quotes the last full minute, per item', () => {
    const ledger = new Ledger();
    run(ledger, 0, 120, 'ironPlate', 30);
    const row = ledger.rows().find((r) => r.item === 'ironPlate')!;
    expect(row.rate).toBe(30);
    expect(row.series).toHaveLength(LEDGER_HISTORY);
  });

  it('counts every item a craft puts out', () => {
    const ledger = new Ledger();
    ledger.record([made('wire', 2)], 1);
    ledger.advance(LEDGER_BUCKET);
    expect(ledger.rows()[0]).toMatchObject({ item: 'wire', rate: 2 });
  });

  it('keeps the best minute after the line slows', () => {
    const ledger = new Ledger();
    let t = run(ledger, 0, 120, 'gear', 40);
    t = run(ledger, t, 120, 'gear', 10);
    const row = ledger.rows()[0];
    expect(row.rate).toBe(10);
    expect(row.best).toBe(40);
  });

  it('survives a save, and restarts the graph if time runs backwards', () => {
    const ledger = new Ledger();
    const t = run(ledger, 0, 120, 'copperPlate', 20);
    const back = Ledger.fromSave(JSON.parse(JSON.stringify(ledger.toSave())));
    back.advance(t);
    expect(back.rows()[0]).toMatchObject({ rate: 20, best: 20 });

    back.advance(5);
    expect(back.rows()[0]).toMatchObject({ rate: 0, best: 20 });
  });

  it('keeps the bar still filling across a save', () => {
    const ledger = new Ledger();
    ledger.record([made('stone', 4)], 3);
    const back = Ledger.fromSave(JSON.parse(JSON.stringify(ledger.toSave())));
    back.record([made('stone', 1)], 6);
    back.advance(LEDGER_BUCKET);
    expect(back.rows()[0]).toMatchObject({ item: 'stone', rate: 5 });
  });

  it('drops to zero once nothing arrives, without an event to say so', () => {
    const ledger = new Ledger();
    const t = run(ledger, 0, 120, 'ironOre', 50);
    ledger.advance(t + 90);
    expect(ledger.rows()[0]).toMatchObject({ rate: 0, best: 50 });
  });
});
