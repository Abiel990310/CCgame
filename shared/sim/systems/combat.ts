import { MOBS } from '../../data/mobs';
import { WEAPONS, weaponDamage, weaponRate, type WeaponDef } from '../../data/weapons';
import { COMBAT, PLAYER } from '../constants';
import { distance, distanceSq, normalize } from '../math';
import { grantXp, nextFloat } from '../progression';
import type { Mob, Player, Vec2, World } from '../types';

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
  incoming: Map<number, number>,
  taken: Set<number>,
): Mob | null {
  const rangeSq = def.range * def.range;
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
      key = lineScore(world, player.pos, mob.pos, def.range, def.pierce + 1) + near;
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

/** Weapons fire themselves — the player only ever chooses where to stand. */
export function stepWeapons(world: World, player: Player, dt: number): void {
  if (player.downed > 0) return;

  const incoming = incomingDamage(world);

  for (const weapon of player.weapons) {
    const def = WEAPONS[weapon.id];
    weapon.cooldown -= dt;
    if (weapon.cooldown > 0) continue;

    const damage = weaponDamage(weapon.id, weapon.level) * player.stats.damage;
    const shots = 1 + player.stats.multishot;
    const taken = new Set<number>();
    const targets: Mob[] = [];
    for (let i = 0; i < shots; i++) {
      const target = pickTarget(world, player, def, incoming, taken);
      if (!target) break;
      targets.push(target);
      taken.add(target.id);
      incoming.set(target.id, (incoming.get(target.id) ?? 0) + damage);
    }

    // Everything in range is already as good as dead: keep firing at the
    // nearest anyway, since a mob that dodges the shots in flight survives them.
    if (targets.length === 0) {
      const fallback = nearestMob(world, player, def.range);
      if (fallback) targets.push(fallback);
    }

    if (targets.length === 0) {
      // Idle weapons sit ready rather than banking cooldown.
      weapon.cooldown = 0;
      continue;
    }

    const rate = weaponRate(weapon.id, weapon.level) * player.stats.fireRate;
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
      world.projectiles.push({
        id: world.nextId++,
        pos: { ...player.pos },
        vel: {
          x: (base.x * cos - base.y * sin) * def.speed,
          y: (base.x * sin + base.y * cos) * def.speed,
        },
        damage,
        life: COMBAT.projectileLife,
        ownerId: player.id,
        weapon: weapon.id,
        pierce: def.pierce,
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

    if (!consumed) {
      for (const mob of world.mobs) {
        if (mob.hp <= 0) continue;
        const def = MOBS[mob.type];
        if (distance(mob.pos, p.pos) > def.radius + 4) continue;

        damageMob(world, mob, p.damage, p.ownerId);
        // Whatever it hits, it is no longer on its way to its target.
        p.targetId = undefined;
        if (p.pierce > 0) p.pierce -= 1;
        else consumed = true;
        break;
      }
    }

    if (consumed) world.projectiles.splice(i, 1);
  }
}

export function damageMob(world: World, mob: Mob, amount: number, sourceId: number): void {
  mob.hp -= amount;
  mob.hitFlash = 0.12;
  world.events.push({ kind: 'hit', pos: { ...mob.pos }, amount: Math.round(amount) });

  if (mob.hp > 0) return;

  const def = MOBS[mob.type];
  world.events.push({ kind: 'mobDied', pos: { ...mob.pos }, type: mob.type });

  const killer = world.players.get(sourceId);
  if (killer) grantXp(world, killer, def.xp);

  // Orbs the killer still has to walk over — movement stays the main verb.
  const orbs = 1 + Math.floor(nextFloat(world) * 2);
  for (let i = 0; i < orbs; i++) {
    world.pickups.push({
      id: world.nextId++,
      pos: { ...mob.pos },
      vel: { x: (nextFloat(world) - 0.5) * 140, y: (nextFloat(world) - 0.5) * 140 },
      item: nextFloat(world) < 0.25 ? 'essence' : null,
      count: 1,
      xp: 0,
      settle: 0.3,
    });
  }
}

export function damagePlayer(world: World, player: Player, amount: number): void {
  if (player.invuln > 0 || player.downed > 0) return;

  player.hp -= amount;
  player.invuln = PLAYER.invulnAfterHit;
  player.hitFlash = 0.18;
  world.events.push({ kind: 'playerHit', playerId: player.id, amount });

  if (player.hp <= 0) {
    player.hp = 0;
    player.downed = PLAYER.reviveSeconds;
    world.events.push({ kind: 'downed', playerId: player.id });
  }
}
