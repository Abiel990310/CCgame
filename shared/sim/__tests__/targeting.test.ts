import { describe, expect, it } from 'vitest';
import { stepProjectiles, stepWeapons } from '../systems/combat';
import type { Mob, MobTypeId, Player, WeaponId, World } from '../types';
import { addPlayer, createWorld } from '../world';

let nextMobId = 5000;

function mobAt(world: World, player: Player, dx: number, dy: number, hp = 10, type: MobTypeId = 'slime'): Mob {
  const mob: Mob = {
    id: nextMobId++,
    type,
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

function armed(weapon: WeaponId): { world: World; player: Player } {
  const world = createWorld(19);
  // Keep generated night mobs out of the picture.
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  player.weapons = [{ id: weapon, level: 1, cooldown: 0 }];
  return { world, player };
}

/** Fires one volley per call, skipping the cooldown in between. */
function volley(world: World, player: Player): void {
  for (const w of player.weapons) w.cooldown = 0;
  stepWeapons(world, player, 0);
}

const aimedAt = (world: World) => world.projectiles.map((p) => p.targetId);

describe('weapon targeting', () => {
  it('stops pouring shots into a mob that damage in flight will already kill', () => {
    const { world, player } = armed('sling');
    const near = mobAt(world, player, 40, 0, 5);
    const far = mobAt(world, player, 120, 0, 5);
    volley(world, player);
    volley(world, player);
    // A level-1 stone does 6: the first one is enough for the near mob.
    expect(aimedAt(world)).toEqual([near.id, far.id]);
  });

  it('keeps firing at the nearest when everything in range is already doomed', () => {
    const { world, player } = armed('sling');
    const only = mobAt(world, player, 40, 0, 5);
    volley(world, player);
    volley(world, player);
    expect(world.projectiles).toHaveLength(2);
    const second = world.projectiles[1];
    expect(Math.sign(second.vel.x)).toBe(Math.sign(only.pos.x - player.pos.x));
  });

  it('gives each multishot projectile its own target', () => {
    const { world, player } = armed('sling');
    player.stats.multishot = 2;
    const a = mobAt(world, player, 50, 0, 20);
    const b = mobAt(world, player, 0, 80, 20);
    const c = mobAt(world, player, -110, 0, 20);
    volley(world, player);
    expect(new Set(aimedAt(world))).toEqual(new Set([a.id, b.id, c.id]));
  });

  it('fans spare multishot projectiles around the target when the crowd runs out', () => {
    const { world, player } = armed('sling');
    player.stats.multishot = 2;
    const lone = mobAt(world, player, 60, 0, 100);
    volley(world, player);
    expect(aimedAt(world)).toEqual([lone.id, undefined, undefined]);
    const ys = world.projectiles.map((p) => Math.sign(Math.round(p.vel.y)));
    expect(ys.sort()).toEqual([-1, 0, 1]);
  });

  it('points the bow at the toughest mob in range', () => {
    const { world, player } = armed('bow');
    mobAt(world, player, 40, 0, 10);
    const brute = mobAt(world, player, 200, 0, 80, 'brute');
    volley(world, player);
    expect(aimedAt(world)).toEqual([brute.id]);
  });

  it('lines the thornburst up with the most crowded row', () => {
    const { world, player } = armed('thorn');
    mobAt(world, player, 0, -40, 100); // alone, and closest
    const row = [1, 2, 3].map((k) => mobAt(world, player, 60 * k, 30 * k, 100));
    volley(world, player);
    expect(aimedAt(world)).toEqual([row[0].id]);
  });

  it('scatters spark shots across the crowd instead of the same mob', () => {
    const { world, player } = armed('spark');
    const crowd = [30, 60, 90, 120].map((dx) => mobAt(world, player, dx, 10, 1000));
    for (let i = 0; i < 24; i++) volley(world, player);
    const hit = new Set(aimedAt(world));
    expect(hit.size).toBeGreaterThanOrEqual(3);
    for (const id of hit) expect(crowd.map((m) => m.id)).toContain(id);
  });

  it('frees a mob up once the shot aimed at it lands', () => {
    const { world, player } = armed('sling');
    const mob = mobAt(world, player, 40, 0, 1000);
    volley(world, player);
    for (let i = 0; i < 20; i++) stepProjectiles(world, 1 / 60);
    expect(mob.hp).toBeLessThan(1000);
    expect(world.projectiles.every((p) => p.targetId === undefined)).toBe(true);
  });
});
