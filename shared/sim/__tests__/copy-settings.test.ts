import { describe, expect, it } from 'vitest';
import {
  copySettings,
  pasteSettings,
  setFilter,
  setRecipe,
  setSideFilter,
  setSlotFilter,
} from '../factory';
import type { Machine } from '../types';
import { at, bench, put } from './bench';

/**
 * A bank of filtered arms or a row of furnaces on steel is the same setting
 * made a dozen times. Copying it is one read and one write per machine.
 */

describe('copying settings between machines', () => {
  it('puts an arm filter on another arm, long or short', () => {
    const b = bench();
    const from = put(b, 'inserter', ...xy(1), 0) as Machine;
    const to = put(b, 'longInserter', ...xy(3), 0) as Machine;
    setFilter(b.world, from.id, 'coal');

    expect(pasteSettings(b.world, to.id, copySettings(from))).toBe(true);
    expect(to.filter).toBe('coal');
  });

  it('clears a filter when the copied arm has none', () => {
    const b = bench();
    const from = put(b, 'inserter', ...xy(1), 0) as Machine;
    const to = put(b, 'inserter', ...xy(3), 0) as Machine;
    setFilter(b.world, to.id, 'coal');

    pasteSettings(b.world, to.id, copySettings(from));
    expect(to.filter).toBe(null);
  });

  it('carries a recipe across tiers of one family', () => {
    const b = bench();
    const from = put(b, 'furnace', ...xy(1), 0) as Machine;
    const to = put(b, 'furnaceMk2', ...xy(3), 0) as Machine;
    expect(setRecipe(b.world, from.id, 'steelPlate')).toBe(true);

    expect(pasteSettings(b.world, to.id, copySettings(from))).toBe(true);
    expect(to.recipe).toBe('steelPlate');
  });

  it('copies both sides of a splitter and every slot of a chest', () => {
    const b = bench();
    const split = put(b, 'splitter', ...xy(1), 0) as Machine;
    const split2 = put(b, 'splitter', ...xy(4), 0) as Machine;
    setSideFilter(b.world, split.id, 1, 'ironPlate');
    pasteSettings(b.world, split2.id, copySettings(split));
    expect(split2.filters).toEqual([null, 'ironPlate']);

    const box = put(b, 'chest', ...xy(7), 0) as Machine;
    const box2 = put(b, 'chest', ...xy(9), 0) as Machine;
    setSlotFilter(b.world, box.id, 0, 'coal');
    setSlotFilter(b.world, box.id, 7, 'gear');
    pasteSettings(b.world, box2.id, copySettings(box));
    expect(box2.filters).toEqual(box.filters);
    // A copy, not the same array: changing one chest later leaves the other.
    setSlotFilter(b.world, box.id, 0, null);
    expect(box2.filters?.[0]).toBe('coal');
  });

  it('refuses a machine of another family and moves no items', () => {
    const b = bench();
    const arm = put(b, 'inserter', ...xy(1), 0) as Machine;
    const furnace = put(b, 'furnace', ...xy(3), 0) as Machine;
    setFilter(b.world, arm.id, 'coal');
    furnace.input[0] = { id: 'ironOre', count: 3 };
    const recipe = furnace.recipe;

    expect(pasteSettings(b.world, furnace.id, copySettings(arm))).toBe(false);
    expect(furnace.recipe).toBe(recipe);
    expect(furnace.input[0]).toEqual({ id: 'ironOre', count: 3 });
  });

  it('reports nothing changed when the settings already match', () => {
    const b = bench();
    const a = put(b, 'inserter', ...xy(1), 0) as Machine;
    const c = put(b, 'inserter', ...xy(3), 0) as Machine;
    expect(pasteSettings(b.world, c.id, copySettings(a))).toBe(false);
  });
});

function xy(dx: number): [number, number] {
  const { tx, ty } = at(dx, 2);
  return [tx, ty];
}
