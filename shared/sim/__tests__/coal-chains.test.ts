import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { RECIPES } from '../../data/recipes';
import { ORE_ORDER } from '../ore';
import { insertIntoMachine, pushOntoBelt } from '../systems/factory';
import { countIn } from '../slots';
import type { Belt, ItemId, Machine } from '../types';
import type { Bench } from './bench';
import { advance, at, bench, contents, fill, held, lay, plantOre, put } from './bench';

/**
 * Coal is the third ore the island generates, and until these recipes existed
 * a miner on a coal patch produced nothing anything could use. These lines are
 * built and run the same way a player's are, so what passes here is what a
 * coal patch is actually worth.
 */

describe('the recipe graph', () => {
  it('consumes every ore the island generates', () => {
    for (const ore of ORE_ORDER) {
      if (ore === null) continue;
      const consumed = RECIPES.some((r) => r.inputs.some((i) => i.id === ore));
      expect(consumed, `nothing consumes ${ore}`).toBe(true);
    }
  });

  it('keeps every recipe within its machine’s input slots', () => {
    for (const recipe of RECIPES) {
      const def = MACHINES[recipe.machine];
      const fits = recipe.inputs.length <= def.inputSlots;
      expect(fits, `${recipe.id} needs more input slots than a ${def.name} has`).toBe(true);
    }
  });
});

describe('a steel line', () => {
  /**
   * Iron along the row into a plate furnace, coal up the column, both meeting
   * at a second furnace set to steel.
   */
  it('smelts iron plates and coal into steel', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);

    const row = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      ['furnace', 'steelPlate'],
      'belt',
      'chest',
    ]);
    const steel = row[4] as Machine;
    const chest = row[6] as Machine;

    // The coal feed comes up into the steel furnace from below.
    const coal = at(6, 3);
    plantOre(b.world, 'coal', coal.tx, coal.ty);
    put(b, 'miner', coal.tx, coal.ty, 3);
    put(b, 'belt', coal.tx, coal.ty - 1, 3);

    advance(b.world, 90);

    expect(held(chest, 'steelPlate')).toBeGreaterThan(0);
    // Neither ingredient may ride through to storage unconsumed.
    expect(contents(chest.input)).toEqual(['steelPlate']);
    expect(steel.stalled).toBe(false);
  });

  it('does not let the faster feed take the whole input grid', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);

    const row = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      ['furnace', 'steelPlate'],
      'belt',
      'chest',
    ]);
    const steel = row[4] as Machine;
    const chest = row[6] as Machine;

    const coal = at(6, 3);
    plantOre(b.world, 'coal', coal.tx, coal.ty);
    put(b, 'miner', coal.tx, coal.ty, 3);
    put(b, 'belt', coal.tx, coal.ty - 1, 3);

    // A coal miner outruns the plate line several times over, so the grid fills
    // with coal long before the run ends.
    advance(b.world, 180);

    // It may take one slot and no more; the other stays open for plates.
    expect(held(steel, 'coal')).toBe(MACHINES.furnace.slotSize);
    expect(steel.stalled).toBe(false);
    // And the line is still turning plates into steel at the far end.
    expect(held(chest, 'steelPlate')).toBeGreaterThan(20);
  });
});

describe('a battery line', () => {
  it('assembles copper plates and coal into batteries', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'copperOre', tx, ty);

    const row = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      ['furnace', 'copperPlate'],
      'belt',
      ['assembler', 'battery'],
      'belt',
      'chest',
    ]);
    const chest = row[6] as Machine;

    const coal = at(6, 3);
    plantOre(b.world, 'coal', coal.tx, coal.ty);
    put(b, 'miner', coal.tx, coal.ty, 3);
    put(b, 'belt', coal.tx, coal.ty - 1, 3);

    advance(b.world, 90);

    expect(held(chest, 'battery')).toBeGreaterThan(0);
    expect(contents(chest.input)).toEqual(['battery']);
  });
});

describe('what steel and batteries go on to make', () => {
  /** Hand-fill an assembler's input grid and let it run. */
  function run(recipe: string, parts: Array<[ItemId, number]>, seconds: number): Machine {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const machine = put(b, ['assembler', recipe], tx, ty, 0) as Machine;
    for (const [item, count] of parts) {
      fill(machine.input, item, count, MACHINES.assembler.slotSize);
    }
    advance(b.world, seconds);
    return machine;
  }

  it('assembles a motor from steel and gears', () => {
    const motor = run('motor', [['steelPlate', 10], ['gear', 20]], 20);
    expect(countIn(motor.output, 'motor')).toBeGreaterThan(0);
  });

  it('assembles an advanced circuit from circuits and batteries', () => {
    const adv = run('advancedCircuit', [['circuit', 20], ['battery', 10]], 20);
    expect(countIn(adv.output, 'advancedCircuit')).toBeGreaterThan(0);
  });
});

describe('a machine fed two ingredients down one belt', () => {
  it('keeps a slot for the ingredient that has not arrived yet', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const assembler = put(b, ['assembler', 'circuit'], tx, ty, 0) as Machine;
    const slotSize = MACHINES.assembler.slotSize;

    // A belt run of nothing but gears: whatever arrives first must not be able
    // to take the whole grid, or the wire behind it could never get in.
    for (let i = 0; i < slotSize * 4; i++) insertIntoMachine(assembler, 'gear');

    expect(countIn(assembler.input, 'gear')).toBe(slotSize);
    expect(insertIntoMachine(assembler, 'wire')).toBe(true);
  });

  it('still assembles when one line saturates long before the other starts', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    // One belt per ingredient into the same assembler, the way a player feeds a
    // two-input recipe: gears along the row, wire up from the row below.
    const gears = put(b, 'belt', tx, ty, 0) as Belt;
    const assembler = put(b, ['assembler', 'circuit'], tx + 1, ty, 0) as Machine;
    put(b, 'belt', tx + 2, ty, 0);
    const chest = put(b, 'chest', tx + 3, ty, 0) as Machine;
    const wires = put(b, 'belt', tx + 1, ty + 1, 3) as Belt;

    // The gear line runs first and backs right up against the assembler.
    flood(b, gears, 'gear', 40);
    expect(countIn(assembler.input, 'gear')).toBe(MACHINES.assembler.slotSize);

    // The wire line starting later must still be able to get in.
    flood(b, wires, 'wire', 40);

    expect(held(chest, 'circuit')).toBeGreaterThan(0);
  });
});

/** Push one item onto a belt as often as it will take it, for a stretch of sim time. */
function flood(b: Bench, belt: Belt, item: ItemId, seconds: number): void {
  const slice = 1 / 30;
  for (let elapsed = 0; elapsed < seconds; elapsed += slice) {
    pushOntoBelt(belt, item);
    advance(b.world, slice);
  }
}
