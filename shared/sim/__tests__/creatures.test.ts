import { describe, expect, it } from 'vitest';
import { MOBS, MOB_ORDER } from '../../data/mobs';
import { CYCLE } from '../constants';
import { stepCycle } from '../systems/cycle';
import { damageMob, stepProjectiles, stepWeapons } from '../systems/combat';
import { spawnMob, stepMobs } from '../systems/mobs';
import type { MobTypeId, Player, WeaponId, World } from '../types';
import { addPlayer, createWorld } from '../world';

function arena(): { world: World; player: Player } {
  const world = createWorld(19);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  return { world, player };
}

function near(world: World, player: Player, type: MobTypeId, dx: number, dy = 0) {
  return spawnMob(world, type, { x: player.pos.x + dx, y: player.pos.y + dy });
}

/** Steps mobs and projectiles, the parts of `step` these tests are about. */
function run(world: World, seconds: number, dt = 1 / 30): void {
  for (let t = 0; t < seconds; t += dt) {
    world.events.length = 0;
    stepMobs(world, dt);
    stepProjectiles(world, dt);
  }
}

function fire(world: World, player: Player, weapon: WeaponId): void {
  player.weapons = [{ id: weapon, level: 1, cooldown: 0 }];
  stepWeapons(world, player, 0);
}

describe('armour', () => {
  it('takes a flat amount off every hit, but never all of it', () => {
    const { world, player } = arena();
    const shell = near(world, player, 'shellback', 60);
    damageMob(world, shell, 10, player.id);
    expect(shell.maxHp - shell.hp).toBe(10 - MOBS.shellback.armor!);
    const before = shell.hp;
    damageMob(world, shell, 1, player.id);
    expect(before - shell.hp).toBe(1);
  });
});

describe('the spitter', () => {
  it('stops short of the player and hits them from range', () => {
    const { world, player } = arena();
    const spitter = near(world, player, 'spitter', 400);
    player.hp = player.maxHp = 1000;
    run(world, 8);
    const gap = Math.hypot(spitter.pos.x - player.pos.x, spitter.pos.y - player.pos.y);
    // It never closes to biting range: all the harm it did came through the air.
    expect(gap).toBeGreaterThan(MOBS.spitter.spit!.range * 0.4);
    expect(player.hp).toBeLessThan(1000);
  });

  it('spits nothing a mob can be hurt by', () => {
    const { world, player } = arena();
    near(world, player, 'spitter', 150);
    const bystander = near(world, player, 'slime', 75, 0);
    bystander.hp = bystander.maxHp = 1e6;
    run(world, 4);
    expect(bystander.hp).toBe(1e6);
  });
});

describe('the mother slime', () => {
  it('bursts into slimes when it dies', () => {
    const { world, player } = arena();
    const mother = near(world, player, 'mother', 100);
    damageMob(world, mother, 1000, player.id);
    const children = world.mobs.filter((m) => m.type === 'slime');
    expect(children.length).toBe(MOBS.mother.splits!.count);
  });
});

describe('the stone warden', () => {
  it('is never bought from a night budget', () => {
    expect(MOB_ORDER).not.toContain('warden');
  });

  it('walks in on every fifth night, and only then', () => {
    const { world } = arena();
    const bosses: number[] = [];
    for (let night = 1; night <= 10; night++) {
      world.phase = 'day';
      world.phaseTime = 0;
      world.mobs.length = 0;
      stepCycle(world, 0);
      if (world.mobs.some((m) => m.type === 'warden')) bosses.push(world.nightIndex);
      expect(world.phaseTime).toBe(CYCLE.nightSeconds);
    }
    expect(bosses).toEqual([5, 10]);
  });

  it('stays away from a peaceful island', () => {
    const world = createWorld(19, true);
    world.nightIndex = 4;
    world.phase = 'day';
    world.phaseTime = 0;
    stepCycle(world, 0);
    expect(world.mobs.length).toBe(0);
  });

  it('drops a heap of orbs', () => {
    const { world, player } = arena();
    const boss = near(world, player, 'warden', 200);
    damageMob(world, boss, 1e5, player.id);
    expect(world.pickups.length).toBe(MOBS.warden.loot!.orbs);
  });
});

describe('the swarm queen', () => {
  it('comes on her own nights from the thirteenth, never on a Warden night', () => {
    const { world } = arena();
    const queens: number[] = [];
    const wardens: number[] = [];
    for (let night = 1; night <= 25; night++) {
      world.phase = 'day';
      world.phaseTime = 0;
      world.mobs.length = 0;
      stepCycle(world, 0);
      if (world.mobs.some((m) => m.type === 'queen')) queens.push(world.nightIndex);
      if (world.mobs.some((m) => m.type === 'warden')) wardens.push(world.nightIndex);
    }
    expect(queens).toEqual([13, 18, 23]);
    expect(wardens).toEqual([5, 10, 15, 20, 25]);
  });

  it('is as tuned on her first visit and tougher after', () => {
    const { world } = arena();
    world.nightIndex = 13;
    expect(near(world, world.players.values().next().value!, 'queen', 300).maxHp).toBe(MOBS.queen.hp);
    world.nightIndex = 18;
    expect(near(world, world.players.values().next().value!, 'queen', 300).maxHp).toBeGreaterThan(MOBS.queen.hp);
  });

  it('calls in crawlers while she lives', () => {
    const { world, player } = arena();
    player.hp = player.maxHp = 1e6;
    near(world, player, 'queen', 260);
    run(world, 20);
    const crawlers = world.mobs.filter((m) => m.type === 'crawler').length;
    expect(crawlers).toBeGreaterThanOrEqual(MOBS.queen.summons!.count * 2);
    expect(world.mobs.length).toBeLessThanOrEqual(60);
  });

  it('keeps her distance and spits', () => {
    const { world, player } = arena();
    player.hp = player.maxHp = 1e6;
    const queen = near(world, player, 'queen', 400);
    run(world, 12);
    expect(Math.hypot(queen.pos.x - player.pos.x, queen.pos.y - player.pos.y)).toBeGreaterThan(100);
    expect(player.hp).toBeLessThan(player.maxHp);
  });

  it('stops calling once the field is full', () => {
    const { world, player } = arena();
    player.hp = player.maxHp = 1e6;
    for (let i = 0; i < 60; i++) near(world, player, 'slime', 2000 + i * 4, 2000).hp = 1e6;
    const queen = near(world, player, 'queen', 260);
    queen.summonCd = 0.01;
    run(world, 0.1);
    expect(world.mobs.filter((m) => m.type === 'crawler').length).toBe(0);
  });
});

describe('the crystal bulwark', () => {
  it('comes on its own nights from the twenty-sixth, never alongside another boss', () => {
    const { world } = arena();
    const seen: Record<string, number[]> = { warden: [], queen: [], bulwark: [] };
    for (let night = 1; night <= 40; night++) {
      world.phase = 'day';
      world.phaseTime = 0;
      world.mobs.length = 0;
      stepCycle(world, 0);
      for (const type of Object.keys(seen)) if (world.mobs.some((m) => m.type === type)) seen[type].push(world.nightIndex);
    }
    expect(seen.bulwark).toEqual([26, 31, 36]);
    const nights = [...seen.warden, ...seen.queen, ...seen.bulwark];
    expect(new Set(nights).size).toBe(nights.length);
  });

  it('shields what stands near it, and not itself', () => {
    const { world, player } = arena();
    const bulwark = near(world, player, 'bulwark', 600);
    const covered = near(world, player, 'brute', 600, 80);
    const bare = near(world, player, 'brute', -600);
    run(world, 1 / 30);
    expect(covered.shield).toBe(MOBS.bulwark.shields!.take);
    expect(bare.shield).toBeUndefined();
    expect(bulwark.shield).toBeUndefined();

    const before = { covered: covered.hp, bare: bare.hp };
    damageMob(world, covered, 30, player.id);
    damageMob(world, bare, 30, player.id);
    expect(before.covered - covered.hp).toBeCloseTo(30 * MOBS.bulwark.shields!.take, 6);
    expect(before.bare - bare.hp).toBe(30);
  });

  it('drops the ward once it dies', () => {
    const { world, player } = arena();
    const bulwark = near(world, player, 'bulwark', 600);
    const covered = near(world, player, 'crawler', 600, 60);
    run(world, 1 / 30);
    expect(covered.shield).toBeDefined();
    damageMob(world, bulwark, 1e6, player.id);
    run(world, 2 / 30);
    expect('shield' in covered).toBe(false);
  });
});

describe('new weapons', () => {
  it('Ember Pot bursts over everything around the one it hits', () => {
    const { world, player } = arena();
    const a = near(world, player, 'brute', 120);
    const b = near(world, player, 'brute', 120, 30);
    const c = near(world, player, 'brute', 120, -30);
    const far = near(world, player, 'brute', 120, 200);
    fire(world, player, 'ember');
    run(world, 1);
    const hurt = [a, b, c].filter((m) => m.hp < m.maxHp);
    expect(hurt.length).toBe(3);
    expect(far.hp).toBe(far.maxHp);
  });

  it('Frost Shard slows what it hits', () => {
    const { world, player } = arena();
    const plain = near(world, player, 'crawler', 150, 0);
    // Out of the shard's reach, so only one of the two is chilled.
    const free = near(world, player, 'crawler', 0, 300);
    fire(world, player, 'frost');
    for (let i = 0; i < 12; i++) stepProjectiles(world, 1 / 30);
    expect(plain.chill).toBeGreaterThan(0);
    expect(free.chill ?? 0).toBe(0);
    const from = { plain: { ...plain.pos }, free: { ...free.pos } };
    run(world, 0.5);
    const moved = (m: typeof plain, p: { x: number; y: number }) => Math.hypot(m.pos.x - p.x, m.pos.y - p.y);
    expect(moved(plain, from.plain)).toBeLessThan(moved(free, from.free) * 0.8);
  });

  it('Harpoon runs through a whole line', () => {
    const { world, player } = arena();
    const line = [60, 100, 140, 180, 220].map((dx) => near(world, player, 'slime', dx));
    for (const m of line) m.hp = m.maxHp = 1000;
    fire(world, player, 'harpoon');
    // Only the shot moves, so the line stays a line.
    for (let i = 0; i < 30; i++) stepProjectiles(world, 1 / 30);
    expect(line.every((m) => m.hp < 1000)).toBe(true);
  });
});
