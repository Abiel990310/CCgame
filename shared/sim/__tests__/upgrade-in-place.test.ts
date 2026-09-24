import { describe, expect, it } from 'vitest';
import { MACHINES, MACHINE_ORDER } from '../../data/machines';
import {
  factoryPlacementError,
  machineAt,
  placeMachine,
  upgradeTarget,
} from '../factory';
import { tileKey } from '../grid';
import { countIn } from '../slots';
import type { Machine } from '../types';
import { advance, at, bench, lay, plantOre, put, stoke } from './bench';

describe('upgrading a machine in place', () => {
  it('swaps a furnace for a Mk2 keeping its recipe, facing, stock and id', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    const furnace = put(b, ['furnace', 'steelPlate'], tx, ty, 1) as Machine;
    furnace.input[0] = { id: 'ironPlate', count: 7 };
    furnace.input[1] = { id: 'coal', count: 3 };
    furnace.output[0] = { id: 'steelPlate', count: 4 };
    furnace.progress = 0.5;

    const packedBefore = countIn(b.player.inventory, 'furnaceMk2');
    const stoneBefore = countIn(b.player.inventory, 'stone');

    // Facing 3 on the placement is ignored: an upgrade keeps the old facing.
    const upgraded = placeMachine(b.world, b.player, 'furnaceMk2', tx, ty, 3);

    expect(upgraded).toBe(furnace);
    expect(machineAt(b.world, tx, ty)).toBe(furnace);
    expect(furnace.type).toBe('furnaceMk2');
    expect(furnace.dir).toBe(1);
    expect(furnace.recipe).toBe('steelPlate');
    expect(furnace.progress).toBe(0.5);
    expect(furnace.input).toHaveLength(MACHINES.furnaceMk2.inputSlots);
    expect(furnace.output).toHaveLength(MACHINES.furnaceMk2.outputSlots);
    expect(furnace.input[0]).toEqual({ id: 'ironPlate', count: 7 });
    expect(furnace.input[1]).toEqual({ id: 'coal', count: 3 });
    expect(furnace.output[0]).toEqual({ id: 'steelPlate', count: 4 });
    expect(
      b.world.machines.filter((m) => m.tx === tx && m.ty === ty),
    ).toHaveLength(1);

    // Spent a crafted Mk2, refunded the furnace, exactly as removing it would.
    expect(countIn(b.player.inventory, 'furnaceMk2')).toBe(packedBefore - 1);
    expect(countIn(b.player.inventory, 'stone')).toBe(stoneBefore + MACHINES.furnace.cost[0].count);
  });

  it('goes straight from Mk1 to Mk3 and from Mk2 to Mk3', () => {
    const b = bench();
    const one = at(2, 2);
    const two = at(4, 2);
    put(b, 'assembler', one.tx, one.ty, 0);
    put(b, 'assemblerMk2', two.tx, two.ty, 0);

    expect(
      placeMachine(b.world, b.player, 'assemblerMk3', one.tx, one.ty, 0)?.type,
    ).toBe('assemblerMk3');
    expect(
      placeMachine(b.world, b.player, 'assemblerMk3', two.tx, two.ty, 0)?.type,
    ).toBe('assemblerMk3');
  });

  it('refuses a lower or equal tier, another family, and an unaffordable upgrade', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    put(b, 'furnaceMk2', tx, ty, 0);

    expect(factoryPlacementError(b.world, b.player, 'furnace', tx, ty)).toBe(
      'occupied',
    );
    expect(factoryPlacementError(b.world, b.player, 'furnaceMk2', tx, ty)).toBe(
      'occupied',
    );
    expect(
      factoryPlacementError(b.world, b.player, 'assemblerMk3', tx, ty),
    ).toBe('occupied');
    // Two arms share a family and a tier; a long arm is a different piece, not an upgrade.
    const arm = at(6, 2);
    put(b, 'inserter', arm.tx, arm.ty, 0);
    expect(upgradeTarget(b.world, 'longInserter', arm.tx, arm.ty)).toBe(null);

    b.player.inventory.fill(null);
    expect(factoryPlacementError(b.world, b.player, 'furnaceMk3', tx, ty)).toBe(
      'cost',
    );
    expect(placeMachine(b.world, b.player, 'furnaceMk3', tx, ty, 0)).toBe(null);
    expect(machineAt(b.world, tx, ty)?.type).toBe('furnaceMk2');
  });

  it('upgrades a miner whose own tile has run dry', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    plantOre(b.world, 'ironOre', tx, ty);
    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    b.world.oreLeft[tileKey(tx, ty)] = 0;
    b.world.ore[tileKey(tx, ty)] = 0;

    expect(factoryPlacementError(b.world, b.player, 'minerMk2', tx, ty)).toBe(
      null,
    );
    expect(placeMachine(b.world, b.player, 'minerMk2', tx, ty, 0)).toBe(miner);
    expect(miner.ore).toBe('ironOre');
  });

  it('keeps a line running after the swap, now at the faster rate', () => {
    const b = bench();
    const { tx, ty } = at(0, 2);
    plantOre(b.world, 'ironOre', tx, ty);
    const [miner] = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      'chest',
    ]);
    advance(b.world, 20);

    const furnace = machineAt(b.world, tx + 3, ty)!;
    expect(placeMachine(b.world, b.player, 'minerMk2', tx, ty, 0)).toBe(miner);
    expect(placeMachine(b.world, b.player, 'furnaceMk2', tx + 3, ty, 0)).toBe(
      furnace,
    );
    // A steel furnace is a burner, so the faster line needs its coal.
    stoke(furnace);

    const chest = machineAt(b.world, tx + 5, ty)!;
    const before = countIn(chest.input, 'ironPlate');
    advance(b.world, 30);
    expect(countIn(chest.input, 'ironPlate')).toBeGreaterThan(before);
  });

  it('never shrinks a grid, so no stack is ever displaced by an upgrade', () => {
    for (const from of MACHINE_ORDER) {
      for (const to of MACHINE_ORDER) {
        const a = MACHINES[from];
        const b = MACHINES[to];
        if (a.family !== b.family || b.tier <= a.tier) continue;
        expect(b.inputSlots, `${from} -> ${to}`).toBeGreaterThanOrEqual(
          a.inputSlots,
        );
        expect(b.outputSlots, `${from} -> ${to}`).toBeGreaterThanOrEqual(
          a.outputSlots,
        );
        expect(b.slotSize, `${from} -> ${to}`).toBeGreaterThanOrEqual(
          a.slotSize,
        );
      }
    }
  });
});
