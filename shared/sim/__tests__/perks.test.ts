import { describe, expect, it } from 'vitest';
import { UPGRADES, WEAPON_MAX_LEVEL } from '../../data/upgrades';
import { BITE, PLAYER } from '../constants';
import { addPerk, masteryId, perk } from '../perks';
import { chooseUpgrade, rollOffers } from '../progression';
import { damageMob, damagePlayer, stepProjectiles, stepWeapons } from '../systems/combat';
import { spawnMob, stepMobs } from '../systems/mobs';
import type { Player, World } from '../types';
import { addPlayer, createWorld } from '../world';

function arena(): { world: World; player: Player } {
  const world = createWorld(23);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  return { world, player };
}

const byId = (id: string) => UPGRADES.find((u) => u.id === id)!;

describe('the upgrade pool', () => {
  it('has around fifty upgrades, all with distinct ids', () => {
    expect(UPGRADES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });

  it('states the cap the level-up screen draws, and stops at it', () => {
    for (const def of UPGRADES) {
      if (def.max === undefined || def.id.startsWith('weapon:')) continue;
      const { player } = arena();
      if (!def.available(player)) continue;
      for (let i = 0; i < def.max; i++) def.apply(player);
      expect(def.available(player), def.id).toBe(false);
    }
    expect(UPGRADES.filter((u) => u.id.startsWith('weapon:')).every((u) => u.max === WEAPON_MAX_LEVEL)).toBe(true);
  });

  it('stops offering a perk once it is maxed', () => {
    const { player } = arena();
    const keen = byId('keenEye');
    for (let i = 0; i < 5; i++) {
      expect(keen.available(player)).toBe(true);
      keen.apply(player);
    }
    expect(perk(player, 'keenEye')).toBe(5);
    expect(keen.available(player)).toBe(false);
  });

  it('only offers a mastery for a weapon at its last level', () => {
    const { player } = arena();
    const mastery = byId(masteryId('sling'));
    player.weapons = [{ id: 'sling', level: WEAPON_MAX_LEVEL - 1, cooldown: 0 }];
    expect(mastery.available(player)).toBe(false);
    player.weapons[0].level = WEAPON_MAX_LEVEL;
    expect(mastery.available(player)).toBe(true);
  });

  it('keeps perks that need another one out of the pool until then', () => {
    const { player } = arena();
    expect(byId('brutal').available(player)).toBe(false);
    addPerk(player, 'lucky');
    expect(byId('brutal').available(player)).toBe(true);
  });

  it('shows one more choice with Insight, and applies the one picked', () => {
    const { world, player } = arena();
    player.pendingUpgrades = 2;
    expect(rollOffers(world, player).length).toBe(3);
    addPerk(player, 'insight');
    player.offers = rollOffers(world, player);
    expect(player.offers.length).toBe(4);
    expect(new Set(player.offers.map((o) => o.id)).size).toBe(4);
    expect(chooseUpgrade(world, player, player.offers[0].id)).toBe(true);
    expect(player.pendingUpgrades).toBe(1);
  });

  it('numbers a perk taken again', () => {
    const { world, player } = arena();
    for (const u of UPGRADES) if (u.id !== 'keenEye') player.perks = { ...player.perks, [u.id]: 99 };
    player.weapons = [{ id: 'sling', level: 1, cooldown: 0 }];
    addPerk(player, 'keenEye');
    const offers = rollOffers(world, player).map((o) => o.title);
    expect(offers).toContain('Keen Eye II');
  });
});

describe('perks in play', () => {
  it('Padded Coat takes a point off every hit, never all of it', () => {
    const { world, player } = arena();
    addPerk(player, 'padded');
    addPerk(player, 'padded');
    damagePlayer(world, player, 10);
    expect(player.maxHp - player.hp).toBe(8);
    player.invuln = 0;
    const hp = player.hp;
    damagePlayer(world, player, 1);
    expect(hp - player.hp).toBe(1);
  });

  it('Second Wind gets a downed player up sooner', () => {
    const { world, player } = arena();
    addPerk(player, 'secondWind');
    damagePlayer(world, player, 1e6);
    expect(player.downed).toBeCloseTo(PLAYER.reviveSeconds * 0.7, 6);
  });

  it('Bramble Coat hurts whatever bites', () => {
    const { world, player } = arena();
    addPerk(player, 'bramble');
    player.hp = player.maxHp = 1000;
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 5, y: player.pos.y });
    // It rears back first, then bites.
    for (let t = 0; t <= BITE.windup + 2 / 30; t += 1 / 30) stepMobs(world, 1 / 30);
    expect(brute.hp).toBe(brute.maxHp - 8);
  });

  it('Vampiric heals on a kill', () => {
    const { world, player } = arena();
    addPerk(player, 'vampiric');
    player.hp = 50;
    const slime = spawnMob(world, 'slime', { x: player.pos.x + 80, y: player.pos.y });
    damageMob(world, slime, 1000, player.id);
    expect(player.hp).toBe(51);
  });

  it('Executioner finishes a nearly dead mob, but never a boss', () => {
    const { world, player } = arena();
    addPerk(player, 'executioner');
    const brute = spawnMob(world, 'brute', { x: player.pos.x + 80, y: player.pos.y });
    damageMob(world, brute, brute.maxHp - 3, player.id);
    expect(brute.hp).toBeLessThanOrEqual(0);
    const boss = spawnMob(world, 'warden', { x: player.pos.x + 200, y: player.pos.y });
    boss.hp = 10;
    damageMob(world, boss, 5, player.id);
    expect(boss.hp).toBeGreaterThan(0);
  });

  it('Keen Eye lets a weapon reach a mob just out of range', () => {
    const { world, player } = arena();
    player.weapons = [{ id: 'sling', level: 1, cooldown: 0 }];
    spawnMob(world, 'slime', { x: player.pos.x + 250, y: player.pos.y });
    stepWeapons(world, player, 0);
    expect(world.projectiles.length).toBe(0);
    addPerk(player, 'keenEye');
    stepWeapons(world, player, 0);
    expect(world.projectiles.length).toBe(1);
  });

  it('a mastered weapon hits half again as hard', () => {
    const { world, player } = arena();
    player.weapons = [{ id: 'sling', level: WEAPON_MAX_LEVEL, cooldown: 0 }];
    spawnMob(world, 'slime', { x: player.pos.x + 100, y: player.pos.y }).hp = 1e6;
    stepWeapons(world, player, 0);
    const plain = world.projectiles[0].damage;
    addPerk(player, masteryId('sling'));
    player.weapons[0].cooldown = 0;
    stepWeapons(world, player, 0);
    expect(world.projectiles[1].damage).toBeCloseTo(plain * 1.5, 6);
  });

  it('Piercing and Heavy Hand carry into the shot', () => {
    const { world, player } = arena();
    addPerk(player, 'piercing');
    addPerk(player, 'heavy');
    player.weapons = [{ id: 'sling', level: 1, cooldown: 0 }];
    const slime = spawnMob(world, 'slime', { x: player.pos.x + 60, y: player.pos.y });
    slime.hp = slime.maxHp = 1000;
    stepWeapons(world, player, 0);
    expect(world.projectiles[0].pierce).toBe(1);
    for (let i = 0; i < 10; i++) stepProjectiles(world, 1 / 30);
    expect(slime.vel.x).toBeGreaterThan(50);
  });

  it('Lucky Strike crits some shots, and a player without it never rolls', () => {
    const { world, player } = arena();
    player.weapons = [{ id: 'sling', level: 1, cooldown: 0 }];
    spawnMob(world, 'slime', { x: player.pos.x + 100, y: player.pos.y }).hp = 1e9;
    const before = world.rngState;
    stepWeapons(world, player, 0);
    expect(world.rngState).toBe(before);
    for (let i = 0; i < 5; i++) addPerk(player, 'lucky');
    for (let i = 0; i < 60; i++) {
      player.weapons[0].cooldown = 0;
      stepWeapons(world, player, 0);
    }
    const base = world.projectiles[0].damage;
    const crits = world.projectiles.filter((p) => p.damage > base * 1.5).length;
    expect(crits).toBeGreaterThan(5);
    expect(crits).toBeLessThan(45);
  });
});
