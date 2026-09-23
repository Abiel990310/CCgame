import { MOBS } from '../../data/mobs';
import { WEAPONS, weaponDamage, weaponRate } from '../../data/weapons';
import { COMBAT, PLAYER } from '../constants';
import { distance, distanceSq, normalize } from '../math';
import { grantXp, nextFloat } from '../progression';
import type { Mob, Player, World } from '../types';

function nearestMob(world: World, player: Player, range: number): Mob | null {
  let best: Mob | null = null;
  let bestDist = range * range;
  for (const mob of world.mobs) {
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

  for (const weapon of player.weapons) {
    const def = WEAPONS[weapon.id];
    weapon.cooldown -= dt;
    if (weapon.cooldown > 0) continue;

    const target = nearestMob(world, player, def.range);
    if (!target) {
      // Idle weapons sit ready rather than banking cooldown.
      weapon.cooldown = 0;
      continue;
    }

    const rate = weaponRate(weapon.id, weapon.level) * player.stats.fireRate;
    weapon.cooldown = 1 / Math.max(0.05, rate);

    const damage = weaponDamage(weapon.id, weapon.level) * player.stats.damage;
    const shots = 1 + player.stats.multishot;
    const base = normalize({ x: target.pos.x - player.pos.x, y: target.pos.y - player.pos.y });
    const spread = shots > 1 ? 0.22 : 0;

    // One event per volley, not per projectile: multishot is one bowstring.
    world.events.push({ kind: 'shot', pos: { ...player.pos }, weapon: weapon.id });

    for (let i = 0; i < shots; i++) {
      const offset = shots > 1 ? (i - (shots - 1) / 2) * spread : 0;
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
