import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { RECIPE_BY_ID, craftTime } from '../../data/recipes';
import { TICK_DT } from '../constants';
import { machineRates, recipeSeconds, workSpeed } from '../rates';
import { countIn } from '../slots';
import type { ItemId, Machine } from '../types';
import { advance, at, bench, fill, plantOre, put, type Bench } from './bench';

function furnace(b: Bench, modules: (ItemId | null)[] = []): Machine {
  const spot = at(2, 3);
  const machine = put(b, ['furnaceMk3', 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
  fill(machine.input, 'ironOre', MACHINES.furnaceMk3.inputSlots * MACHINES.furnaceMk3.slotSize, MACHINES.furnaceMk3.slotSize);
  modules.forEach((id, i) => (machine.modules![i] = id ? { id, count: 1 } : null));
  return machine;
}

/** Plates made in `seconds`, taking them out of the machine as they come. */
function made(b: Bench, m: Machine, seconds: number): number {
  let total = 0;
  for (let t = 0; t < seconds; t += 0.5) {
    advance(b.world, 0.5);
    total += countIn(m.output, 'ironPlate');
    m.output = m.output.map(() => null);
    // Never short of ore, so what is measured is the machine's pace.
    m.input = m.input.map(() => null);
    fill(m.input, 'ironOre', MACHINES.furnaceMk3.inputSlots * MACHINES.furnaceMk3.slotSize, MACHINES.furnaceMk3.slotSize);
  }
  return total;
}

describe('machine rates', () => {
  it('quotes the base time when nothing speeds a machine up', () => {
    const b = bench(2026, true);
    const m = furnace(b);
    const recipe = RECIPE_BY_ID.get('ironPlate')!;
    expect(workSpeed(b.world, m)).toBe(1);
    expect(Math.abs(recipeSeconds(b.world, m, recipe) - craftTime(recipe, MACHINES.furnaceMk3.speed))).toBeLessThan(TICK_DT);
  });

  it('shortens the quoted time by research and modules together', () => {
    const b = bench(2026, true);
    b.world.research.levels.metallurgy = 1;
    const m = furnace(b, ['speedModule', 'outputModule']);
    const recipe = RECIPE_BY_ID.get('ironPlate')!;
    // Research +25%, speed module +50%, output module -15%.
    expect(workSpeed(b.world, m)).toBeCloseTo(1.25 * 1.35, 9);
    const nominal = craftTime(recipe, MACHINES.furnaceMk3.speed) / (1.25 * 1.35);
    // Whole ticks, never faster than the nominal time and less than a tick slower.
    const seconds = recipeSeconds(b.world, m, recipe);
    expect(seconds).toBeGreaterThanOrEqual(nominal - 1e-9);
    expect(seconds - nominal).toBeLessThan(TICK_DT);
  });

  it('agrees with what a furnace really makes in a minute', () => {
    for (const modules of [[], ['speedModule', 'speedModule'], ['outputModule', 'speedModule']] as (ItemId | null)[][]) {
      const b = bench(2026, true);
      b.world.research.levels.metallurgy = 1;
      const m = furnace(b, modules);
      advance(b.world, 1);
      const [rate] = machineRates(b.world, m);
      expect(rate.item).toBe('ironPlate');
      // Within a craft or two of the sampled minute: it starts mid-craft.
      const real = made(b, m, 120) / 2;
      expect(Math.abs(real - rate.perMinute)).toBeLessThan(rate.perMinute * 0.03 + 1);
    }
  });

  it('agrees with a miner, and counts an output module', () => {
    const run = (fitted: boolean): { rate: number; real: number } => {
      const b = bench(2026, true);
      b.world.research.levels.automation = 1;
      const spot = at(2, 3);
      plantOre(b.world, 'ironOre', spot.tx, spot.ty, 100000);
      const miner = put(b, 'minerMk3', spot.tx, spot.ty, 0) as Machine;
      if (fitted) miner.modules = [{ id: 'outputModule', count: 1 }, null];
      let total = 0;
      for (let t = 0; t < 120; t += 0.5) {
        advance(b.world, 0.5);
        total += countIn(miner.output, 'ironOre');
        miner.output = miner.output.map(() => null);
      }
      return { rate: machineRates(b.world, miner)[0].perMinute, real: total / 2 };
    };
    for (const fitted of [false, true]) {
      const { rate, real } = run(fitted);
      expect(Math.abs(real - rate)).toBeLessThan(rate * 0.03 + 1);
    }
  });

  it('reports nothing for a machine with no recipe', () => {
    const b = bench(2026, true);
    const spot = at(2, 3);
    const m = put(b, 'furnaceMk3', spot.tx, spot.ty, 0) as Machine;
    m.recipe = null;
    expect(machineRates(b.world, m)).toEqual([]);
  });
});
