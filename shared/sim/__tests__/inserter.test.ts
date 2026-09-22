import { describe, expect, it } from 'vitest';
import { INSERTER_SWING, MACHINES } from '../../data/machines';
import { removeAt } from '../factory';
import { pushOntoBelt } from '../systems/factory';
import { countIn, totalIn } from '../slots';
import type { Belt, Machine } from '../types';
import { advance, at, bench, fill, held, itemsOnBelts, lay, put, totalHeld } from './bench';

/**
 * The inserter is the only way items come back out of a chest, so these tests
 * are about what a chest can now be part of rather than about the arm itself:
 * chest → line, line → chest, and the cases where it must refuse to move
 * something.
 */

const CHEST_SLOT = MACHINES.chest.slotSize;

describe('an inserter emptying a chest', () => {
  /** chest → inserter → belt → chest, the shape that was impossible before. */
  function unloadLine(stock = 20) {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const parts = lay(b, tx, ty, 0, ['chest', 'inserter', 'belt', 'chest']);
    const source = parts[0] as Machine;
    fill(source.input, 'ironPlate', stock, CHEST_SLOT);
    return { b, source, inserter: parts[1] as Machine, target: parts[3] as Machine };
  }

  it('moves what is in the chest onto the belt and into the next chest', () => {
    const { b, source, target } = unloadLine();

    advance(b.world, 20);

    expect(held(target, 'ironPlate')).toBeGreaterThan(0);
    expect(held(source, 'ironPlate')).toBeLessThan(20);
  });

  it('empties the chest completely and loses nothing on the way', () => {
    const { b, source, target } = unloadLine(12);

    // Comfortably longer than twelve swings plus the belt ride.
    advance(b.world, 12 * INSERTER_SWING + 10);

    expect(totalHeld(source)).toBe(0);
    expect(held(target, 'ironPlate')).toBe(12);
    expect(itemsOnBelts(b.world)).toBe(0);
  });

  it('moves no faster than one item per swing', () => {
    const { b, target, inserter } = unloadLine(200);

    const seconds = 30;
    advance(b.world, seconds);

    const delivered = held(target, 'ironPlate') + totalHeld(inserter) + itemsOnBelts(b.world);
    expect(delivered).toBeLessThanOrEqual(Math.floor(seconds / INSERTER_SWING) + 1);
    // And it is actually keeping up, not creeping.
    expect(delivered).toBeGreaterThanOrEqual(Math.floor(seconds / INSERTER_SWING) - 2);
  });
});

describe('an inserter loading a machine', () => {
  it('feeds a furnace out of a chest', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const parts = lay(b, tx, ty, 0, ['chest', 'inserter', ['furnace', 'ironPlate'], 'belt', 'chest']);
    const source = parts[0] as Machine;
    fill(source.input, 'ironOre', 6, CHEST_SLOT);
    const target = parts[4] as Machine;

    advance(b.world, 40);

    expect(held(target, 'ironPlate')).toBe(6);
    expect(totalHeld(source)).toBe(0);
  });

  it('takes a finished plate off a furnace without touching its unsmelted ore', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    // The furnace faces away from the inserter, so the only route out is the arm.
    const furnace = put(b, ['furnace', 'ironPlate'], tx, ty, 3) as Machine;
    const inserter = put(b, 'inserter', tx + 1, ty, 0) as Machine;
    const chest = put(b, 'chest', tx + 2, ty, 0) as Machine;
    fill(furnace.input, 'ironOre', 4, MACHINES.furnace.slotSize);

    advance(b.world, 30);

    expect(held(chest, 'ironPlate')).toBe(4);
    // Ore waiting to be smelted is not the furnace's output and is never taken.
    expect(countIn(chest.input, 'ironOre')).toBe(0);
    expect(totalHeld(inserter)).toBe(0);
  });

  it('pulls items off a belt it runs alongside', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const belts = lay(b, tx, ty, 0, ['belt', 'belt', 'belt']) as Belt[];
    // Under the last belt tile, reaching up into it and down into a chest.
    const chest = put(b, 'chest', tx + 2, ty + 2, 1) as Machine;
    put(b, 'inserter', tx + 2, ty + 1, 1);

    for (let i = 0; i < 4; i++) {
      expect(pushOntoBelt(belts[0], 'gear'), `gear ${i} refused`).toBe(true);
      advance(b.world, 1);
    }
    advance(b.world, 10);

    expect(held(chest, 'gear')).toBe(4);
    expect(itemsOnBelts(b.world)).toBe(0);
  });
});

describe('an inserter that cannot deliver', () => {
  it('holds the item and stalls rather than dropping it', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    // A copper furnace refuses iron ore, so the arm has nowhere to put it.
    const parts = lay(b, tx, ty, 0, ['chest', 'inserter', ['furnace', 'copperPlate']]);
    const source = parts[0] as Machine;
    fill(source.input, 'ironOre', 5, CHEST_SLOT);
    const inserter = parts[1] as Machine;
    const furnace = parts[2] as Machine;

    advance(b.world, 20);

    expect(inserter.stalled).toBe(true);
    // Exactly one item is in the hand; the rest stayed in the chest.
    expect(totalHeld(inserter)).toBe(1);
    expect(held(source, 'ironOre')).toBe(4);
    expect(totalHeld(furnace)).toBe(0);
  });

  it('gives the held item back when it is removed', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const parts = lay(b, tx, ty, 0, ['chest', 'inserter', ['furnace', 'copperPlate']]);
    fill((parts[0] as Machine).input, 'ironOre', 3, CHEST_SLOT);

    advance(b.world, 10);
    const before = countIn(b.player.inventory, 'ironOre');
    expect(removeAt(b.world, b.player, tx + 1, ty)).toBe(true);

    expect(countIn(b.player.inventory, 'ironOre')).toBe(before + 1);
  });

  it('is not a hopper: a belt cannot push items into its hand', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const inserter = put(b, 'inserter', tx, ty, 0) as Machine;
    // A belt pointing straight at the inserter, with nothing behind the arm.
    const feeder = put(b, 'belt', tx, ty - 1, 1) as Belt;
    expect(pushOntoBelt(feeder, 'gear')).toBe(true);

    advance(b.world, 10);

    expect(totalHeld(inserter)).toBe(0);
    // The gear is refused, so it backs up on the belt rather than vanishing.
    expect(itemsOnBelts(b.world)).toBe(1);
  });

  it('does not chain: an inserter will not empty another inserter', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const parts = lay(b, tx, ty, 0, ['chest', 'inserter', 'inserter', 'chest']);
    fill((parts[0] as Machine).input, 'gear', 5, CHEST_SLOT);
    const target = parts[3] as Machine;

    advance(b.world, 20);

    expect(totalIn(target.input)).toBe(0);
  });
});
