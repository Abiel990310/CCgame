import { TURRET, TURRET_AMMO, TURRET_AMMO_ORDER } from '../../data/machines';
import { MOBS } from '../../data/mobs';
import { tileCenter } from '../grid';
import { distanceSq } from '../math';
import type { ResearchBonuses } from '../research';
import { countIn, takeFromSlots } from '../slots';
import type { ItemId, Machine, Mob, TurretAmmo, World } from '../types';
import { leadAim } from './combat';

/** True for the rounds a turret fires, the only things it takes from a belt or an arm. */
export function isTurretAmmo(item: ItemId): item is TurretAmmo {
  return item in TURRET_AMMO;
}

/** The best round the turret holds, or null when it is empty. */
export function loadedAmmo(machine: Machine): TurretAmmo | null {
  return TURRET_AMMO_ORDER.find((id) => countIn(machine.input, id) > 0) ?? null;
}

/** The closest living creature a turret at `at` can reach, or null. */
export function turretTarget(world: World, machine: Machine): Mob | null {
  const at = tileCenter(machine.tx, machine.ty);
  let best: Mob | null = null;
  let bestDist = Infinity;
  for (const mob of world.mobs) {
    if (mob.hp <= 0) continue;
    const reach = TURRET.range + MOBS[mob.type].radius;
    const d = distanceSq(mob.pos, at);
    if (d <= reach * reach && d < bestDist) {
      best = mob;
      bestDist = d;
    }
  }
  return best;
}

/**
 * One round per shot at the nearest creature, led the way a thrown weapon is.
 * `progress` is the time left until it can fire again, so a turret with a
 * target never waits longer than its rate says, and one without banks nothing.
 */
export function stepTurret(world: World, machine: Machine, dt: number, bonus: ResearchBonuses): void {
  machine.progress = Math.max(0, machine.progress - dt);
  const ammo = loadedAmmo(machine);
  // Stalled means out of rounds, which is the one thing a player can fix.
  machine.stalled = !ammo;
  if (!ammo || machine.progress > 0) return;

  const target = turretTarget(world, machine);
  if (!target) return;

  takeFromSlots(machine.input, ammo, 1);
  const round = TURRET_AMMO[ammo];
  machine.progress = 1 / TURRET.rate;
  const at = tileCenter(machine.tx, machine.ty);
  const aim = leadAim(at, target, TURRET.speed);
  world.events.push({ kind: 'turretShot', pos: { ...at }, ammo });
  world.projectiles.push({
    id: world.nextId++,
    pos: { ...at },
    vel: { x: aim.x * TURRET.speed, y: aim.y * TURRET.speed },
    damage: round.damage * bonus.damage,
    // Long enough to cross its whole range and a little past it.
    life: (TURRET.range * 1.3) / TURRET.speed,
    // A machine's id, not a player's: a turret's kill drops its orbs for
    // whoever walks over them, but grants nobody its XP directly.
    ownerId: machine.id,
    // Drawn as the sling's pellet or the bow's bolt, which is what each round looks like.
    weapon: ammo === 'steelRounds' ? 'bow' : 'sling',
    pierce: round.pierce,
    targetId: target.id,
  });
}
