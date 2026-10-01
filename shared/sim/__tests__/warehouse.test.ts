import { describe, expect, it } from 'vitest';
import { MACHINES, placementCost } from '../../data/machines';
import { factoryPlacementError, machineAt, removeAt, upgradeTarget } from '../factory';
import { footprint, machineCentre, tileKey } from '../grid';
import { restoreSnapshot, takeSnapshot, encode, decode, type Snapshot } from '../snapshot';
import { resolveMachines } from '../systems/movement';
import { TERRAIN_ORDER } from '../terrain';
import type { Machine } from '../types';
import { advance, at, bench, fill, held, put, totalHeld } from './bench';

/**
 * The warehouse is the first machine bigger than a tile. It anchors at its
 * top-left tile and answers on all four, which is what lets an arm on any of
 * its sides load or empty it without the arms learning anything new.
 */

const HOME = at(10, 2);

function store() {
  const b = bench(2026, true);
  const box = put(b, 'warehouse', HOME.tx, HOME.ty, 0) as Machine;
  return { b, box };
}

describe('the warehouse', () => {
  it('holds three times what a steel chest does, in a bigger footprint', () => {
    const steel = MACHINES.steelChest;
    const wh = MACHINES.warehouse;
    expect(wh.size).toBe(2);
    expect(wh.inputSlots).toBeGreaterThan(steel.inputSlots);
    expect(wh.inputSlots * wh.slotSize).toBeGreaterThanOrEqual(3 * steel.inputSlots * steel.slotSize);
  });

  it('is found on every tile it covers, as the same machine', () => {
    const { b, box } = store();
    expect(footprint(box)).toHaveLength(4);
    for (const t of footprint(box)) {
      expect(machineAt(b.world, t.tx, t.ty)).toBe(box);
      expect(b.world.grid.get(tileKey(t.tx, t.ty))).toBe(box);
    }
    expect(machineAt(b.world, HOME.tx + 2, HOME.ty)).toBe(null);
    expect(machineAt(b.world, HOME.tx, HOME.ty + 2)).toBe(null);
    expect(machineCentre(box)).toEqual({ x: (HOME.tx + 1) * 32, y: (HOME.ty + 1) * 32 });
  });

  it('refuses to be built over anything on any of its four tiles', () => {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const probe = bench(2026, true);
      put(probe, 'chest', HOME.tx + dx, HOME.ty + dy, 0);
      expect(factoryPlacementError(probe.world, probe.player, 'warehouse', HOME.tx, HOME.ty), `${dx},${dy}`).toBe('occupied');
    }
    const b = bench(2026, true);
    // Water under one corner is as good as a wall.
    const pond = at(8, 3);
    b.world.terrain[tileKey(pond.tx + 1, pond.ty + 1)] = TERRAIN_ORDER.indexOf('water');
    expect(factoryPlacementError(b.world, b.player, 'warehouse', pond.tx, pond.ty)).toBe('terrain');
  });

  it('is not an in-place upgrade of a smaller chest', () => {
    const b = bench();
    const spot = at(3, 3);
    const steel = put(b, 'steelChest', spot.tx, spot.ty, 0) as Machine;
    expect(upgradeTarget(b.world, 'warehouse', spot.tx, spot.ty)).toBe(null);
    expect(factoryPlacementError(b.world, b.player, 'warehouse', spot.tx, spot.ty)).toBe('occupied');
    expect(factoryPlacementError(b.world, b.player, 'warehouse', spot.tx - 1, spot.ty - 1)).toBe('occupied');
    expect(b.world.machines).toContain(steel);
  });

  it('stops players and creatures like any solid machine', () => {
    const { b } = store();
    // A body standing in the far tile is shoved out of the whole footprint.
    const pos = { x: (HOME.tx + 1.7) * 32, y: (HOME.ty + 1.7) * 32 };
    resolveMachines(b.world, pos, 10);
    const outside = pos.x >= (HOME.tx + 2) * 32 + 9 || pos.y >= (HOME.ty + 2) * 32 + 9;
    expect(outside).toBe(true);
  });

  it('is filled by an arm from any side it touches', () => {
    const { b, box } = store();
    // One feeding chest behind an arm on each side, aimed at a different tile.
    const feeds = [
      // west of the top-left tile, facing east
      { arm: [HOME.tx - 1, HOME.ty, 0], src: [HOME.tx - 2, HOME.ty] },
      // north of the top-right tile, facing south
      { arm: [HOME.tx + 1, HOME.ty - 1, 1], src: [HOME.tx + 1, HOME.ty - 2] },
      // east of the bottom-right tile, facing west
      { arm: [HOME.tx + 2, HOME.ty + 1, 2], src: [HOME.tx + 3, HOME.ty + 1] },
      // south of the bottom-left tile, facing north
      { arm: [HOME.tx, HOME.ty + 2, 3], src: [HOME.tx, HOME.ty + 3] },
    ] as const;
    const items = ['ironPlate', 'copperPlate', 'gear', 'stone'] as const;
    feeds.forEach((f, i) => {
      const src = put(b, 'chest', f.src[0], f.src[1], 0) as Machine;
      fill(src.input, items[i], 20, MACHINES.chest.slotSize);
      put(b, 'inserter', f.arm[0], f.arm[1], f.arm[2] as 0 | 1 | 2 | 3);
    });

    advance(b.world, 30);

    for (const item of items) expect(held(box, item), item).toBe(20);
  });

  it('is emptied by an arm from any side it touches', () => {
    const { b, box } = store();
    fill(box.input, 'ironPlate', 100, MACHINES.warehouse.slotSize);
    const outs: Array<[number, number, 0 | 1 | 2 | 3]> = [
      [HOME.tx + 2, HOME.ty, 0],
      [HOME.tx, HOME.ty - 1, 3],
    ];
    const sinks = outs.map(([x, y, dir]) => {
      put(b, 'inserter', x, y, dir);
      const ahead = [x + (dir === 0 ? 1 : 0), y + (dir === 3 ? -1 : 0)];
      return put(b, 'chest', ahead[0], ahead[1], 0) as Machine;
    });

    advance(b.world, 20);

    for (const sink of sinks) expect(held(sink, 'ironPlate')).toBeGreaterThan(5);
    const moved = sinks.reduce((n, s) => n + held(s, 'ironPlate'), 0);
    expect(held(box, 'ironPlate') + moved + b.world.machines.filter((m) => m.type === 'inserter').reduce((n, m) => n + totalHeld(m), 0)).toBe(100);
  });

  it('comes down whole from any tile, handing back its cost and its contents', () => {
    const { b, box } = store();
    fill(box.input, 'copperPlate', 50, MACHINES.warehouse.slotSize);
    const crates = b.player.inventory.reduce((n, s) => n + (s?.id === 'warehouse' ? s.count : 0), 0);
    const copper = b.player.inventory.reduce((n, s) => n + (s?.id === 'copperPlate' ? s.count : 0), 0);

    expect(removeAt(b.world, b.player, HOME.tx + 1, HOME.ty + 1)).toBe(true);

    for (const t of footprint(box)) expect(b.world.grid.has(tileKey(t.tx, t.ty))).toBe(false);
    expect(b.world.machines).not.toContain(box);
    expect(b.player.inventory.reduce((n, s) => n + (s?.id === 'warehouse' ? s.count : 0), 0)).toBe(crates + 1);
    expect(b.player.inventory.reduce((n, s) => n + (s?.id === 'copperPlate' ? s.count : 0), 0)).toBe(copper + 50);
    // And the ground is free to build on again.
    expect(factoryPlacementError(b.world, b.player, 'warehouse', HOME.tx, HOME.ty)).toBe(null);
  });

  it('is crafted at the workbench from steel and gears', () => {
    expect(MACHINES.warehouse.crafted).toBe(true);
    expect(placementCost('warehouse')).toEqual([{ id: 'warehouse', count: 1 }]);
    expect(MACHINES.warehouse.cost.map((c) => c.id)).toEqual(['steelPlate', 'gear']);
  });

  it('keeps its footprint through a snapshot', () => {
    const { b, box } = store();
    fill(box.input, 'wood', 30, MACHINES.warehouse.slotSize);
    const back = restoreSnapshot(decode<Snapshot>(encode(takeSnapshot(b.world))));
    for (const t of footprint(box)) {
      const found = machineAt(back, t.tx, t.ty);
      expect(found?.type).toBe('warehouse');
      expect(found?.id).toBe(box.id);
    }
    expect(back.grid.size).toBe(b.world.grid.size);
  });

  it('has a slot filter for every slot, as any chest does', () => {
    const { box } = store();
    expect(box.filters).toHaveLength(MACHINES.warehouse.inputSlots);
  });
});
