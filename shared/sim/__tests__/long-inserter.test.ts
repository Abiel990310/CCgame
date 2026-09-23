import { describe, expect, it } from 'vitest';
import { INSERTER_SWING, MACHINES } from '../../data/machines';
import { pushOntoBelt } from '../systems/factory';
import { countIn } from '../slots';
import type { Belt, Machine } from '../types';
import { advance, at, bench, fill, held, put, totalHeld } from './bench';

/**
 * The long inserter exists for one layout: a machine on one side of a belt fed
 * from the other side, without breaking the belt. So the tests are about what
 * it reaches over rather than about the arm itself.
 */

const CHEST_SLOT = MACHINES.chest.slotSize;

/**
 * chest → (belt) → arm → (belt) → furnace, laid out along a row with a belt
 * lane crossing on each side of the arm. Both lanes run downward and feed
 * nothing, so anything that lands on one has visibly been taken by mistake.
 */
function acrossTheBelt(type: 'inserter' | 'longInserter') {
  const b = bench();
  const { tx, ty } = at(3, 2);

  const furnace = put(b, ['furnace', 'ironPlate'], tx - 2, ty, 3) as Machine;
  const near = put(b, 'belt', tx - 1, ty, 1) as Belt;
  // Facing left, so it reaches right for the chest and left for the furnace.
  const arm = put(b, type, tx, ty, 2) as Machine;
  const far = put(b, 'belt', tx + 1, ty, 1) as Belt;
  const chest = put(b, 'chest', tx + 2, ty, 0) as Machine;
  fill(chest.input, 'ironOre', 6, CHEST_SLOT);

  return { b, furnace, near, far, arm, chest };
}

describe('a long inserter', () => {
  it('loads a machine from two tiles away, over the belt in between', () => {
    const { b, furnace, chest } = acrossTheBelt('longInserter');

    advance(b.world, 40);

    expect(countIn(furnace.output, 'ironPlate')).toBe(6);
    expect(totalHeld(chest)).toBe(0);
  });

  it('leaves the belt it reaches over alone', () => {
    const { b, near, far } = acrossTheBelt('longInserter');
    expect(pushOntoBelt(far, 'gear')).toBe(true);

    advance(b.world, 40);

    // The gear rode to the end of a belt that feeds nothing and stayed there:
    // the arm passed over it in both directions without touching it.
    expect(far.items.map((i) => i.item)).toEqual(['gear']);
    expect(near.items).toHaveLength(0);
  });

  it('is what the layout needs: a short arm in the same tile cannot do it', () => {
    const { b, furnace, chest, near, far } = acrossTheBelt('inserter');
    expect(pushOntoBelt(far, 'ironOre')).toBe(true);

    advance(b.world, 40);

    // One tile of reach takes off the belt lane and drops on the other lane;
    // the chest two tiles away and the furnace beyond it are both out of range.
    expect(near.items.map((i) => i.item)).toEqual(['ironOre']);
    expect(far.items).toHaveLength(0);
    expect(countIn(furnace.output, 'ironPlate')).toBe(0);
    expect(held(chest, 'ironOre')).toBe(6);
  });

  it('swings slower than the short arm, as the longer reach should', () => {
    const b = bench();
    const { tx, ty } = at(3, 5);
    const chest = put(b, 'chest', tx + 2, ty, 0) as Machine;
    fill(chest.input, 'gear', 200, CHEST_SLOT);
    put(b, 'longInserter', tx, ty, 2);
    const target = put(b, 'chest', tx - 2, ty, 0) as Machine;

    const seconds = 30;
    advance(b.world, seconds);

    const swings = (seconds * MACHINES.longInserter.speed) / INSERTER_SWING;
    const delivered = held(target, 'gear');
    expect(delivered).toBeLessThanOrEqual(Math.floor(swings) + 1);
    expect(delivered).toBeGreaterThanOrEqual(Math.floor(swings) - 2);
    // And slower than the one-tile arm would have been over the same window.
    expect(delivered).toBeLessThan(Math.floor(seconds / INSERTER_SWING));
  });

  it('will not empty another inserter, long or short', () => {
    const b = bench();
    const { tx, ty } = at(3, 7);
    const chest = put(b, 'chest', tx + 2, ty, 0) as Machine;
    fill(chest.input, 'gear', 5, CHEST_SLOT);
    // A short arm standing in the way, facing across the line and idle.
    const short = put(b, 'inserter', tx + 1, ty, 3) as Machine;
    put(b, 'longInserter', tx, ty, 2);
    const target = put(b, 'chest', tx - 2, ty, 0) as Machine;

    advance(b.world, 20);

    // It reached over the arm into the chest behind it, and took nothing
    // from the arm itself.
    expect(held(target, 'gear')).toBe(5);
    expect(totalHeld(short)).toBe(0);
  });
});
