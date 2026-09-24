import { GOALS } from '../data/goals';
import { grantXp } from './progression';
import type { Player, World } from './types';

/** Goals are state checks that scan the factory, so once a second is plenty. */
const GOAL_CHECK_TICKS = 30;

/** Advance past rows this island cannot reach, such as ones for raids. */
function skipInapplicable(world: World, player: Player): void {
  while (player.goal < GOALS.length && GOALS[player.goal].skip?.(world)) player.goal += 1;
}

export function stepGoals(world: World): void {
  if (world.tick % GOAL_CHECK_TICKS !== 0) return;
  for (const player of world.players.values()) {
    skipInapplicable(world, player);
    const goal = GOALS[player.goal];
    if (!goal || goal.have(world, player) < goal.need) continue;
    player.goal += 1;
    skipInapplicable(world, player);
    world.events.push({
      kind: 'goal',
      playerId: player.id,
      goal: goal.id,
      next: GOALS[player.goal]?.id ?? null,
    });
    grantXp(world, player, goal.xp);
  }
}

/**
 * An island from before goals existed starts its player at the first row it
 * has not already passed, silently: someone with a running factory should not
 * be told to go and chop wood, nor be paid for goals met long ago.
 */
export function catchUpGoals(world: World, player: Player): void {
  player.goal = 0;
  skipInapplicable(world, player);
  while (player.goal < GOALS.length && GOALS[player.goal].have(world, player) >= GOALS[player.goal].need) {
    player.goal += 1;
    skipInapplicable(world, player);
  }
}
