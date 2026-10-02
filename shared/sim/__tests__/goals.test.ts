import { describe, expect, it } from 'vitest';
import { CRAFT_BY_ID } from '../../data/crafting';
import { GOALS } from '../../data/goals';
import { applyOrder } from '../commands';
import { catchUpGoals, restoreGoal } from '../goals';
import { FAR_SHORE } from '../regions';
import { TILE } from '../constants';
import { beltAt, placeBelt, turnAt } from '../factory';
import { addItem, removeItem } from '../inventory';
import type { World } from '../types';
import { addPlayer, createWorld } from '../world';
import { advance, at, bench, plantOre, put } from './bench';

function goalEvents(world: World): string[] {
  return world.events.flatMap((e) => (e.kind === 'goal' ? [e.goal] : []));
}

describe('goals', () => {
  it('starts a new player on the first goal', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'new');
    expect(player.goal).toBe(0);
    expect(GOALS[0].id).toBe('wood');
  });

  it('ticks a goal off once the island reaches it, and pays XP for it', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'new');
    addItem(player, 'wood', GOALS[0].need);
    const xpBefore = player.xp + player.level * 1000;

    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      advance(world, 1 / 30);
      seen.push(...goalEvents(world));
    }
    expect(seen).toEqual(['wood']);
    expect(player.goal).toBe(1);
    expect(player.xp + player.level * 1000).toBeGreaterThan(xpBefore);
  });

  it('only ever moves forward, even when the items are spent again', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'new');
    addItem(player, 'wood', GOALS[0].need);
    advance(world, 1.1);
    expect(player.goal).toBe(1);
    removeItem(player, 'wood', GOALS[0].need);
    advance(world, 1.1);
    expect(player.goal).toBe(1);
  });

  it('meets one goal at a time rather than skipping the ones in between', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'new');
    addItem(player, 'wood', 100);
    addItem(player, 'stone', 100);
    advance(world, 1.1);
    expect(player.goal).toBe(1);
    advance(world, 1.1);
    expect(player.goal).toBe(2);
  });

  it('counts plates wherever they are: machines and belts as well as the bag', () => {
    const b = bench();
    b.player.goal = GOALS.findIndex((g) => g.id === 'ironPlate');
    const goal = GOALS[b.player.goal];
    const miner = at(0, 0);
    plantOre(b.world, 'ironOre', miner.tx, miner.ty);
    put(b, 'miner', miner.tx, miner.ty, 0);
    put(b, 'belt', miner.tx + 1, miner.ty, 0);
    put(b, 'furnace', miner.tx + 2, miner.ty, 0);
    for (let i = 0; i < 12 && goal.have(b.world, b.player) < goal.need; i++) advance(b.world, 10);
    expect(goal.have(b.world, b.player)).toBeGreaterThanOrEqual(goal.need);
  });

  it('catches an older island up silently to the first goal it has not met', () => {
    const b = bench();
    // The bench stocks a bag full of materials, which meets wood and stone.
    b.player.goal = -1;
    const miner = at(0, 0);
    plantOre(b.world, 'ironOre', miner.tx, miner.ty);
    put(b, 'miner', miner.tx, miner.ty, 0);
    catchUpGoals(b.world, b.player);
    expect(GOALS[b.player.goal].id).toBe('belt');
    expect(goalEvents(b.world)).toEqual([]);
  });
});

describe('the Far Shore goals', () => {
  const ids = (world: World, from: string): string[] => {
    const player = addPlayer(world, 'p');
    player.goal = GOALS.findIndex((g) => g.id === from);
    return [...GOALS.slice(player.goal)].filter((g) => !g.skip?.(world)).map((g) => g.id);
  };

  it('sit between powering a machine and the engineering packs', () => {
    const order = GOALS.map((g) => g.id);
    const far = order.indexOf('farShore');
    expect(order.slice(far - 1, far + 4)).toEqual(['powered', 'farShore', 'titaniumPlate', 'frontierPack', 'engineeringPack']);
  });

  it('are passed over on an island made before the second island existed', () => {
    const old = createWorld(7, true, 3);
    const rest = ids(old, 'powered');
    expect(rest).toContain('engineeringPack');
    expect(rest).not.toContain('farShore');
    expect(rest).not.toContain('titaniumPlate');
    expect(rest).not.toContain('frontierPack');
  });

  it('are met in order: standing on the far island, then plates, then packs', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'p');
    player.goal = GOALS.findIndex((g) => g.id === 'farShore');
    advance(world, 1.1);
    expect(player.goal).toBe(GOALS.findIndex((g) => g.id === 'farShore'));

    player.pos = { x: FAR_SHORE.cx * TILE, y: FAR_SHORE.cy * TILE };
    advance(world, 1.1);
    expect(GOALS[player.goal].id).toBe('titaniumPlate');

    addItem(player, 'titaniumPlate', 10);
    advance(world, 1.1);
    expect(GOALS[player.goal].id).toBe('frontierPack');

    addItem(player, 'frontierPack', 5);
    advance(world, 1.1);
    expect(GOALS[player.goal].id).toBe('engineeringPack');
  });
});

describe('the first satchel', () => {
  const satchel = GOALS.findIndex((g) => g.id === 'satchel');

  it('comes once the bag has ore and plates in it, before the first gears', () => {
    expect(satchel).toBeGreaterThan(GOALS.findIndex((g) => g.id === 'copperPlate'));
    expect(satchel).toBeLessThan(GOALS.findIndex((g) => g.id === 'gear'));
  });

  it('is met by sewing one on at the workbench', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'new');
    player.goal = satchel;
    world.buildings.push({ id: world.nextId++, type: 'workbench', pos: { x: player.pos.x + 40, y: player.pos.y }, level: 1 });
    advance(world, 1.1);
    expect(player.goal).toBe(satchel);

    for (const c of CRAFT_BY_ID.get('satchel')!.cost) addItem(player, c.id, c.count);
    expect(applyOrder(world, { p: player.id, c: { k: 'craft', id: 'satchel' } })).toBe(true);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      advance(world, 1 / 30);
      seen.push(...goalEvents(world));
    }
    expect(seen).toEqual(['satchel']);
    expect(GOALS[player.goal].id).toBe('gear');
  });

  it('does not move an island saved before the row off the goal it was on', () => {
    const world = createWorld(7, true);
    const player = addPlayer(world, 'old');
    // Old saves kept a place in the chain; 8 was Make gears.
    restoreGoal(world, player, 8);
    expect(GOALS[player.goal].id).toBe('gear');
  });
});

describe('turning a placed piece', () => {
  it('turns a belt in place, keeping what rides on it', () => {
    const b = bench();
    const { tx, ty } = at(3, 0);
    placeBelt(b.world, b.player, tx, ty, 0);
    const belt = beltAt(b.world, tx, ty)!;
    belt.items.push({ item: 'ironOre', offset: 0.5 });
    expect(turnAt(b.world, tx, ty, 1)).toBe(true);
    expect(belt.dir).toBe(1);
    expect(belt.items).toHaveLength(1);
    expect(turnAt(b.world, tx, ty, 1)).toBe(false);
    expect(turnAt(b.world, tx + 5, ty, 1)).toBe(false);
  });
});
