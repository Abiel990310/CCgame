import { MOBS } from '../../data/mobs';
import { WEAPONS, weaponDamage, weaponRate, type WeaponDef } from '../../data/weapons';
import { CAMP, COMBAT, PLAYER } from '../constants';
import { masteryId, perk } from '../perks';
import { distance, distanceSq, normalize } from '../math';
import { grantXp, nextFloat } from '../progression';
import { researchBonuses } from '../research';
import type { Mob, Player, Projectile, Vec2, World } from '../types';
import { spawnMob } from './mobs';

/** Radians between multishot projectiles that have no target of their own. */
const FAN_SPREAD = 0.22;

/** Damage already in the air towards each mob, keyed by mob id. */
function incomingDamage(world: World): Map<number, number> {
  const incoming = new Map<number, number>();
  for (const p of world.projectiles) {
    if (p.targetId === undefined) continue;
    incoming.set(p.targetId, (incoming.get(p.targetId) ?? 0) + p.damage);
  }
  return incoming;
}

/** How many mobs a shot from `from` towards `at` would pass through, capped at what it can pierce. */
function lineScore(world: World, from: Vec2, at: Vec2, range: number, maxHits: number): number {
  const dir = normalize({ x: at.x - from.x, y: at.y - from.y });
  let hits = 0;
  for (const mob of world.mobs) {
    if (mob.hp <= 0) continue;
    const rx = mob.pos.x - from.x;
    const ry = mob.pos.y - from.y;
    const along = rx * dir.x + ry * dir.y;
    if (along < 0 || along > range) continue;
    const across = Math.abs(rx * dir.y - ry * dir.x);
    if (across <= MOBS[mob.type].radius + 4) hits++;
  }
  return Math.min(hits, maxHits);
}

/**
 * Chooses one target for one shot. Mobs that damage already in flight will
 * kill are skipped, and so are mobs this volley already chose, so a crowd gets
 * spread fire rather than every stone landing on the same corpse.
 */
function pickTarget(
  world: World,
  player: Player,
  def: WeaponDef,
  range: number,
  incoming: Map<number, number>,
  taken: Set<number>,
): Mob | null {
  const rangeSq = range * range;
  const eligible: Mob[] = [];
  for (const mob of world.mobs) {
    if (mob.hp <= 0 || taken.has(mob.id)) continue;
    if (distanceSq(mob.pos, player.pos) > rangeSq) continue;
    if ((incoming.get(mob.id) ?? 0) >= mob.hp) continue;
    eligible.push(mob);
  }
  if (eligible.length === 0) return null;

  if (def.targeting === 'scatter') {
    return eligible[Math.floor(nextFloat(world) * eligible.length)];
  }

  let best = eligible[0];
  let bestKey = -Infinity;
  for (const mob of eligible) {
    // Nearer always breaks ties, so a rule with nothing to choose between acts like 'nearest'.
    const near = -distanceSq(mob.pos, player.pos) / rangeSq;
    let key = near;
    if (def.targeting === 'toughest') {
      key = mob.hp - (incoming.get(mob.id) ?? 0) + near;
    } else if (def.targeting === 'line') {
      key = lineScore(world, player.pos, mob.pos, range, def.pierce + 1) + near;
    }
    if (key > bestKey) {
      best = mob;
      bestKey = key;
    }
  }
  return best;
}

function nearestMob(world: World, player: Player, range: number): Mob | null {
  let best: Mob | null = null;
  let bestDist = range * range;
  for (const mob of world.mobs) {
    if (mob.hp <= 0) continue;
    const d = distanceSq(mob.pos, player.pos);
    if (d < bestDist) {
      best = mob;
      bestDist = d;
    }
  }
  return best;
}

/** Damage perks that depend on when and where the player is fighting. */
function situational(world: World, player: Player): number {
  let f = 1;
  if (world.phase === 'night') f *= 1 + 0.15 * perk(player, 'nightOwl');
  const guard = perk(player, 'campGuard');
  if (guard > 0 && distance(player.pos, world.camp) <= CAMP.defendRadius) f *= 1 + 0.25 * guard;
  return f;
}

/** Weapons fire themselves — the player only ever chooses where to stand. */
export function stepWeapons(world: World, player: Player, dt: number): void {
  if (player.downed > 0) return;

  const incoming = incomingDamage(world);
  const boost = researchBonuses(world).damage * situational(world, player);
  const reach = 1 + 0.1 * perk(player, 'keenEye');
  const speedUp = 1 + 0.15 * perk(player, 'swift');
  const extraPierce = perk(player, 'piercing');
  const crit = 0.08 * perk(player, 'lucky');
  const critHit = 2 + 0.5 * perk(player, 'brutal');

  for (const weapon of player.weapons) {
    const def = WEAPONS[weapon.id];
    weapon.cooldown -= dt;
    if (weapon.cooldown > 0) continue;

    const mastered = perk(player, masteryId(weapon.id)) > 0;
    const range = def.range * reach;
    const damage = weaponDamage(weapon.id, weapon.level) * player.stats.damage * boost * (mastered ? 1.5 : 1);
    const shots = 1 + player.stats.multishot;
    const taken = new Set<number>();
    const targets: Mob[] = [];
    for (let i = 0; i < shots; i++) {
      const target = pickTarget(world, player, def, range, incoming, taken);
      if (!target) break;
      targets.push(target);
      taken.add(target.id);
      incoming.set(target.id, (incoming.get(target.id) ?? 0) + damage);
    }

    // Everything in range is already as good as dead: keep firing at the
    // nearest anyway, since a mob that dodges the shots in flight survives them.
    if (targets.length === 0) {
      const fallback = nearestMob(world, player, range);
      if (fallback) targets.push(fallback);
    }

    if (targets.length === 0) {
      // Idle weapons sit ready rather than banking cooldown.
      weapon.cooldown = 0;
      continue;
    }

    const rate = weaponRate(weapon.id, weapon.level) * player.stats.fireRate * (mastered ? 1.25 : 1);
    weapon.cooldown = 1 / Math.max(0.05, rate);

    // One event per volley, not per projectile: multishot is one bowstring.
    world.events.push({ kind: 'shot', pos: { ...player.pos }, weapon: weapon.id });

    for (let i = 0; i < shots; i++) {
      // Shots beyond the distinct targets fan out around the first one.
      const target = targets[i] ?? targets[0];
      const spare = i - targets.length;
      const offset = spare < 0 ? 0 : (spare % 2 === 0 ? 1 : -1) * Math.ceil((spare + 1) / 2) * FAN_SPREAD;
      const base = normalize({ x: target.pos.x - player.pos.x, y: target.pos.y - player.pos.y });
      const cos = Math.cos(offset);
      const sin = Math.sin(offset);
      // Only rolled for a player who can crit, so everyone else's RNG stream is untouched.
      const hit = crit > 0 && nextFloat(world) < crit ? damage * critHit : damage;
      const speed = def.speed * speedUp;
      world.projectiles.push({
        id: world.nextId++,
        pos: { ...player.pos },
        vel: {
          x: (base.x * cos - base.y * sin) * speed,
          y: (base.x * sin + base.y * cos) * speed,
        },
        damage: hit,
        // Faster shots and longer reach travel as far as they aim.
        life: COMBAT.projectileLife * Math.max(1, reach / speedUp),
        ownerId: player.id,
        weapon: weapon.id,
        pierce: def.pierce + extraPierce,
        targetId: spare < 0 ? target.id : undefined,
      });
    }
  }
}

export function stepProjectiles(world: World, dt: number): void {
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.life -= dt;

    let consumed = p.life <= 0;

    if (consumed) {
      // Spent: nothing left to hit.
    } else if (p.weapon === 'spit') {
      consumed = spitHits(world, p);
    } else {
      const def = WEAPONS[p.weapon];
      for (const mob of world.mobs) {
        if (mob.hp <= 0 || p.struck?.includes(mob.id)) continue;
        if (distance(mob.pos, p.pos) > MOBS[mob.type].radius + 4) continue;

        const owner = world.players.get(p.ownerId);
        const chill = Math.max(def.chill ?? 0, owner && perk(owner, 'frostbite') ? 0.35 : 0);
        if (chill > 0) mob.chill = Math.max(mob.chill ?? 0, chill);
        const shove = owner ? perk(owner, 'heavy') * 90 : 0;
        if (shove > 0 && !MOBS[mob.type].bossEvery) {
          const away = normalize(p.vel);
          mob.vel.x += away.x * shove;
          mob.vel.y += away.y * shove;
        }
        damageMob(world, mob, p.damage, p.ownerId);
        if (def.splash) {
          const wider = 1 + 0.25 * (owner ? perk(owner, 'volatile') : 0);
          splash(world, mob, p.pos, def.splash * wider, p.damage * 0.5, p.ownerId);
        }
        // Whatever it hits, it is no longer on its way to its target.
        p.targetId = undefined;
        if (p.pierce > 0) {
          p.pierce -= 1;
          (p.struck ??= []).push(mob.id);
        } else consumed = true;
        break;
      }
    }

    if (consumed) world.projectiles.splice(i, 1);
  }
}

/** A mob's spit only ever lands on players. */
function spitHits(world: World, p: Projectile): boolean {
  for (const player of world.players.values()) {
    if (player.downed > 0) continue;
    if (distance(player.pos, p.pos) > PLAYER.radius + 5) continue;
    damagePlayer(world, player, p.damage);
    return true;
  }
  return false;
}

/**
 * Half the hit again to everything else in the burst. The list is copied
 * first, since a mob that splits as it dies adds to the one being walked.
 */
function splash(world: World, struck: Mob, at: Vec2, radius: number, amount: number, sourceId: number): void {
  world.events.push({ kind: 'blast', pos: { ...at }, radius });
  for (const mob of [...world.mobs]) {
    if (mob === struck || mob.hp <= 0) continue;
    if (distance(mob.pos, at) > radius + MOBS[mob.type].radius) continue;
    damageMob(world, mob, amount, sourceId);
  }
}

export function damageMob(world: World, mob: Mob, amount: number, sourceId: number): void {
  const def = MOBS[mob.type];
  const dealt = Math.max(1, amount - (def.armor ?? 0));
  mob.hp -= dealt;
  mob.hitFlash = 0.12;
  world.events.push({ kind: 'hit', pos: { ...mob.pos }, amount: Math.round(dealt) });

  const killer = world.players.get(sourceId);
  if (mob.hp > 0 && killer && !def.bossEvery && perk(killer, 'executioner') && mob.hp < mob.maxHp * 0.08) mob.hp = 0;
  if (mob.hp > 0) return;

  world.events.push({ kind: 'mobDied', pos: { ...mob.pos }, type: mob.type });

  if (killer) {
    grantXp(world, killer, def.xp);
    const heal = perk(killer, 'vampiric');
    if (heal > 0 && killer.downed === 0) killer.hp = Math.min(killer.maxHp, killer.hp + heal);
  }

  if (def.splits) {
    for (let i = 0; i < def.splits.count; i++) {
      const angle = (i / def.splits.count) * Math.PI * 2 + nextFloat(world);
      const child = spawnMob(world, def.splits.into, {
        x: mob.pos.x + Math.cos(angle) * def.radius * 0.6,
        y: mob.pos.y + Math.sin(angle) * def.radius * 0.6,
      });
      child.vel = { x: Math.cos(angle) * 160, y: Math.sin(angle) * 160 };
    }
  }

  // Orbs the killer still has to walk over — movement stays the main verb.
  const orbs = def.loot?.orbs ?? 1 + Math.floor(nextFloat(world) * 2);
  const essence = (def.loot?.essence ?? 0.25) * (1 + 0.3 * (killer ? perk(killer, 'essenceSense') : 0));
  const scatter = def.loot ? 320 : 140;
  for (let i = 0; i < orbs; i++) {
    world.pickups.push({
      id: world.nextId++,
      pos: { ...mob.pos },
      vel: { x: (nextFloat(world) - 0.5) * scatter, y: (nextFloat(world) - 0.5) * scatter },
      item: nextFloat(world) < essence ? 'essence' : null,
      count: 1,
      xp: 0,
      settle: 0.3,
    });
  }
}

export function damagePlayer(world: World, player: Player, amount: number): void {
  if (player.invuln > 0 || player.downed > 0) return;

  amount = Math.max(1, amount - perk(player, 'padded'));
  player.hp -= amount;
  player.invuln = PLAYER.invulnAfterHit * (1 + 0.5 * perk(player, 'reinforced'));
  player.hitFlash = 0.18;
  world.events.push({ kind: 'playerHit', playerId: player.id, amount });

  if (player.hp <= 0) {
    player.hp = 0;
    player.downed = PLAYER.reviveSeconds * Math.pow(0.7, perk(player, 'secondWind'));
    world.events.push({ kind: 'downed', playerId: player.id });
  }
}
