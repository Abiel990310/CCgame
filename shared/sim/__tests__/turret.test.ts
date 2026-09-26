import { describe, expect, it } from 'vitest';
import { TURRET } from '../../data/machines';
import { clickSlot } from '../containers';
import { tileCenter } from '../grid';
import { countIn } from '../slots';
import { spawnMob } from '../systems/mobs';
import { insertIntoMachine } from '../systems/factory';
import { TURRET_AMMO } from '../systems/turret';
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
    expect(insertIntoMachine(m, TURRET_AMMO)).toBe(true);
    b.player.cursor = { id: 'gear', count: 5 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 0 })).toBe(false);
    b.player.cursor = { id: TURRET_AMMO, count: 20 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 0 })).toBe(true);
    expect(countIn(m.input, TURRET_AMMO)).toBe(21);
  });

  it('shoots a creature in range, one round a shot, at its rate', () => {
    const b = bench();
    const m = turret(b);
    fill(m.input, TURRET_AMMO, 50);
    const mob = mobBeside(b, m, TURRET.range * 0.6);
    advance(b.world, 2);
    const spent = 50 - countIn(m.input, TURRET_AMMO);
    // Two seconds at its rate, give or take the shot in hand at the edges.
    expect(spent).toBeGreaterThanOrEqual(TURRET.rate * 2 - 1);
    expect(spent).toBeLessThanOrEqual(TURRET.rate * 2 + 1);
    expect(mob.hp).toBeLessThan(mob.maxHp);
    expect(m.stalled).toBe(false);
  });

  it('holds its fire with nothing in range, and stalls with no rounds', () => {
    const b = bench();
    const m = turret(b);
    fill(m.input, TURRET_AMMO, 10);
    mobBeside(b, m, TURRET.range * 3);
    advance(b.world, 1);
    expect(countIn(m.input, TURRET_AMMO)).toBe(10);

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
    fill(m.input, TURRET_AMMO, 100);
    const c = tileCenter(m.tx, m.ty);
    const slime = spawnMob(b.world, 'slime', { x: c.x + 80, y: c.y });
    advance(b.world, 0.6);
    expect(b.world.projectiles.some((p) => p.ownerId === m.id)).toBe(true);
    expect(b.world.players.has(m.id)).toBe(false);
    advance(b.world, 3);
    expect(slime.hp).toBeLessThanOrEqual(0);
  });
});
