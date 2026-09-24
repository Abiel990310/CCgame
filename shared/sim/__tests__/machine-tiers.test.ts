import { describe, expect, it } from 'vitest';
import { MACHINES, MACHINE_ORDER } from '../../data/machines';
import { RECIPE_BY_ID, recipesFor } from '../../data/recipes';
import { placeMachine, setRecipe } from '../factory';
import { countIn, totalIn } from '../slots';
import type { Belt, ItemId, Machine, MachineId } from '../types';
import { addPlayer } from '../world';
import { advance, at, bench, fill, lay, plantOre, put } from './bench';

const TIERED: MachineId[] = MACHINE_ORDER.filter((id) => MACHINES[id].tier > 1);

/** Items a later tier is supposed to drain off the end of the chain. */
const SINK: ItemId[] = ['steelPlate', 'motor', 'advancedCircuit'];

describe('the tier table', () => {
  it('has a tier 2 and a tier 3 for every machine that crafts or mines', () => {
    for (const family of ['miner', 'furnace', 'assembler'] as MachineId[]) {
      const tiers = MACHINE_ORDER.filter((id) => MACHINES[id].family === family).map(
        (id) => MACHINES[id].tier,
      );
      expect(tiers, family).toEqual([1, 2, 3]);
    }
  });

  it('points every tier at a family that is itself a tier 1 machine', () => {
    for (const id of MACHINE_ORDER) {
      const family = MACHINES[MACHINES[id].family];
      expect(family, id).toBeDefined();
      expect(family.tier, id).toBe(1);
    }
  });

  it('spends steel, motors or advanced circuits on every later tier', () => {
    for (const id of TIERED) {
      const spends = MACHINES[id].cost.some((c) => SINK.includes(c.id));
      expect(spends, `${id} costs nothing from the steel chain`).toBe(true);
    }
  });

  // A rung up is worth more than the one below it. For most machines that is
  // speed; an arm can also carry more per swing, and a chest is only storage.
  const worth = (id: MachineId): number => {
    const def = MACHINES[id];
    if (def.family === 'chest') return def.inputSlots * def.slotSize;
    if (def.family === 'inserter') return def.speed * def.slotSize;
    return def.speed;
  };

  it('gets better with every tier and never worse', () => {
    for (const id of TIERED) {
      const def = MACHINES[id];
      const below = MACHINE_ORDER.find(
        (other) => MACHINES[other].family === def.family && MACHINES[other].tier === def.tier - 1,
      );
      expect(below, id).toBeDefined();
      expect(worth(id), id).toBeGreaterThan(worth(below!));
    }
  });

  it('runs the recipes of its family without a recipe row per tier', () => {
    expect(recipesFor('furnaceMk3').map((r) => r.id)).toEqual(
      recipesFor('furnace').map((r) => r.id),
    );
    expect(recipesFor('assemblerMk2').map((r) => r.id)).toEqual(
      recipesFor('assembler').map((r) => r.id),
    );
    // A miner has no recipes at any tier: it mines whatever it stands on.
    expect(recipesFor('minerMk3')).toEqual([]);
  });
});

describe('building a later tier', () => {
  it('pays for itself out of the steel chain', () => {
    const b = bench();
    const before = countIn(b.player.inventory, 'advancedCircuit');

    plantOre(b.world, 'ironOre', at(0, 0).tx, at(0, 0).ty);
    const machine = put(b, 'minerMk3', at(0, 0).tx, at(0, 0).ty, 0) as Machine;

    expect(machine.type).toBe('minerMk3');
    const cost = MACHINES.minerMk3.cost.find((c) => c.id === 'advancedCircuit')!.count;
    expect(countIn(b.player.inventory, 'advancedCircuit')).toBe(before - cost);
  });

  it('refuses a player who has only wood and stone', () => {
    const b = bench();
    const newcomer = addPlayer(b.world, 'no-steel');
    const spot = at(2, 0);

    expect(placeMachine(b.world, newcomer, 'furnaceMk2', spot.tx, spot.ty, 0)).toBe(null);
    expect(b.world.machines.length).toBe(0);
  });

  it('opens with a recipe already chosen, and takes any of its family', () => {
    const b = bench();
    const spot = at(4, 0);
    const machine = put(b, 'assemblerMk3', spot.tx, spot.ty, 0) as Machine;

    expect(machine.recipe).not.toBe(null);
    expect(RECIPE_BY_ID.get(machine.recipe!)!.machine).toBe('assembler');
    expect(setRecipe(b.world, machine.id, 'advancedCircuit')).toBe(true);
    // A furnace recipe is still a furnace recipe, whatever tier the assembler is.
    expect(setRecipe(b.world, machine.id, 'steelPlate')).toBe(false);
  });

  it('sizes its slot grids from its own definition', () => {
    const b = bench();
    const spot = at(6, 0);
    const machine = put(b, 'furnaceMk3', spot.tx, spot.ty, 0) as Machine;

    expect(machine.input.length).toBe(MACHINES.furnaceMk3.inputSlots);
    expect(machine.output.length).toBe(MACHINES.furnaceMk3.outputSlots);
    expect(machine.input.length).toBeGreaterThan(MACHINES.furnace.inputSlots);
  });
});

/** Plates a stocked furnace of this type turns out in `seconds`. */
function smelted(type: MachineId, seconds: number): number {
  const b = bench();
  const spot = at(0, 2);
  const machine = put(b, [type, 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
  const def = MACHINES[type];
  fill(machine.input, 'ironOre', def.inputSlots * def.slotSize, def.slotSize);
  advance(b.world, seconds);
  return countIn(machine.output, 'ironPlate');
}

/** Ore a miner of this type pulls out of one patch in `seconds`. */
function mined(type: MachineId, seconds: number): number {
  const b = bench();
  const spot = at(0, 4);
  plantOre(b.world, 'ironOre', spot.tx, spot.ty);
  put(b, type, spot.tx, spot.ty, 0);
  advance(b.world, seconds);
  return totalIn(b.world.machines[0].output);
}

describe('what a tier is worth', () => {
  it('doubles smelting at tier 2 and quadruples it at tier 3', () => {
    const base = smelted('furnace', 20);
    expect(base).toBeGreaterThan(0);
    // A craft costs its recipe time plus the tick that restarts it, so the
    // multiplier is approached from below rather than hit exactly.
    expect(smelted('furnaceMk2', 20)).toBeGreaterThan(base * 1.8);
    expect(smelted('furnaceMk3', 20)).toBeGreaterThan(base * 3.4);
  });

  it('doubles and quadruples mining off the same patch', () => {
    const base = mined('miner', 12);
    expect(base).toBe(10);
    expect(mined('minerMk2', 12)).toBe(base * 2);
    expect(mined('minerMk3', 12)).toBe(base * 4);
  });

  it('assembles faster without changing what comes out', () => {
    const b = bench();
    const spot = at(8, 0);
    const machine = put(b, ['assemblerMk2', 'gear'], spot.tx, spot.ty, 0) as Machine;
    fill(machine.input, 'ironPlate', 80, MACHINES.assemblerMk2.slotSize);

    advance(b.world, 9);
    // 1.5s a gear at speed 2 is 0.75s, so six gears in nine seconds.
    expect(countIn(machine.output, 'gear')).toBeGreaterThanOrEqual(6);
  });
});

describe('a tiered line end to end', () => {
  it('delivers more to the chest than the same line one tier down', () => {
    const run = (miner: MachineId, furnace: MachineId): number => {
      const b = bench();
      const start = at(0, 6);
      plantOre(b.world, 'ironOre', start.tx, start.ty);
      const parts = lay(b, start.tx, start.ty, 0, [
        miner,
        'belt',
        'belt',
        [furnace, 'ironPlate'],
        'belt',
        'chest',
      ]);
      advance(b.world, 40);
      return countIn((parts[5] as Machine).input, 'ironPlate');
    };

    const base = run('miner', 'furnace');
    const upgraded = run('minerMk3', 'furnaceMk3');
    expect(base).toBeGreaterThan(0);
    expect(upgraded).toBeGreaterThan(base * 2);
  });

  it('keeps both steel ingredients able to enter a wider furnace', () => {
    const b = bench();
    const spot = at(10, 2);
    const machine = put(b, ['furnaceMk3', 'steelPlate'], spot.tx, spot.ty, 0) as Machine;

    // One belt carrying a saturating stream of iron must not take the grid.
    const feed = put(b, 'belt', spot.tx - 1, spot.ty, 0) as Belt;
    for (let i = 0; i < 400; i++) {
      if (feed.items.length < 4) feed.items.push({ item: 'ironPlate', offset: 0 });
      advance(b.world, 0.25);
    }

    const def = MACHINES.furnaceMk3;
    const share = Math.floor(def.inputSlots / 2) * def.slotSize;
    expect(countIn(machine.input, 'ironPlate')).toBeGreaterThan(0);
    expect(countIn(machine.input, 'ironPlate')).toBeLessThanOrEqual(share);
    // Coal can still get in after all that iron, which is the deadlock guard.
    fill(machine.input, 'coal', 1, def.slotSize);
    advance(b.world, 3);
    expect(countIn(machine.output, 'steelPlate')).toBeGreaterThan(0);
  });
});
