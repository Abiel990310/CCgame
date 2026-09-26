import { describe, expect, it } from 'vitest';
import { MELEE } from '../constants';
import { stepStrike } from '../systems/combat';
import { EMPTY_INPUT } from '../step';
import type { Mob, Player, PlayerInput, World } from '../types';
import { addPlayer, createWorld } from '../world';

let nextMobId = 7000;

function mobAt(world: World, player: Player, dx: number, dy: number, hp = 500): Mob {
  const mob: Mob = {
    id: nextMobId++,
    type: 'slime',
    pos: { x: player.pos.x + dx, y: player.pos.y + dy },
    vel: { x: 0, y: 0 },
    hp,
    maxHp: hp,
    attackCd: 0,
    seed: 1,
    hitFlash: 0,
  };
  world.mobs.push(mob);
  return mob;
}

function setup(): { world: World; player: Player } {
  const world = createWorld(23);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  player.facing = { x: 1, y: 0 };
  return { world, player };
}

const ATTACK: PlayerInput = { ...EMPTY_INPUT, attack: true };

/** Swing once, then let the cooldown run out but not the combo window. */
function swing(world: World, player: Player, input = ATTACK): void {
  world.events.length = 0;
  stepStrike(world, player, input, 0);
  stepStrike(world, player, EMPTY_INPUT, player.strikeCd ?? 0);
}

describe('melee swing', () => {
  it('hits and shoves a creature in front, and misses one behind', () => {
    const { world, player } = setup();
    const front = mobAt(world, player, 30, 0);
    const behind = mobAt(world, player, -30, 0);
    swing(world, player);
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(front.vel.x).toBeGreaterThan(0);
    expect(behind.hp).toBe(behind.maxHp);
    const strike = world.events.find((e) => e.kind === 'strike');
    expect(strike && strike.kind === 'strike' && strike.hits).toBe(1);
  });

  it('chains three hits and the third lands hardest', () => {
    const { world, player } = setup();
    const mob = mobAt(world, player, 30, 0);
    const dealt: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = mob.hp;
      swing(world, player);
      dealt.push(before - mob.hp);
    }
    expect(player.combo).toBe(2);
    expect(dealt[2]).toBeGreaterThan(dealt[0] * 1.5);
  });

  it('starts the combo over after a pause', () => {
    const { world, player } = setup();
    mobAt(world, player, 30, 0);
    swing(world, player);
    stepStrike(world, player, EMPTY_INPUT, MELEE.window + 0.1);
    swing(world, player);
    expect(player.combo).toBe(0);
  });

  it('turns toward the nearest creature rather than swinging at air', () => {
    const { world, player } = setup();
    const below = mobAt(world, player, 0, 30);
    swing(world, player);
    expect(below.hp).toBeLessThan(below.maxHp);
    expect(player.facing.y).toBeGreaterThan(0.9);
  });

  it('swings on the gather button when there is nothing to gather but something to hit', () => {
    const { world, player } = setup();
    const mob = mobAt(world, player, 30, 0);
    player.gatherNodeId = null;
    swing(world, player, { ...EMPTY_INPUT, interact: true });
    expect(mob.hp).toBeLessThan(mob.maxHp);
  });

  it('does not swing on the gather button with nothing close', () => {
    const { world, player } = setup();
    player.gatherNodeId = null;
    swing(world, player, { ...EMPTY_INPUT, interact: true });
    expect(world.events.some((e) => e.kind === 'strike')).toBe(false);
  });

  it('waits out its cooldown between swings', () => {
    const { world, player } = setup();
    stepStrike(world, player, ATTACK, 0);
    stepStrike(world, player, ATTACK, 0.05);
    expect(world.events.filter((e) => e.kind === 'strike')).toHaveLength(1);
  });
});
