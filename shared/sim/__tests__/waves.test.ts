import { describe, expect, it } from 'vitest';
import { MOBS } from '../../data/mobs';
import { damageMob } from '../systems/combat';
import { nightBudget, spawnMob, toughness } from '../systems/mobs';
import { addPlayer, createWorld } from '../world';

describe('the night curve', () => {
  it('grows each night by more than the night before', () => {
    const world = createWorld(5);
    const budgets: number[] = [];
    for (let n = 1; n <= 30; n++) {
      world.nightIndex = n;
      budgets.push(nightBudget(world));
    }
    for (let i = 2; i < budgets.length; i++) {
      expect(budgets[i] - budgets[i - 1]).toBeGreaterThanOrEqual(budgets[i - 1] - budgets[i - 2]);
    }
    expect(budgets[19]).toBeGreaterThan(budgets[9] * 2);
  });

  it('leaves early creatures at their table health and toughens late ones', () => {
    const world = createWorld(5);
    world.nightIndex = 6;
    expect(spawnMob(world, 'brute', { x: 0, y: 0 }).maxHp).toBe(MOBS.brute.hp);
    world.nightIndex = 16;
    const late = spawnMob(world, 'brute', { x: 0, y: 0 });
    expect(late.maxHp).toBeGreaterThan(MOBS.brute.hp * 1.5);
    expect(late.hp).toBe(late.maxHp);
  });

  it('pays out for a toughened creature in proportion', () => {
    const world = createWorld(5);
    world.mobs.length = 0;
    const player = addPlayer(world, 'test');
    world.nightIndex = 16;
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 100, y: player.pos.y });
    const xp = player.xp;
    const level = player.level;
    damageMob(world, brute, 1e6, player.id);
    expect(player.level > level || player.xp - xp > MOBS.brute.xp).toBe(true);
  });

  it('brings the Warden back tougher each visit, and as tuned the first time', () => {
    const world = createWorld(5);
    world.nightIndex = 5;
    expect(toughness(world, 'warden')).toBe(1);
    world.nightIndex = 10;
    const second = toughness(world, 'warden');
    world.nightIndex = 15;
    expect(second).toBeGreaterThan(1);
    expect(toughness(world, 'warden')).toBeGreaterThan(second);
  });
});
