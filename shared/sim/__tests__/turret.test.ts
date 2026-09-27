import { describe, expect, it } from 'vitest';
import { TURRET, TURRET_AMMO } from '../../data/machines';
import { TICK_DT } from '../constants';
import { clickSlot } from '../containers';
import { tileCenter } from '../grid';
import { countIn } from '../slots';
import { spawnMob } from '../systems/mobs';
import { turretWrecked } from '../systems/turret';
import { insertIntoMachine } from '../systems/factory';
import type { Machine } from '../types';
import { advance, at, bench, fill, put, type Bench } from './bench';

function turret(b: Bench, dx = 4): Machine {
  const spot = at(dx, 3);
  const m = put(b, 'turret', spot.tx, spot.ty, 0) as Machine;
  // The player's own weapons would muddy who did the shooting.
  b.player.weapons = [];
  return m;
}

/** A creature sitting this many pixels east of the turret. */
function mobBeside(b: Bench, m: Machine, px: number) {
  const c = tileCenter(m.tx, m.ty);
  const mob = spawnMob(b.world, 'brute', { x: c.x + px, y: c.y });
  mob.hp = mob.maxHp = 5000;
  return mob;
}

describe('gun turret', () => {
  it('takes rounds from a belt or by hand, and nothing else', () => {
    const b = bench();
    const m = turret(b);
    expect(insertIntoMachine(m, 'ironPlate')).toBe(false);
    expect(insertIntoMachine(m, 'rounds')).toBe(true);
    b.player.cursor = { id: 'gear', count: 5 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 0 })).toBe(false);
    b.player.cursor = { id: 'rounds', count: 20 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 0 })).toBe(true);
    expect(countIn(m.input, 'rounds')).toBe(21);
  });

  it('shoots a creature in range, one round a shot, at its rate', () => {
    const b = bench();
    const m = turret(b);
    fill(m.input, 'rounds', 50);
    const mob = mobBeside(b, m, TURRET.range * 0.6);
    advance(b.world, 2);
    const spent = 50 - countIn(m.input, 'rounds');
    // Two seconds at its rate, give or take the shot in hand at the edges.
    expect(spent).toBeGreaterThanOrEqual(TURRET.rate * 2 - 1);
    expect(spent).toBeLessThanOrEqual(TURRET.rate * 2 + 1);
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(m.stalled).toBe(false);
  });

  it('holds its fire with nothing in range, and stalls with no rounds', () => {
    const b = bench();
    const m = turret(b);
    fill(m.input, 'rounds', 10);
    mobBeside(b, m, TURRET.range * 3);
    advance(b.world, 1);
    expect(countIn(m.input, 'rounds')).toBe(10);

    const empty = bench();
    const dry = turret(empty);
    const mob = mobBeside(empty, dry, 60);
    advance(empty.world, 0.5);
    expect(dry.stalled).toBe(true);
    expect(empty.world.projectiles.every((p) => p.ownerId !== dry.id)).toBe(true);
    expect(mob.hp).toBe(mob.maxHp);
  });

  it('kills what it can reach, firing as itself rather than as a player', () => {
    const b = bench();
    const m = turret(b);
    fill(m.input, 'rounds', 100);
    const c = tileCenter(m.tx, m.ty);
    const slime = spawnMob(b.world, 'slime', { x: c.x + 80, y: c.y });
    advance(b.world, 0.6);
    expect(b.world.projectiles.some((p) => p.ownerId === m.id)).toBe(true);
    expect(b.world.players.has(m.id)).toBe(false);
    advance(b.world, 3);
    expect(slime.hp).toBeLessThanOrEqual(0);
  });

  it('fires steel rounds first, harder and through the creature in front', () => {
    const b = bench();
    const m = turret(b);
    fill(m.input, 'rounds', 20);
    expect(insertIntoMachine(m, 'steelRounds')).toBe(true);
    fill(m.input, 'steelRounds', 9);
    const front = mobBeside(b, m, TURRET.range * 0.4);
    const behind = mobBeside(b, m, TURRET.range * 0.4 + 30);
    advance(b.world, 1.2);
    expect(countIn(m.input, 'rounds')).toBe(20);
    expect(countIn(m.input, 'steelRounds')).toBeLessThan(10);
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(behind.hp).toBeLessThan(behind.maxHp);
    const shot = TURRET_AMMO.steelRounds.damage;
    expect(shot).toBeGreaterThan(TURRET_AMMO.rounds.damage * 2);
  });

  it('keeps a slot for each kind of round, so iron never fills the steel slot', () => {
    const b = bench();
    const m = turret(b);
    let taken = 0;
    while (insertIntoMachine(m, 'rounds')) taken++;
    expect(taken).toBe(100);
    expect(insertIntoMachine(m, 'steelRounds')).toBe(true);
  });

  it('is chewed by a creature beside it until wrecked, then holds its fire', () => {
    const b = bench();
    const m = turret(b);
    b.world.phase = 'night';
    b.world.phaseTime = 1000;
    mobBeside(b, m, 40);
    let bites = 0;
    let wrecked = false;
    // A tick at a time: the event buffer only holds the last tick's.
    for (let i = 0; i < 40 / TICK_DT && !turretWrecked(m); i++) {
      advance(b.world, TICK_DT);
      for (const e of b.world.events) {
        if (e.kind !== 'turretHit') continue;
        bites++;
        wrecked ||= e.wrecked;
      }
    }
    expect(turretWrecked(m)).toBe(true);
    expect(wrecked).toBe(true);
    // A single brute takes about a dozen bites, not one.
    expect(bites).toBeGreaterThanOrEqual(Math.floor(TURRET.armour / 14));

    fill(m.input, 'rounds', 20);
    advance(b.world, 1);
    expect(countIn(m.input, 'rounds')).toBe(20);
    expect(m.stalled).toBe(true);
  });

  it('draws a raider passing close, and is patched at dawn', () => {
    const b = bench();
    const m = turret(b);
    b.world.phase = 'night';
    b.world.phaseTime = 1000;
    const c = tileCenter(m.tx, m.ty);
    // South of the gun, where the camp and the player are nowhere near.
    const mob = mobBeside(b, m, 0);
    mob.pos = { x: c.x, y: c.y + TURRET.aggro - 10 };
    const before = mob.pos.y;
    advance(b.world, 1);
    expect(mob.pos.y).toBeLessThan(before);
    advance(b.world, 10);
    expect(m.wear ?? 0).toBeGreaterThan(0);

    b.world.phaseTime = 0.01;
    advance(b.world, 0.1);
    expect(b.world.phase).toBe('day');
    expect(m.wear).toBeUndefined();
  });

  it('is left alone by a creature too far off to notice it', () => {
    const b = bench();
    const m = turret(b);
    b.world.phase = 'night';
    b.world.phaseTime = 1000;
    const c = tileCenter(m.tx, m.ty);
    const mob = mobBeside(b, m, 0);
    mob.pos = { x: c.x, y: c.y + TURRET.aggro * 3 };
    advance(b.world, 3);
    expect(m.wear).toBeUndefined();
  });
});
