import { describe, expect, it } from 'vitest';
import { CRAFT_BY_ID } from '../../data/crafting';
import { ITEMS } from '../../data/items';
import { craft, toolSpeed } from '../crafting';
import { factoryPlacementError, placeMachine, setRecipe } from '../factory';
import { addItem, countItem } from '../inventory';
import { addPlayer, createWorld } from '../world';
import { advance, at, bench, held, lay, plantOre, put } from './bench';
import type { Machine } from '../types';

/**
 * Titanium is the far side's ore: a plain drill cannot break it, and a plain
 * furnace cannot melt it, so reaching it takes the steel tier of both.
 */
describe('titanium', () => {
  it('refuses a plain miner and takes a steel one', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'titaniumOre', tx, ty);
    expect(factoryPlacementError(b.world, b.player, 'miner', tx, ty)).toBe('grade');
    expect(placeMachine(b.world, b.player, 'miner', tx, ty, 0)).toBe(null);
    expect(factoryPlacementError(b.world, b.player, 'minerMk2', tx, ty)).toBe(null);

    // Every other ore is still a plain miner's.
    const iron = at(6, 1);
    plantOre(b.world, 'ironOre', iron.tx, iron.ty);
    expect(factoryPlacementError(b.world, b.player, 'miner', iron.tx, iron.ty)).toBe(null);
  });

  it('is smelted only by a steel furnace', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const plain = placeMachine(b.world, b.player, 'furnace', tx, ty, 0)!;
    expect(setRecipe(b.world, plain.id, 'titaniumPlate')).toBe(false);
    expect(plain.recipe).not.toBe('titaniumPlate');

    const steel = placeMachine(b.world, b.player, 'furnaceMk2', tx + 2, ty, 0)!;
    expect(setRecipe(b.world, steel.id, 'titaniumPlate')).toBe(true);
  });

  it('runs from the ground to a chest of plates', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'titaniumOre', tx, ty);
    const row = lay(b, tx, ty, 0, ['minerMk2', 'belt', ['furnaceMk2', 'titaniumPlate'], 'belt', 'chest']);
    const furnace = row[2] as Machine;
    const chest = row[4] as Machine;
    // A steel furnace burns coal, which comes up the island's own coal patch.
    const coal = at(4, 3);
    plantOre(b.world, 'coal', coal.tx, coal.ty);
    put(b, 'miner', coal.tx, coal.ty, 3);
    put(b, 'belt', coal.tx, coal.ty - 1, 3);

    advance(b.world, 90);

    expect(held(chest, 'titaniumPlate')).toBeGreaterThan(0);
    // The ore was all melted on the way, none left to ride through.
    expect(held(chest, 'titaniumOre')).toBe(0);
    expect(furnace.stalled).toBe(false);
  });

  it('makes tools that outwork steel', () => {
    const world = createWorld(31, true);
    const player = addPlayer(world, 'smith');
    world.buildings.push({ id: world.nextId++, type: 'workbench', pos: { x: player.pos.x + 40, y: player.pos.y }, level: 1 });
    for (const id of ['titaniumAxe', 'titaniumPick']) {
      for (const c of CRAFT_BY_ID.get(id)!.cost) addItem(player, c.id, c.count);
      expect(craft(world, player, id)).toBe(true);
      expect(countItem(player, id as 'titaniumAxe')).toBe(1);
    }
    expect(ITEMS.titaniumAxe.tool!.speed).toBeGreaterThan(ITEMS.steelAxe.tool!.speed);
    expect(ITEMS.titaniumPick.tool!.speed).toBeGreaterThan(ITEMS.steelPick.tool!.speed);
    expect(toolSpeed(player, 'pick')).toBe(ITEMS.titaniumPick.tool!.speed);
  });
});
