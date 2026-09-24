import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { setFilter } from '../factory';
import { pushOntoBelt } from '../systems/factory';
import { countIn } from '../slots';
import type { Belt, Machine } from '../types';
import { advance, at, bench, contents, fill, held, put, totalHeld } from './bench';

/**
 * A filter is what makes one chest a buffer for several lines: the arm feeding
 * each line takes its own item and leaves everything else where it is.
 */

const CHEST_SLOT = MACHINES.chest.slotSize;

/** A mixed chest, an arm, and somewhere for what the arm takes to end up. */
function mixedChest(dy: number) {
  const b = bench();
  const { tx, ty } = at(3, dy);
  const source = put(b, 'chest', tx + 1, ty, 0) as Machine;
  fill(source.input, 'ironPlate', 4, CHEST_SLOT);
  fill(source.input, 'copperPlate', 3, CHEST_SLOT);
  fill(source.input, 'coal', 2, CHEST_SLOT);
  const arm = put(b, 'inserter', tx, ty, 2) as Machine;
  const target = put(b, 'chest', tx - 1, ty, 0) as Machine;
  return { b, source, arm, target };
}

describe('a filtered inserter', () => {
  it('moves only the item it is set to', () => {
    const { b, source, arm, target } = mixedChest(1);
    expect(setFilter(b.world, arm.id, 'copperPlate')).toBe(true);

    advance(b.world, 30);

    expect(contents(target.input)).toEqual(['copperPlate']);
    expect(held(target, 'copperPlate')).toBe(3);
    // Everything else stayed in the chest rather than being shuffled about.
    expect(held(source, 'ironPlate')).toBe(4);
    expect(held(source, 'coal')).toBe(2);
    expect(totalHeld(arm)).toBe(0);
  });

  it('takes anything again once the filter is cleared', () => {
    const { b, source, arm, target } = mixedChest(3);
    expect(setFilter(b.world, arm.id, 'coal')).toBe(true);

    advance(b.world, 10);
    expect(held(target, 'coal')).toBe(2);

    expect(setFilter(b.world, arm.id, null)).toBe(true);
    advance(b.world, 30);

    expect(totalHeld(source)).toBe(0);
    expect(held(target, 'ironPlate')).toBe(4);
    expect(held(target, 'copperPlate')).toBe(3);
  });

  it('lets what it is not set to ride past on a belt', () => {
    const b = bench();
    const { tx, ty } = at(3, 5);
    const line: Belt[] = [];
    for (let i = 0; i < 4; i++) line.push(put(b, 'belt', tx + i, ty, 0) as Belt);
    const end = put(b, 'chest', tx + 4, ty, 0) as Machine;
    // Under the third belt tile, reaching up into the line and down into a chest.
    const arm = put(b, 'inserter', tx + 2, ty + 1, 1) as Machine;
    const side = put(b, 'chest', tx + 2, ty + 2, 0) as Machine;
    expect(setFilter(b.world, arm.id, 'wire')).toBe(true);

    for (const item of ['gear', 'wire', 'gear', 'wire'] as const) {
      expect(pushOntoBelt(line[0], item)).toBe(true);
      advance(b.world, 1);
    }
    advance(b.world, 20);

    expect(held(side, 'wire')).toBe(2);
    expect(contents(side.input)).toEqual(['wire']);
    // The gears were never picked up, so they rode to the end of the line.
    expect(held(end, 'gear')).toBe(2);
    expect(countIn(end.input, 'wire')).toBe(0);
  });

  it('is only a thing inserters have', () => {
    const b = bench();
    const { tx, ty } = at(3, 7);
    const furnace = put(b, ['furnace', 'ironPlate'], tx, ty, 0) as Machine;
    const long = put(b, 'longInserter', tx + 2, ty, 0) as Machine;

    expect(setFilter(b.world, furnace.id, 'ironOre')).toBe(false);
    expect(furnace.filter).toBe(null);
    // Both arms take one, though; the reach and the filter are independent.
    expect(setFilter(b.world, long.id, 'ironOre')).toBe(true);
    expect(long.filter).toBe('ironOre');
  });

  it('keeps holding what it grabbed when the filter changes mid-swing', () => {
    const { b, arm, target } = mixedChest(2);

    // Long enough to have something in hand, short of a full swing.
    advance(b.world, 0.3);
    expect(totalHeld(arm)).toBe(1);
    const grabbed = arm.input[0]!.id;

    expect(setFilter(b.world, arm.id, 'coal')).toBe(true);
    advance(b.world, 30);

    // What is already in the hand is delivered, not dropped on the floor.
    expect(held(target, grabbed)).toBeGreaterThan(0);
    expect(held(target, 'coal')).toBe(2);
  });
});
