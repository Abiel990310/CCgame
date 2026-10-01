import { describe, expect, it } from 'vitest';
import { MOBS } from '../../data/mobs';
import { spawnMob, stepMobs } from '../systems/mobs';
import type { Mob, Player, World } from '../types';
import { addPlayer, createWorld } from '../world';

const DT = 1 / 30;
const PULSE = MOBS.bulwark.pulse!;

function arena(): { world: World; player: Player } {
  const world = createWorld(41);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  return { world, player };
}

/** A Bulwark past its turn, close enough that the ward can reach the player. */
function angryBulwark(world: World, player: Player): Mob {
  const bulwark = spawnMob(world, 'bulwark', { x: player.pos.x + 120, y: player.pos.y });
  bulwark.enraged = true;
  bulwark.pulseCd = 0;
  return bulwark;
}

function hold(player: Player, at: { x: number; y: number }): void {
  player.pos = { ...at };
  player.invuln = 0;
}

describe("an enraged bulwark's ward pulse", () => {
  it('charges, then bursts outward and shoves whoever is inside it back', () => {
    const { world, player } = arena();
    const bulwark = angryBulwark(world, player);
    const spot = { ...player.pos };
    world.events.length = 0;
    stepMobs(world, DT);
    expect(world.events.some((e) => e.kind === 'pulseWind')).toBe(true);
    expect(bulwark.pulse).toBeGreaterThan(0);

    const hp = player.hp;
    for (let t = 0; t < PULSE.windup + 0.2 && !world.events.some((e) => e.kind === 'pulse'); t += DT) {
      hold(player, spot);
      stepMobs(world, DT);
    }
    const burst = world.events.find((e) => e.kind === 'pulse');
    expect(burst && burst.kind === 'pulse' && burst.hits).toBe(1);
    expect(player.hp).toBe(hp - PULSE.damage);
    // The Bulwark stands to the east, so the shove is west.
    expect(player.vel.x).toBeLessThan(-PULSE.knock * 0.9);
  });

  it('keeps walking while it charges, only slower', () => {
    const { world, player } = arena();
    const bulwark = angryBulwark(world, player);
    stepMobs(world, DT);
    expect(bulwark.pulse).toBeGreaterThan(0);
    const before = { ...bulwark.pos };
    for (let i = 0; i < 10; i++) {
      hold(player, { x: before.x - 120, y: before.y });
      stepMobs(world, DT);
    }
    expect(Math.hypot(bulwark.pos.x - before.x, bulwark.pos.y - before.y)).toBeGreaterThan(0);
  });

  it('misses a player who has backed out of reach before it bursts', () => {
    const { world, player } = arena();
    const bulwark = angryBulwark(world, player);
    stepMobs(world, DT);
    expect(bulwark.pulse).toBeGreaterThan(0);
    const hp = player.hp;
    const away = { x: bulwark.pos.x - PULSE.radius - 120, y: bulwark.pos.y };
    for (let t = 0; t < PULSE.windup + 0.2; t += DT) {
      hold(player, away);
      stepMobs(world, DT);
    }
    expect(player.hp).toBe(hp);
  });

  it('is a second-phase move: a calm bulwark never pulses', () => {
    const { world, player } = arena();
    const bulwark = angryBulwark(world, player);
    bulwark.enraged = false;
    for (let t = 0; t < 4; t += DT) stepMobs(world, DT);
    expect(world.events.some((e) => e.kind === 'pulseWind')).toBe(false);
    expect(bulwark.pulse ?? 0).toBe(0);
  });
});
