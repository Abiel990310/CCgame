import { CYCLE, PLAYER, WAVES } from '../constants';
import { researchBonuses } from '../research';
import { spawnPoint } from '../world';
import type { World } from '../types';
import { nightBudget, spawnBosses } from './mobs';

/** Day ⇄ night, plus the per-player upkeep that rides on the clock. */
export function stepCycle(world: World, dt: number): void {
  world.phaseTime -= dt;
  if (world.phaseTime > 0) return;

  if (world.phase === 'day') {
    world.phase = 'night';
    world.nightIndex += 1;
    world.phaseTime = CYCLE.nightSeconds;
    // A peaceful world still has nights; they are just quiet ones.
    world.waveBudget = world.peaceful ? 0 : nightBudget(world);
    world.wavePulse = 0.5;
    if (!world.peaceful) spawnBosses(world);
  } else {
    world.phase = 'day';
    world.phaseTime = CYCLE.daySeconds;
    world.waveBudget = 0;
    // Dawn clears the field: no leftovers chasing you through a chill phase.
    // A landmark's keepers are not raiders and stay at their post.
    world.mobs = world.mobs.filter((m) => m.post);
    // The camp patches its guns overnight's damage by morning, so a wrecked
    // turret costs a night's cover, never the turret.
    for (const machine of world.machines) delete machine.wear;
  }

  world.events.push({ kind: 'phase', phase: world.phase, nightIndex: world.nightIndex });
}

export function stepPlayerUpkeep(world: World, dt: number): void {
  const health = researchBonuses(world).health;
  for (const player of world.players.values()) {
    // `stats.maxHp` is what level-ups built; research stacks on top of it. A
    // gain heals by the same amount, as a level-up's does, so a tech finishing
    // is never a wasted bar; a loss only trims what is above the new cap.
    const max = Math.round(player.stats.maxHp * health);
    if (max !== player.maxHp) {
      if (max > player.maxHp && player.downed <= 0) player.hp += max - player.maxHp;
      player.maxHp = max;
      player.hp = Math.min(player.hp, max);
    }

    if (player.downed > 0) {
      player.downed -= dt;
      if (player.downed <= 0) {
        player.downed = 0;
        // Being downed costs you time and position, never progress.
        player.hp = Math.max(1, Math.round(player.maxHp * 0.5));
        player.invuln = 2;
        const spawn = spawnPoint(world);
        player.pos.x = spawn.x;
        player.pos.y = spawn.y;
      }
      continue;
    }

    if (player.stats.regen > 0 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + player.stats.regen * dt);
    }
    // A slow out-of-combat trickle during the day, so chill really is chill.
    if (world.phase === 'day' && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + PLAYER.maxHp * 0.02 * dt);
    }
  }
}

export const NIGHT_PULSE_INTERVAL = WAVES.pulseInterval;
