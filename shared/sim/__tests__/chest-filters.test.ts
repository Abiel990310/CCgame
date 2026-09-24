import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../data/items';
import { MACHINES } from '../../data/machines';
import { clickSlot, quickMove, sortArea } from '../containers';
import { setSlotFilter } from '../factory';
import { addItem } from '../inventory';
import { countIn } from '../slots';
import { insertIntoMachine } from '../systems/factory';
import type { Machine } from '../types';
import { advance, at, bench, fill, held, put } from './bench';

/**
 * A filtered chest slot is kept for one item. That is what lets a buffer on a
 * mixed line hold room for the item the next line is short of, rather than
 * filling up with whichever item arrives most.
 */

const CAP = MACHINES.chest.slotSize;

function chest(dy = 1) {
  const b = bench();
  const { tx, ty } = at(4, dy);
  const box = put(b, 'chest', tx, ty, 0) as Machine;
  b.player.inventory.fill(null);
  return { b, box };
}

describe('filtered chest slots', () => {
  it('start open on a new chest, one per slot', () => {
    const { box } = chest();
    expect(box.filters).toEqual(new Array(MACHINES.chest.inputSlots).fill(null));
  });

  it('keep room for their item when a line floods the chest with another', () => {
    const { b, box } = chest();
    expect(setSlotFilter(b.world, box.id, 6, 'copperPlate')).toBe(true);
    expect(setSlotFilter(b.world, box.id, 7, 'copperPlate')).toBe(true);

    let iron = 0;
    while (insertIntoMachine(box, 'ironPlate')) iron++;
    // Six open slots of iron, and not one plate more.
    expect(iron).toBe(6 * Math.min(CAP, ITEMS.ironPlate.stack));
    expect(box.input[6]).toBe(null);
    expect(box.input[7]).toBe(null);

    expect(insertIntoMachine(box, 'copperPlate')).toBe(true);
    expect(box.input[6]).toEqual({ id: 'copperPlate', count: 1 });
  });

  it('fill their own slots before the open ones', () => {
    const { b, box } = chest();
    setSlotFilter(b.world, box.id, 5, 'coal');
    insertIntoMachine(box, 'coal');
    expect(box.input[5]).toEqual({ id: 'coal', count: 1 });
    expect(box.input[0]).toBe(null);
  });

  it('refuse the wrong item from a hand as well', () => {
    const { b, box } = chest();
    setSlotFilter(b.world, box.id, 0, 'coal');
    addItem(b.player, 'ironPlate', 10);
    clickSlot(b.world, b.player, null, { area: 'bag', index: 0 });

    expect(clickSlot(b.world, b.player, box.id, { area: 'input', index: 0 })).toBe(false);
    expect(clickSlot(b.world, b.player, box.id, { area: 'input', index: 1 })).toBe(true);
    expect(box.input[1]).toEqual({ id: 'ironPlate', count: 10 });
  });

  it('are skipped by a shift-click that has somewhere else to go', () => {
    const { b, box } = chest();
    for (let i = 0; i < 7; i++) setSlotFilter(b.world, box.id, i, 'coal');
    addItem(b.player, 'stone', 30);

    expect(quickMove(b.world, b.player, box.id, { area: 'bag', index: 0 })).toBe(true);
    expect(box.input[7]).toEqual({ id: 'stone', count: 30 });
    expect(countIn(box.input.slice(0, 7), 'stone')).toBe(0);
  });

  it('are set by the splitter gesture: a held item names it, an empty hand toggles', () => {
    const { b, box } = chest();
    addItem(b.player, 'gear', 3);
    clickSlot(b.world, b.player, null, { area: 'bag', index: 0 });

    expect(clickSlot(b.world, b.player, box.id, { area: 'filter', index: 2 })).toBe(true);
    expect(box.filters?.[2]).toBe('gear');
    // Setting a filter is a label; the held stack is not spent on it.
    expect(b.player.cursor).toEqual({ id: 'gear', count: 3 });

    clickSlot(b.world, b.player, box.id, { area: 'input', index: 2 });
    expect(b.player.cursor).toBe(null);
    // Empty-handed on a filtered slot opens it back up.
    expect(clickSlot(b.world, b.player, box.id, { area: 'filter', index: 2 })).toBe(true);
    expect(box.filters?.[2]).toBe(null);
    // And again keeps it for what it already holds.
    expect(clickSlot(b.world, b.player, box.id, { area: 'filter', index: 2 })).toBe(true);
    expect(box.filters?.[2]).toBe('gear');
  });

  it('keep their place when the chest is sorted', () => {
    const { b, box } = chest();
    setSlotFilter(b.world, box.id, 7, 'coal');
    box.input[0] = { id: 'coal', count: 5 };
    box.input[3] = { id: 'ironPlate', count: 4 };

    expect(sortArea(b.world, b.player, box.id, 'input')).toBe(true);
    expect(box.input[7]).toEqual({ id: 'coal', count: 5 });
    expect(box.input[0]).toEqual({ id: 'ironPlate', count: 4 });
  });

  it('leave a stack of something else where it is, and add nothing to it', () => {
    const { b, box } = chest();
    box.input[0] = { id: 'ironPlate', count: 4 };
    setSlotFilter(b.world, box.id, 0, 'coal');
    for (let i = 0; i < 7; i++) box.input[i + 1] = { id: 'stone', count: 1 };

    expect(insertIntoMachine(box, 'ironPlate')).toBe(false);
    expect(box.input[0]).toEqual({ id: 'ironPlate', count: 4 });
  });

  it('feed a line through an arm like any other chest', () => {
    const b = bench();
    const { tx, ty } = at(3, 5);
    const source = put(b, 'chest', tx + 1, ty, 0) as Machine;
    fill(source.input, 'ironPlate', 20, CAP);
    const arm = put(b, 'inserter', tx, ty, 2) as Machine;
    const target = put(b, 'chest', tx - 1, ty, 0) as Machine;
    for (let i = 0; i < 8; i++) setSlotFilter(b.world, target.id, i, 'copperPlate');

    advance(b.world, 30);
    // Every slot is kept for copper, so the iron has nowhere to go.
    expect(held(target, 'ironPlate')).toBe(0);
    expect(held(arm, 'ironPlate')).toBe(1);

    setSlotFilter(b.world, target.id, 0, null);
    advance(b.world, 30);
    expect(held(target, 'ironPlate')).toBe(20);
  });

  it('carry over to a steel chest built on top, with the new slots open', () => {
    const { b, box } = chest(7);
    setSlotFilter(b.world, box.id, 3, 'coal');
    addItem(b.player, 'steelChest', 1);
    const upgraded = put(b, 'steelChest', box.tx, box.ty, 0) as Machine;

    expect(upgraded.id).toBe(box.id);
    expect(upgraded.filters).toHaveLength(MACHINES.steelChest.inputSlots);
    expect(upgraded.filters?.[3]).toBe('coal');
    expect(upgraded.filters?.filter((f) => f !== null)).toEqual(['coal']);
  });
});
