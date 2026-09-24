import { describe, expect, it } from 'vitest';
import { INSERTER_SWING, MACHINES } from '../../data/machines';
import { RECIPE_BY_ID, craftTime } from '../../data/recipes';
import { countIn, totalIn } from '../slots';
import type { Belt, Machine, MachineId } from '../types';
import { advance, at, bench, fill, held, itemsOnBelts, put, stoke, totalHeld } from './bench';

/**
 * The later arms exist because a Mk3 furnace eats ore faster than the first
 * arm can carry it. So these are throughput tests: what one arm gets through
 * in a window, against what the machine it feeds could use.
 */

const CHEST_SLOT = MACHINES.chest.slotSize;

/** chest → arm → electric furnace; returns the plates smelted in `seconds`. */
function feedFurnace(arm: MachineId, seconds: number): number {
  const b = bench();
  const { tx, ty } = at(3, 2);
  const chest = put(b, 'chest', tx + 1, ty, 0) as Machine;
  fill(chest.input, 'ironOre', 400, CHEST_SLOT);
  put(b, arm, tx, ty, 2);
  const furnace = put(b, ['furnaceMk3', 'ironPlate'], tx - 1, ty, 3) as Machine;
  // An electric furnace burns coal, and this is a test of the arm, not the fuel.
  stoke(furnace);

  advance(b.world, seconds);
  return countIn(furnace.output, 'ironPlate');
}

describe('the arm tiers', () => {
  const seconds = 20;
  const recipe = RECIPE_BY_ID.get('ironPlate')!;
  const furnaceRate = 1 / craftTime(recipe, MACHINES.furnaceMk3.speed);

  it('starve an electric furnace with the first arm', () => {
    const plates = feedFurnace('inserter', seconds);
    expect(plates).toBeLessThan(furnaceRate * seconds * 0.9);
  });

  it('keep an electric furnace fed with one fast arm', () => {
    const plates = feedFurnace('fastInserter', seconds);
    // A second's worth of slack for the first swing and the first craft.
    expect(plates).toBeGreaterThanOrEqual(Math.floor(furnaceRate * (seconds - 1.5)));
  });

  it('move a whole hand per swing with the stack arm', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    const chest = put(b, 'chest', tx + 1, ty, 0) as Machine;
    fill(chest.input, 'gear', 400, CHEST_SLOT);
    put(b, 'stackInserter', tx, ty, 2);
    const target = put(b, 'chest', tx - 1, ty, 0) as Machine;

    const window = 6;
    advance(b.world, window);

    const def = MACHINES.stackInserter;
    const swings = Math.floor((window * def.speed) / INSERTER_SWING);
    const delivered = held(target, 'gear');
    expect(delivered % def.slotSize).toBe(0);
    // Ticks round each swing up a little, so allow a few short of the ideal.
    expect(delivered).toBeGreaterThanOrEqual(swings * def.slotSize * 0.8);
    expect(delivered).toBeLessThanOrEqual((swings + 1) * def.slotSize);
  });

  it('lift only one kind of item per swing', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    const chest = put(b, 'chest', tx + 1, ty, 0) as Machine;
    fill(chest.input, 'gear', 1, CHEST_SLOT);
    fill(chest.input, 'wire', 3, CHEST_SLOT);
    const arm = put(b, 'stackInserter', tx, ty, 2) as Machine;
    // Nothing in front to take it, so the first grab stays in the hand.
    advance(b.world, 1);

    expect(arm.input[0]).toEqual({ id: 'gear', count: 1 });
    expect(countIn(chest.input, 'wire')).toBe(3);
  });

  it('unload a stack onto a belt without losing an item or flashing red', () => {
    const b = bench();
    const { tx, ty } = at(12, 3);
    const chest = put(b, 'chest', tx + 1, ty, 0) as Machine;
    fill(chest.input, 'ironPlate', 40, CHEST_SLOT);
    const arm = put(b, 'stackInserter', tx, ty, 2) as Machine;
    // A lane long enough to carry everything away into a chest at its end.
    const lane: Belt[] = [];
    for (let i = 1; i <= 4; i++) lane.push(put(b, 'belt', tx - i, ty, 2) as Belt);
    const sink = put(b, 'chest', tx - 5, ty, 0) as Machine;

    let redTicks = 0;
    for (let i = 0; i < 30 * 20; i++) {
      advance(b.world, 1 / 20);
      if (arm.stalled) redTicks++;
    }

    expect(held(sink, 'ironPlate')).toBe(40);
    expect(totalIn(chest.input) + totalHeld(arm) + itemsOnBelts(b.world)).toBe(0);
    expect(redTicks).toBe(0);
  });

  it('stall a stack arm with its hand kept when the target is full', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    const chest = put(b, 'chest', tx + 1, ty, 0) as Machine;
    fill(chest.input, 'gear', 10, CHEST_SLOT);
    const arm = put(b, 'stackInserter', tx, ty, 2) as Machine;
    const target = put(b, 'chest', tx - 1, ty, 0) as Machine;
    // Every slot of the target full of something else.
    fill(target.input, 'stone', MACHINES.chest.inputSlots * CHEST_SLOT, CHEST_SLOT);

    advance(b.world, 5);

    expect(arm.stalled).toBe(true);
    expect(arm.input[0]).toEqual({ id: 'gear', count: 4 });
    expect(held(chest, 'gear') + 4).toBe(10);
  });
});

describe('the steel chest', () => {
  it('stores twice what a wooden chest does', () => {
    const wood = MACHINES.chest;
    const steel = MACHINES.steelChest;
    expect(steel.inputSlots * steel.slotSize).toBe(2 * wood.inputSlots * wood.slotSize);
  });

  it('empties through an arm like any chest', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    const box = put(b, 'steelChest', tx + 1, ty, 0) as Machine;
    fill(box.input, 'copperPlate', 3000, MACHINES.steelChest.slotSize);
    const arm = put(b, 'fastInserter', tx, ty, 2) as Machine;
    const target = put(b, 'chest', tx - 1, ty, 0) as Machine;

    advance(b.world, 10);

    const moved = held(target, 'copperPlate');
    expect(moved).toBeGreaterThan(30);
    expect(held(box, 'copperPlate') + totalHeld(arm) + moved).toBe(3000);
  });
});
