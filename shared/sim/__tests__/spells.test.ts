import { describe, expect, it } from 'vitest';
import { SPELL_MAX_LEVEL, SPELLS, spellCooldown, spellPerk, spellPower } from '../../data/spells';
import { UPGRADES } from '../../data/upgrades';
import { applyOrder } from '../commands';
import { stepProjectiles } from '../systems/combat';
import { spawnMob } from '../systems/mobs';
import { knownSpells, stepSpells } from '../systems/spells';
import { EMPTY_INPUT } from '../step';
import type { Player, PlayerInput, SpellId, World } from '../types';
import { addPlayer, createWorld } from '../world';

function arena(): { world: World; player: Player } {
  const world = createWorld(31);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  player.facing = { x: 1, y: 0 };
  return { world, player };
}

const learn = (player: Player, id: SpellId, times = 1): void => {
  const def = UPGRADES.find((u) => u.id === spellPerk(id))!;
  for (let i = 0; i < times; i++) def.apply(player);
};

const CAST: PlayerInput = { ...EMPTY_INPUT, cast: true };
const DT = 1 / 30;

/** One tap of Q: pressed for a tick, then let go. */
function tap(world: World, player: Player): void {
  stepSpells(world, player, CAST, DT);
  stepSpells(world, player, EMPTY_INPUT, DT);
}

describe('spells', () => {
  it('are learned at level-up, and the first one learned is readied', () => {
    const { player } = arena();
    expect(knownSpells(player)).toEqual([]);
    learn(player, 'frostNova');
    learn(player, 'fireball');
    expect(player.spell).toBe('frostNova');
    expect(knownSpells(player)).toEqual(['fireball', 'frostNova']);
    const offer = UPGRADES.find((u) => u.id === spellPerk('fireball'))!;
    learn(player, 'fireball', SPELL_MAX_LEVEL - 1);
    expect(offer.available(player)).toBe(false);
  });

  it('do nothing for a player who has learned none', () => {
    const { world, player } = arena();
    spawnMob(world, 'slime', { x: player.pos.x + 60, y: player.pos.y });
    tap(world, player);
    expect(world.projectiles).toHaveLength(0);
    expect(world.events.some((e) => e.kind === 'cast')).toBe(false);
  });

  it('a fireball flies at the nearest creature and bursts on it', () => {
    const { world, player } = arena();
    learn(player, 'fireball');
    const near = spawnMob(world, 'brute', { x: player.pos.x, y: player.pos.y + 120 });
    near.hp = near.maxHp = 1000;
    const beside = spawnMob(world, 'brute', { x: player.pos.x + 20, y: player.pos.y + 140 });
    beside.hp = beside.maxHp = 1000;
    tap(world, player);
    expect(world.projectiles).toHaveLength(1);
    expect(world.projectiles[0].weapon).toBe('fireball');
    expect(world.projectiles[0].vel.y).toBeGreaterThan(0);
    for (let i = 0; i < 30 && world.projectiles.length > 0; i++) stepProjectiles(world, DT);
    expect(near.hp).toBeLessThan(1000);
    // The burst catches the one standing beside it too.
    expect(beside.hp).toBeLessThan(1000);
  });

  it('waits out its cooldown, and holding Q does not cast again', () => {
    const { world, player } = arena();
    learn(player, 'fireball');
    stepSpells(world, player, CAST, DT);
    for (let t = 0; t < 5; t += DT) stepSpells(world, player, CAST, DT);
    expect(world.projectiles).toHaveLength(1);
    stepSpells(world, player, EMPTY_INPUT, DT);
    tap(world, player);
    expect(world.projectiles).toHaveLength(2);
    tap(world, player);
    expect(world.projectiles).toHaveLength(2);
    expect(player.spellCd?.fireball).toBeGreaterThan(spellCooldown('fireball', 1) - 0.2);
  });

  it('a frost nova hurts, chills and throws back everything around', () => {
    const { world, player } = arena();
    learn(player, 'frostNova');
    const close = spawnMob(world, 'brute', { x: player.pos.x + 40, y: player.pos.y });
    close.hp = close.maxHp = 1000;
    const far = spawnMob(world, 'brute', { x: player.pos.x + 400, y: player.pos.y });
    far.hp = far.maxHp = 1000;
    tap(world, player);
    expect(close.hp).toBe(1000 - spellPower('frostNova', 1));
    expect(close.chill).toBe(SPELLS.frostNova.chill);
    expect(close.vel.x).toBeGreaterThan(100);
    expect(far.hp).toBe(1000);
  });

  it('mend heals, grows with level, and never past full', () => {
    const { world, player } = arena();
    learn(player, 'mend', 2);
    player.hp = 10;
    tap(world, player);
    expect(player.hp).toBeCloseTo(10 + spellPower('mend', 2), 6);
    expect(spellPower('mend', 2)).toBeGreaterThan(spellPower('mend', 1));
    player.spellCd = {};
    player.hp = player.maxHp - 1;
    tap(world, player);
    expect(player.hp).toBe(player.maxHp);
  });

  it('only a learned spell can be readied', () => {
    const { world, player } = arena();
    learn(player, 'fireball');
    expect(applyOrder(world, { p: player.id, c: { k: 'spell', id: 'mend' } })).toBe(false);
    learn(player, 'mend');
    expect(applyOrder(world, { p: player.id, c: { k: 'spell', id: 'mend' } })).toBe(true);
    expect(player.spell).toBe('mend');
  });
});
