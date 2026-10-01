import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { buildingAt, damagedWallAt, placeBuilding, removeBuildingAt, repairCost } from '../building';
import { applyOrder } from '../commands';
import { CAMP } from '../constants';
import { copySettings, pasteSettings, setSideFilter } from '../factory';
import { countItem } from '../inventory';
import type { Machine } from '../types';
import { at, bench, put } from './bench';

/**
 * Three small conveniences that each save a trip through a screen: a chipped
 * wall mended where it stands, a splitter that goes down already sorting, and
 * one copied setting laid over a whole row.
 */

function wallAt(b: ReturnType<typeof bench>, level: number) {
  const pos = { x: b.world.camp.x + 70, y: b.world.camp.y };
  expect(placeBuilding(b.world, b.player, 'wall', pos)).toBe(true);
  const wall = buildingAt(b.world, pos)!;
  wall.level = level;
  return { pos, wall };
}

function bag(b: ReturnType<typeof bench>): Record<string, number> {
  return Object.fromEntries(BUILDINGS.wall.cost.map((c) => [c.id, countItem(b.player, c.id)]));
}

describe('repairing a chipped wall', () => {
  it('charges the missing share of the cost, rounded up', () => {
    const price = (level: number): Record<string, number> =>
      Object.fromEntries(repairCost({ id: 1, type: 'wall', level, pos: { x: 0, y: 0 } }).map((c) => [c.id, c.count]));

    // A wall costs 4 wood and 2 stone over 4 hit points.
    expect(price(CAMP.wallHp)).toEqual({});
    expect(price(3)).toEqual({ wood: 1, stone: 1 });
    expect(price(2)).toEqual({ wood: 2, stone: 1 });
    expect(price(1)).toEqual({ wood: 3, stone: 2 });
  });

  it('mends the wall to full and spends exactly that', () => {
    const b = bench();
    const { pos, wall } = wallAt(b, 2);
    const before = bag(b);

    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'repair', x: pos.x, y: pos.y } })).toBe(true);

    expect(wall.level).toBe(CAMP.wallHp);
    expect(countItem(b.player, 'wood')).toBe(before.wood - 2);
    expect(countItem(b.player, 'stone')).toBe(before.stone - 1);
    expect(b.world.buildings.filter((x) => x.type === 'wall')).toHaveLength(1);
  });

  it('costs what pulling the wall down and building it again would', () => {
    const viaRepair = bench();
    const viaRebuild = bench();
    for (const level of [1, 2, 3]) {
      const a = wallAt(viaRepair, level);
      const r = wallAt(viaRebuild, level);
      applyOrder(viaRepair.world, { p: viaRepair.player.id, c: { k: 'repair', x: a.pos.x, y: a.pos.y } });
      removeBuildingAt(viaRebuild.world, viaRebuild.player, r.pos);
      placeBuilding(viaRebuild.world, viaRebuild.player, 'wall', r.pos);
      expect(bag(viaRepair)).toEqual(bag(viaRebuild));
      // Clear the spot for the next level's wall.
      removeBuildingAt(viaRepair.world, viaRepair.player, a.pos);
      removeBuildingAt(viaRebuild.world, viaRebuild.player, r.pos);
    }
  });

  it('takes nothing for a wall that is not chipped', () => {
    const b = bench();
    const { pos } = wallAt(b, CAMP.wallHp);
    const before = bag(b);
    expect(damagedWallAt(b.world, pos)).toBe(null);
    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'repair', x: pos.x, y: pos.y } })).toBe(false);
    expect(bag(b)).toEqual(before);
  });

  it('spends nothing when the bag cannot cover it', () => {
    const b = bench();
    const { pos, wall } = wallAt(b, 1);
    for (const slot of b.player.inventory.keys()) {
      const held = b.player.inventory[slot];
      if (held && (held.id === 'stone' || held.id === 'wood')) b.player.inventory[slot] = null;
    }
    const before = bag(b);

    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'repair', x: pos.x, y: pos.y } })).toBe(false);
    expect(wall.level).toBe(1);
    expect(bag(b)).toEqual(before);
  });

  it('ignores a spot with no wall, and every other camp piece', () => {
    const b = bench();
    const far = { x: b.world.camp.x + 200, y: b.world.camp.y + 200 };
    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'repair', x: far.x, y: far.y } })).toBe(false);
    const fire = b.world.buildings.find((x) => x.type === 'campfire')!;
    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'repair', x: fire.pos.x, y: fire.pos.y } })).toBe(false);
    expect(applyOrder(b.world, { p: b.player.id, c: { k: 'repair', x: Number.NaN, y: 3 } })).toBe(false);
  });
});

describe('a splitter placed with its sides set', () => {
  it('goes down already filtered', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    const ok = applyOrder(b.world, {
      p: b.player.id,
      c: { k: 'machine', what: 'splitter', tx, ty, dir: 0, sides: ['ironPlate', null] },
    });
    expect(ok).toBe(true);
    const splitter = b.world.machines.find((m) => m.type === 'splitter')!;
    expect(splitter.filters).toEqual(['ironPlate', null]);
  });

  it('is unfiltered when no sides come with it, as every older order was', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    applyOrder(b.world, { p: b.player.id, c: { k: 'machine', what: 'splitter', tx, ty, dir: 0 } });
    expect(b.world.machines.find((m) => m.type === 'splitter')!.filters).toEqual([null, null]);
  });

  it('ignores sides sent with a piece that has none', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    applyOrder(b.world, {
      p: b.player.id,
      c: { k: 'machine', what: 'chest', tx, ty, dir: 0, sides: ['coal', 'gear'] },
    });
    const box = b.world.machines.find((m) => m.type === 'chest')!;
    expect(box.filters?.every((f) => f === null)).toBe(true);
  });

  it('refuses sides that are not two items', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    const junk = [['mithril', null], ['coal', 'gear', 'wire'], 'coal', [3, null]];
    for (const sides of junk) {
      const c = { k: 'machine', what: 'splitter', tx, ty, dir: 0, sides } as never;
      expect(applyOrder(b.world, { p: b.player.id, c })).toBe(false);
    }
    expect(b.world.machines).toHaveLength(0);
  });

  it('does not overwrite the sides of a splitter it is placed over', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    const first = put(b, 'splitter', tx, ty, 0) as Machine;
    setSideFilter(b.world, first.id, 0, 'coal');
    applyOrder(b.world, {
      p: b.player.id,
      c: { k: 'machine', what: 'splitter', tx, ty, dir: 0, sides: ['gear', 'gear'] },
    });
    expect(b.world.machines).toHaveLength(1);
    expect(first.filters).toEqual(['coal', null]);
  });
});

describe('pasting along a row', () => {
  it('sets every machine of the family and passes over the rest', () => {
    const b = bench();
    const row = [1, 2, 3, 4, 5].map((dx) => {
      const { tx, ty } = at(dx, 2);
      return put(b, dx === 3 ? 'furnace' : 'inserter', tx, ty, 0) as Machine;
    });
    const source = put(b, 'inserter', ...(Object.values(at(1, 4)) as [number, number]), 0) as Machine;
    source.filter = 'coal';
    const copied = copySettings(source);

    // The client walks a stroke tile by tile and sends one paste per machine.
    const results = row.map((m) => applyOrder(b.world, { p: b.player.id, c: { k: 'paste', machine: m.id, settings: copied } }));
    expect(results).toEqual([true, true, false, true, true]);
    expect(row.filter((m) => m.filter === 'coal')).toHaveLength(4);
    expect(row[2].filter).toBe(null);
    expect(pasteSettings(b.world, row[0].id, copied)).toBe(false);
  });
});
