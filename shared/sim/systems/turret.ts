import { TURRET } from '../../data/machines';
import { MOBS } from '../../data/mobs';
import { tileCenter } from '../grid';
import { distanceSq } from '../math';
import type { ResearchBonuses } from '../research';
import { countIn, takeFromSlots } from '../slots';
import type { Machine, Mob, World } from '../types';
import { leadAim } from './combat';

/** The item a turret fires; the only thing it takes from a belt or an arm. */
export const TURRET_AMMO = 'rounds';

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
  const loaded = countIn(machine.input, TURRET_AMMO) > 0;
  // Stalled means out of rounds, which is the one thing a player can fix.
  machine.stalled = !loaded;
  if (!loaded || machine.progress > 0) return;

  const target = turretTarget(world, machine);
  if (!target) return;

  takeFromSlots(machine.input, TURRET_AMMO, 1);
  machine.progress = 1 / TURRET.rate;
  const at = tileCenter(machine.tx, machine.ty);
  const aim = leadAim(at, target, TURRET.speed);
  world.events.push({ kind: 'shot', pos: { ...at }, weapon: 'sling' });
  world.projectiles.push({
    id: world.nextId++,
    pos: { ...at },
    vel: { x: aim.x * TURRET.speed, y: aim.y * TURRET.speed },
    damage: TURRET.damage * bonus.damage,
    // Long enough to cross its whole range and a little past it.
    life: (TURRET.range * 1.3) / TURRET.speed,
    // A machine's id, not a player's: a turret's kill drops its orbs for
    // whoever walks over them, but grants nobody its XP directly.
    ownerId: machine.id,
    weapon: 'sling',
    pierce: 0,
    targetId: target.id,
  });
}
