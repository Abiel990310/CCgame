import { describe, expect, it } from 'vitest';
import { FUEL_RESERVE, FUEL_VALUE, MACHINES, MACHINE_ORDER } from '../../data/machines';
import { RECIPE_BY_ID } from '../../data/recipes';
import { clickSlot, quickMove } from '../containers';
import { removeAt } from '../factory';
import { addItem, countItem } from '../inventory';
import { countIn } from '../slots';
import type { Belt, Machine, MachineId } from '../types';
import { advance, at, bench, fill, put, stoke, type Bench } from './bench';

/** A stocked furnace of this type with `coal` in its fuel grid and nothing else. */
function furnace(b: Bench, type: MachineId, coal: number, dx = 0): Machine {
  const spot = at(dx, 2);
  const machine = put(b, [type, 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
  fill(machine.input, 'ironOre', 100, MACHINES[type].slotSize);
  if (coal > 0) fill(machine.fuel!, 'coal', coal);
  return machine;
}

/** Keep a belt topped up with one item, the way a saturated line would be. */
function feed(belt: Belt, item: 'coal' | 'ironOre' | 'ironPlate'): void {
  if (belt.items.length < 4 && (belt.items.at(-1)?.offset ?? 1) >= 0.25) {
    belt.items.push({ item, offset: 0 });
  }
}

describe('which machines burn fuel', () => {
  it('gives every tier 2 and tier 3 furnace and assembler a fuel slot, and nothing else', () => {
    for (const id of MACHINE_ORDER) {
      const def = MACHINES[id];
      const burner = (def.family === 'furnace' || def.family === 'assembler') && def.tier > 1;
      expect(def.fuelSlots > 0, id).toBe(burner);
    }
  });

  it('builds a burner with an empty fuel grid, and a stone furnace with none', () => {
    const b = bench();
    const steel = put(b, 'furnaceMk2', at(0, 0).tx, at(0, 0).ty, 0) as Machine;
    const stone = put(b, 'furnace', at(2, 0).tx, at(2, 0).ty, 0) as Machine;

    expect(steel.fuel).toEqual([null]);
    expect(steel.heat).toBe(0);
    expect(stone.fuel).toBeUndefined();
  });
});

describe('burning coal', () => {
  it('stalls a burner with no fuel and leaves its ore in the grid', () => {
    const b = bench();
    const machine = furnace(b, 'furnaceMk2', 0);

    advance(b.world, 5);
    expect(machine.stalled).toBe(true);
    expect(countIn(machine.output, 'ironPlate')).toBe(0);
    expect(countIn(machine.input, 'ironOre')).toBe(100);
  });

  it('keeps a stone furnace running without any fuel at all', () => {
    const b = bench();
    const machine = furnace(b, 'furnace', 0);

    advance(b.world, 5);
    expect(countIn(machine.output, 'ironPlate')).toBeGreaterThan(0);
  });

  it('smelts the same plates per coal at tier 2 and tier 3', () => {
    const perCoal = FUEL_VALUE.coal! / RECIPE_BY_ID.get('ironPlate')!.time;
    for (const type of ['furnaceMk2', 'furnaceMk3'] as MachineId[]) {
      const b = bench();
      const machine = furnace(b, type, 2);
      advance(b.world, 30);
      // Two coal is eight plates in every tier; the last may still be in the
      // furnace when the heat runs out, but none beyond it is paid for.
      const made = countIn(machine.output, 'ironPlate');
      expect(made, type).toBeGreaterThanOrEqual(2 * perCoal - 1);
      expect(made, type).toBeLessThanOrEqual(2 * perCoal);
      expect(machine.stalled, type).toBe(true);
    }
  });

  it('pauses a craft that runs dry and finishes it once coal arrives', () => {
    const b = bench();
    const machine = furnace(b, 'furnaceMk2', 0);
    machine.heat = 0.5;

    advance(b.world, 3);
    expect(machine.stalled).toBe(true);
    expect(machine.progress).toBeGreaterThan(0);
    const before = countIn(machine.input, 'ironOre');

    fill(machine.fuel!, 'coal', 1);
    advance(b.world, 1.2);
    expect(countIn(machine.output, 'ironPlate')).toBeGreaterThanOrEqual(1);
    // The paused craft had already paid its ore; resuming must not charge twice.
    expect(countIn(machine.input, 'ironOre')).toBeGreaterThanOrEqual(before - 2);
  });

  it('burns coal in an assembler the same way', () => {
    const b = bench();
    const spot = at(8, 0);
    const machine = put(b, ['assemblerMk2', 'gear'], spot.tx, spot.ty, 0) as Machine;
    fill(machine.input, 'ironPlate', 40, MACHINES.assemblerMk2.slotSize);

    advance(b.world, 3);
    expect(countIn(machine.output, 'gear')).toBe(0);
    stoke(machine, 1);
    advance(b.world, 3);
    expect(countIn(machine.output, 'gear')).toBeGreaterThan(0);
  });
});

describe('fuel off a belt', () => {
  it('runs a steel furnace fed ore on one belt and coal on another', () => {
    const b = bench();
    const spot = at(4, 4);
    const machine = put(b, ['furnaceMk2', 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
    // Ore from the west, coal from the north: the two-belt bank the fuel slot
    // exists to ask for.
    const ore = put(b, 'belt', spot.tx - 1, spot.ty, 0) as Belt;
    const coal = put(b, 'belt', spot.tx, spot.ty - 1, 1) as Belt;
    put(b, 'chest', spot.tx + 1, spot.ty, 0);

    for (let i = 0; i < 160; i++) {
      feed(ore, 'ironOre');
      feed(coal, 'coal');
      advance(b.world, 0.25);
    }

    const chest = b.world.machines.find((m) => m.type === 'chest')!;
    expect(countIn(chest.input, 'ironPlate')).toBeGreaterThan(25);
    expect(countIn(machine.fuel!, 'coal')).toBeGreaterThan(0);
    // Coal is not a plate ingredient, so none of it may land in the ore grid.
    expect(countIn(machine.input, 'coal')).toBe(0);
  });

  it('splits one coal belt between fuel and the steel recipe', () => {
    const b = bench();
    const spot = at(10, 4);
    const machine = put(b, ['furnaceMk2', 'steelPlate'], spot.tx, spot.ty, 0) as Machine;
    fill(machine.input, 'ironPlate', 50, MACHINES.furnaceMk2.slotSize);
    const coal = put(b, 'belt', spot.tx, spot.ty - 1, 1) as Belt;

    for (let i = 0; i < 120; i++) {
      feed(coal, 'coal');
      advance(b.world, 0.25);
    }

    expect(countIn(machine.fuel!, 'coal')).toBeGreaterThanOrEqual(FUEL_RESERVE - 1);
    expect(countIn(machine.output, 'steelPlate')).toBeGreaterThan(0);
  });

  it('refuses coal into a stone furnace that is not making steel', () => {
    const b = bench();
    const machine = furnace(b, 'furnace', 0, 14);
    const coal = put(b, 'belt', machine.tx, machine.ty - 1, 1) as Belt;
    for (let i = 0; i < 20; i++) {
      feed(coal, 'coal');
      advance(b.world, 0.25);
    }
    expect(countIn(machine.input, 'coal')).toBe(0);
    expect(coal.items.length).toBeGreaterThan(0);
  });
});

describe('fuel by hand', () => {
  it('sends shift-clicked coal to the fuel grid first', () => {
    const b = bench();
    const machine = furnace(b, 'furnaceMk2', 0);
    addItem(b.player, 'coal', 20);
    const slot = b.player.inventory.findIndex((s) => s?.id === 'coal');

    expect(quickMove(b.world, b.player, machine.id, { area: 'bag', index: slot })).toBe(true);
    expect(countIn(machine.fuel!, 'coal')).toBe(20);
  });

  it('will not take anything but fuel into the fuel slot', () => {
    const b = bench();
    const machine = furnace(b, 'furnaceMk2', 0);
    b.player.cursor = { id: 'ironOre', count: 5 };

    expect(clickSlot(b.world, b.player, machine.id, { area: 'fuel', index: 0 })).toBe(false);
    b.player.cursor = { id: 'coal', count: 5 };
    expect(clickSlot(b.world, b.player, machine.id, { area: 'fuel', index: 0 })).toBe(true);
    expect(machine.fuel![0]).toEqual({ id: 'coal', count: 5 });
  });

  it('hands the fuel back when the machine is picked up', () => {
    const b = bench();
    const machine = furnace(b, 'furnaceMk2', 7);
    const before = countItem(b.player, 'coal');

    expect(removeAt(b.world, b.player, machine.tx, machine.ty)).toBe(true);
    expect(countItem(b.player, 'coal')).toBe(before + 7);
  });
});

describe('upgrading into a burner', () => {
  it('gives a stone furnace upgraded in place a fuel slot, and keeps its fuel on Mk2 to Mk3', () => {
    const b = bench();
    const spot = at(18, 2);
    const machine = put(b, 'furnace', spot.tx, spot.ty, 0) as Machine;
    expect(machine.fuel).toBeUndefined();

    put(b, 'furnaceMk2', spot.tx, spot.ty, 0);
    expect(machine.type).toBe('furnaceMk2');
    expect(machine.fuel).toEqual([null]);
    expect(machine.heat).toBe(0);

    fill(machine.fuel!, 'coal', 9);
    put(b, 'furnaceMk3', spot.tx, spot.ty, 0);
    expect(machine.fuel).toEqual([{ id: 'coal', count: 9 }]);
  });
});
