import { describe, expect, it } from 'vitest';
import { MACHINES, TRAP_TIME } from '../../data/machines';
import { RECIPES, RECIPE_BY_ID, RECIPE_GROUPS, craftTime, recipeSections, recipesFor } from '../../data/recipes';
import { TECH_BY_ID } from '../../data/techs';
import { TERRAIN_ORDER } from '../terrain';
import { tileKey } from '../grid';
import { setResearch } from '../research';
import { TICK_DT } from '../constants';
import { labCyclesPerMinute, machineRates, recipeSeconds, workSpeed } from '../rates';
import { addItem } from '../inventory';
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

describe('lab and fish trap rates', () => {
  it('quotes a lab in research cycles a minute, and nothing without a tech', () => {
    const b = bench(2026, true);
    const spot = at(2, 3);
    const lab = put(b, 'lab', spot.tx, spot.ty, 0) as Machine;
    b.world.research.current = null;
    expect(labCyclesPerMinute(b.world, lab)).toBe(null);

    setResearch(b.world, 'automation');
    const tech = TECH_BY_ID.get('automation')!;
    expect(labCyclesPerMinute(b.world, lab)).toBeCloseTo(60 / tech.time, 9);
    expect(labCyclesPerMinute(b.world, put(b, 'furnaceMk3', at(6, 3).tx, at(6, 3).ty, 0) as Machine)).toBe(null);
  });

  it('agrees with the cycles a fed lab finishes', () => {
    const b = bench(2026, true);
    const lab = put(b, 'lab', at(2, 3).tx, at(2, 3).ty, 0) as Machine;
    setResearch(b.world, 'automation');
    const tech = TECH_BY_ID.get('automation')!;
    // Research levels reset a tech's bank, so cycles are counted by the packs
    // a cycle swallows instead.
    expect(tech.inputs).toEqual([{ id: 'researchPack', count: tech.inputs[0].count }]);
    fill(lab.input, 'researchPack', 50, MACHINES.lab.slotSize);
    advance(b.world, 120);
    const cycles = (50 - countIn(lab.input, 'researchPack')) / tech.inputs[0].count;
    expect(Math.abs(cycles / 2 - labCyclesPerMinute(b.world, lab)!)).toBeLessThanOrEqual(1);
  });

  it('quotes a fish trap as the expected catch of each drop', () => {
    const b = bench(2026, true);
    addItem(b.player, 'fiber', 200);
    const { tx, ty } = at(4, 3);
    b.world.terrain[tileKey(tx, ty - 1)] = TERRAIN_ORDER.indexOf('water');
    const trap = put(b, 'fishTrap', tx, ty, 0) as Machine;
    const rates = machineRates(b.world, trap);
    expect(rates.map((r) => r.item).sort()).toEqual(['essence', 'fish']);
    const [fish, essence] = [rates.find((r) => r.item === 'fish')!, rates.find((r) => r.item === 'essence')!];
    expect(fish.perMinute + essence.perMinute).toBeCloseTo(60 / TRAP_TIME, 9);
    expect(fish.perMinute).toBeGreaterThan(essence.perMinute);
  });
});

describe('recipe sections', () => {
  it('put every recipe in exactly one section of its machine', () => {
    for (const recipe of RECIPES) expect(Object.keys(RECIPE_GROUPS), recipe.id).toContain(recipe.group);
    for (const machine of ['furnace', 'assembler'] as const) {
      const sections = recipeSections(machine);
      const listed = sections.flatMap((s) => s.recipes.map((r) => r.id)).sort();
      expect(listed).toEqual(recipesFor(machine).map((r) => r.id).sort());
    }
    // The long lists are the reason sections exist.
    expect(recipeSections('assembler').length).toBeGreaterThan(1);
  });
});
