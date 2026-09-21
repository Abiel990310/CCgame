import { CYCLE, PLAYER, WAVES } from '../constants';
import { spawnPoint } from '../world';
import type { World } from '../types';
import { nightBudget } from './mobs';

/** Day ⇄ night, plus the per-player upkeep that rides on the clock. */
export function stepCycle(world: World, dt: number): void {
  world.phaseTime -= dt;
  if (world.phaseTime > 0) return;

  if (world.phase === 'day') {
    world.phase = 'night';
    world.nightIndex += 1;
    world.phaseTime = CYCLE.nightSeconds;
    world.waveBudget = nightBudget(world);
    world.wavePulse = 0.5;
  } else {
    world.phase = 'day';
    world.phaseTime = CYCLE.daySeconds;
    world.waveBudget = 0;
    // Dawn clears the field: no leftovers chasing you through a chill phase.
    world.mobs.length = 0;
  }

  world.events.push({ kind: 'phase', phase: world.phase, nightIndex: world.nightIndex });
}

export function stepPlayerUpkeep(world: World, dt: number): void {
  for (const player of world.players.values()) {
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
