import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { applyOrder } from '../commands';
import { removeAt } from '../factory';
import { addItem } from '../inventory';
import { TICK_DT } from '../constants';
import { powerNetOf } from '../power';
import { countIn } from '../slots';
import type { ItemId, Machine } from '../types';
import { advance, at, bench, fill, plantOre, put, type Bench } from './bench';

/** An electric furnace smelting iron, with a full load of ore. */
function furnace(b: Bench, dx: number, modules: (ItemId | null)[] = []): Machine {
  const spot = at(dx, 3);
  const machine = put(b, ['furnaceMk3', 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
  const def = MACHINES.furnaceMk3;
  fill(machine.input, 'ironOre', def.inputSlots * def.slotSize, def.slotSize);
  modules.forEach((id, i) => (machine.modules![i] = id ? { id, count: 1 } : null));
  return machine;
}

const plates = (m: Machine): number => countIn(m.output, 'ironPlate');

describe('modules', () => {
  it('gives every tier 3 machine two empty module slots, and nothing else any', () => {
    const b = bench(2026, true);
    expect(furnace(b, 2).modules).toEqual([null, null]);
    const mk2 = put(b, ['furnaceMk2', 'ironPlate'], at(4, 3).tx, at(4, 3).ty, 0) as Machine;
    expect(mk2.modules).toBeUndefined();
  });

  it('makes a speed-fitted machine work faster', () => {
    const plain = bench(2026, true);
    const slow = furnace(plain, 2);
    advance(plain.world, 5);

    const fast = bench(2026, true);
    const quick = furnace(fast, 2, ['speedModule', 'speedModule']);
    advance(fast.world, 5);

    // Two speed modules double the rate, less the tick each craft restarts on.
    expect(plates(quick)).toBeGreaterThan(plates(slow) * 1.8);
  });

  it('pays out exactly one free craft per ten on one output module', () => {
    const b = bench(2026, true);
    const f = furnace(b, 2, ['outputModule', null]);
    // Emptied every tick, so each tick shows what one craft put out.
    const outputs: number[] = [];
    while (outputs.length < 50) {
      advance(b.world, TICK_DT);
      const now = plates(f);
      if (now > 0) outputs.push(now);
      f.output = f.output.map(() => null);
    }
    expect(outputs.filter((n) => n === 2)).toHaveLength(5);
    expect(outputs.filter((n) => n !== 1 && n !== 2)).toHaveLength(0);
  });

  it('draws less power with efficiency modules and more with speed ones', () => {
    const b = bench(2026, true);
    const plain = furnace(b, 2);
    advance(b.world, 1);
    const net = powerNetOf(b.world, plain)!;
    const base = net.demand;

    plain.modules = [{ id: 'efficiencyModule', count: 1 }, { id: 'efficiencyModule', count: 1 }];
    advance(b.world, 1);
    // Two efficiency modules would take it to 20%, which is where the floor holds it.
    expect(powerNetOf(b.world, plain)!.demand).toBeCloseTo(base - MACHINES.furnaceMk3.power! * 0.8);

    plain.modules = [{ id: 'speedModule', count: 1 }, null];
    advance(b.world, 1);
    expect(powerNetOf(b.world, plain)!.demand).toBeCloseTo(base + MACHINES.furnaceMk3.power! * 0.7);
  });

  it('brings extra ore out of a patch on an output-fitted miner', () => {
    const run = (fitted: boolean): number => {
      const b = bench(2026, true);
      const spot = at(2, 3);
      plantOre(b.world, 'ironOre', spot.tx, spot.ty, 40);
      const miner = put(b, 'minerMk3', spot.tx, spot.ty, 0) as Machine;
      if (fitted) miner.modules = [{ id: 'outputModule', count: 1 }, { id: 'outputModule', count: 1 }];
      let total = 0;
      for (let i = 0; i < 400; i++) {
        advance(b.world, 0.5);
        total += countIn(miner.output, 'ironOre');
        miner.output = miner.output.map(() => null);
      }
      return total;
    };
    // The ring around the miner is bare bench, so the one tile is the whole patch.
    const plain = run(false);
    expect(plain).toBe(40);
    expect(run(true)).toBe(48);
  });

  it('fits by hand through a command, one module to a slot, and refunds them on removal', () => {
    const b = bench(2026, true);
    const f = furnace(b, 2);
    addItem(b.player, 'speedModule', 3);
    const bagSlot = b.player.inventory.findIndex((s) => s?.id === 'speedModule');

    // Shift-click sends one to each empty slot and leaves the rest in the bag.
    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'quick', machine: f.id, ref: { area: 'bag', index: bagSlot } } })).toBe(true);
    expect(f.modules).toEqual([{ id: 'speedModule', count: 1 }, { id: 'speedModule', count: 1 }]);
    expect(countIn(b.player.inventory, 'speedModule')).toBe(1);

    // A module is not a recipe ingredient, and nothing else fits a module slot.
    addItem(b.player, 'ironOre', 1);
    const oreSlot = b.player.inventory.findIndex((s) => s?.id === 'ironOre');
    applyOrder(b.world, { p: b.player.id, c: { k: 'click', machine: f.id, ref: { area: 'bag', index: oreSlot }, button: 'left' } });
    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'click', machine: f.id, ref: { area: 'modules', index: 0 }, button: 'left' } })).toBe(false);

    removeAt(b.world, b.player, f.tx, f.ty);
    expect(countIn(b.player.inventory, 'speedModule')).toBe(3);
  });
});
