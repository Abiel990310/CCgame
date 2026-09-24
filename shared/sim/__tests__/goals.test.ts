import { describe, expect, it } from 'vitest';
import { GOALS } from '../../data/goals';
import { catchUpGoals } from '../goals';
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
