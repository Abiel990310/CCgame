import { describe, expect, it } from 'vitest';
import { MOBS } from '../../data/mobs';
import { BOSS_RAGE } from '../constants';
import { damageMob } from '../systems/combat';
import { spawnMob, stepMobs } from '../systems/mobs';
import type { World } from '../types';
import { addPlayer, createWorld } from '../world';

function arena(): World {
  const world = createWorld(37);
  world.mobs.length = 0;
  addPlayer(world, 'test');
  return world;
}

describe('a boss turns at half health', () => {
  it('is enraged once, with one event, and moves faster for it', () => {
    const world = arena();
    const player = [...world.players.values()][0];
    const calm = spawnMob(world, 'warden', { x: player.pos.x + 600, y: player.pos.y });
    const angry = spawnMob(world, 'warden', { x: player.pos.x - 600, y: player.pos.y });
    damageMob(world, angry, angry.maxHp * (1 - BOSS_RAGE.at) - 40, player.id);
    expect(angry.enraged).toBeFalsy();
    world.events.length = 0;
    damageMob(world, angry, 80, player.id);
    expect(angry.enraged).toBe(true);
    expect(world.events.filter((e) => e.kind === 'bossRage')).toHaveLength(1);
    world.events.length = 0;
    damageMob(world, angry, 2, player.id);
    expect(world.events.some((e) => e.kind === 'bossRage')).toBe(false);

    for (let i = 0; i < 30; i++) stepMobs(world, 1 / 30);
    const pace = (m: typeof calm) => Math.hypot(m.vel.x, m.vel.y);
    expect(pace(angry)).toBeGreaterThan(pace(calm) * 1.2);
    expect(pace(calm)).toBeGreaterThan(MOBS.warden.speed * 0.8);
  });

  it('never happens to an ordinary creature', () => {
    const world = arena();
    const player = [...world.players.values()][0];
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 300, y: player.pos.y });
    damageMob(world, brute, brute.maxHp * 0.6, player.id);
    expect(brute.enraged).toBeFalsy();
    expect(world.events.some((e) => e.kind === 'bossRage')).toBe(false);
  });
});
