import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../constants';
import { mergerSources, removeAt } from '../factory';
import { countIn, totalIn } from '../slots';
import { pushOntoBelt } from '../systems/factory';
import type { Belt, ItemId, Machine, World } from '../types';
import { advance, at, bench, itemsOnBelts, put } from './bench';

/**
 * A merger is the splitter read backwards: belts run into its sides and out of
 * its front as one line. What matters is that a full line ahead is shared
 * between the belts feeding it rather than handed to whichever ticks first.
 */

/** Two belts running into a merger's sides, one belt out of it into a chest. */
function join() {
  const b = bench();
  const mid = at(3, 3);
  const merger = put(b, 'merger', mid.tx, mid.ty, 0) as Machine;
  const [l, , r] = mergerSources(merger);
  // Facing east, left is north: that belt runs south into it, the other north.
  const left = put(b, 'belt', l.tx, l.ty, 1) as Belt;
  const right = put(b, 'belt', r.tx, r.ty, 3) as Belt;
  const out = put(b, 'belt', mid.tx + 1, mid.ty, 0) as Belt;
  const chest = put(b, 'chest', mid.tx + 2, mid.ty, 0) as Machine;
  return { b, merger, left, right, out, chest };
}

/** Keep a belt as full as it will go, standing in for a busy line upstream. */
function keepFull(world: World, seconds: number, feeds: Array<[Belt, ItemId]>): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    for (const [belt, item] of feeds) while (pushOntoBelt(belt, item));
    advance(world, TICK_DT);
  }
}

describe('a merger joining two belts', () => {
  it('shares the line ahead evenly between two full belts', () => {
    const { b, left, right, chest } = join();

    keepFull(b.world, 40, [
      [left, 'ironPlate'],
      [right, 'copperPlate'],
    ]);

    const iron = countIn(chest.input, 'ironPlate');
    const copper = countIn(chest.input, 'copperPlate');
    expect(iron + copper).toBeGreaterThan(20);
    // Turn by turn, so neither side can get more than a buffer ahead.
    expect(Math.abs(iron - copper)).toBeLessThanOrEqual(4);
  });

  it('passes everything through when only one side has anything', () => {
    const { b, merger, right, chest } = join();
    for (let i = 0; i < 3; i++) {
      expect(pushOntoBelt(right, 'coal')).toBe(true);
      advance(b.world, 1);
    }
    advance(b.world, 10);

    expect(countIn(chest.input, 'coal')).toBe(3);
    expect(totalIn(merger.input)).toBe(0);
    expect(itemsOnBelts(b.world)).toBe(0);
  });

  it('takes a straight line through from behind as well', () => {
    const { b, merger, chest } = join();
    const back = mergerSources(merger)[1];
    const feed = put(b, 'belt', back.tx, back.ty, 0) as Belt;
    pushOntoBelt(feed, 'stone');

    advance(b.world, 10);

    expect(countIn(chest.input, 'stone')).toBe(1);
  });

  it('holds on to what it cannot pass on, and never pulls from a belt leaving it', () => {
    const { b, merger, left, out } = join();
    // Turn the way out round so it points back at the merger.
    expect(removeAt(b.world, b.player, out.tx, out.ty)).toBe(true);
    const backwards = put(b, 'belt', out.tx, out.ty, 2) as Belt;
    pushOntoBelt(left, 'ironPlate');
    pushOntoBelt(backwards, 'coal');

    advance(b.world, 10);

    expect(countIn(merger.input, 'ironPlate')).toBe(1);
    expect(merger.stalled).toBe(true);
    // A belt pointing into the front is the way out, not a feed, so its coal
    // waits at the merger's face rather than going round in a circle.
    expect(countIn(merger.input, 'coal')).toBe(0);
  });
});
