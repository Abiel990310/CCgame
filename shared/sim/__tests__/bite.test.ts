import { describe, expect, it } from 'vitest';
import { BITE, MELEE } from '../constants';
import { stepStrike } from '../systems/combat';
import { spawnMob, stepMobs } from '../systems/mobs';
import { EMPTY_INPUT } from '../step';
import type { Player, World } from '../types';
import { addPlayer, createWorld } from '../world';

function arena(): { world: World; player: Player } {
  const world = createWorld(29);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  player.hp = player.maxHp = 1000;
  player.facing = { x: 1, y: 0 };
  return { world, player };
}

function run(world: World, seconds: number, dt = 1 / 30): void {
  for (let t = 0; t < seconds; t += dt) stepMobs(world, dt);
}

describe('a creature winds up before it bites', () => {
  it('rears back first, and the bite lands when the wind-up runs out', () => {
    const { world, player } = arena();
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 10, y: player.pos.y });
    run(world, 1 / 30);
    expect(brute.windup).toBeGreaterThan(0);
    expect(player.hp).toBe(player.maxHp);
    run(world, BITE.windup + 2 / 30);
    expect(player.hp).toBeLessThan(player.maxHp);
  });

  it('bites at nothing when the player steps away in time', () => {
    const { world, player } = arena();
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 10, y: player.pos.y });
    run(world, 1 / 30);
    expect(brute.windup).toBeGreaterThan(0);
    player.pos.x -= 120;
    run(world, BITE.windup + 2 / 30);
    expect(player.hp).toBe(player.maxHp);
    expect(brute.attackCd).toBeGreaterThan(0);
  });

  it('is parried by a swing started as the bite lands', () => {
    const { world, player } = arena();
    const warden = spawnMob(world, 'warden', { x: player.pos.x + 12, y: player.pos.y });
    // Rear back until the last tick before the bite, then swing.
    for (let i = 0; i < 40 && !(warden.windup && warden.windup <= 1 / 30 + 1e-9); i++) run(world, 1 / 30);
    expect(warden.windup).toBeGreaterThan(0);
    stepStrike(world, player, { ...EMPTY_INPUT, attack: true }, 0);
    world.events.length = 0;
    run(world, 2 / 30);
    expect(world.events.some((e) => e.kind === 'parry')).toBe(true);
    expect(player.hp).toBe(player.maxHp);
    expect(warden.attackCd).toBeGreaterThan(MELEE.daze - 0.2);
  });

  it('passes through a player mid-dash, and the next swing is a counter', () => {
    const { world, player } = arena();
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 10, y: player.pos.y });
    brute.hp = brute.maxHp = 1e6;
    for (let i = 0; i < 40 && !(brute.windup && brute.windup <= 1 / 30 + 1e-9); i++) run(world, 1 / 30);
    // Mid-roll as the bite lands.
    player.dashTime = 0.1;
    world.events.length = 0;
    run(world, 2 / 30);
    expect(world.events.some((e) => e.kind === 'dodge')).toBe(true);
    expect(player.hp).toBe(player.maxHp);
    expect(player.riposte).toBeGreaterThan(0);

    player.dashTime = 0;
    const before = brute.hp;
    stepStrike(world, player, { ...EMPTY_INPUT, attack: true }, 0);
    expect(player.combo).toBe(MELEE.damage.length - 1);
    expect(before - brute.hp).toBeGreaterThanOrEqual(MELEE.damage[MELEE.damage.length - 1] * 0.99);
    expect(player.riposte).toBe(0);
    expect(world.events.some((e) => e.kind === 'strike' && e.counter === true)).toBe(true);
  });

  it('does not count a bite taken standing still as a dodge', () => {
    const { world, player } = arena();
    spawnMob(world, 'brute', { x: player.pos.x + 10, y: player.pos.y });
    world.events.length = 0;
    run(world, BITE.windup + 3 / 30);
    expect(world.events.some((e) => e.kind === 'dodge')).toBe(false);
    expect(player.riposte ?? 0).toBe(0);
  });
});
