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

/**
 * The chain as it stood while saves still kept a goal as its place in the
 * list. Frozen: an island saved then is read against this order, whatever
 * rows have been added to the chain since.
 */
const LEGACY_ORDER = [
  'wood', 'stone', 'miner', 'belt', 'furnace', 'ironPlate', 'store', 'copperPlate', 'gear', 'researchPack',
  'lab', 'research', 'circuit', 'tier2', 'steel', 'logicPack', 'electricity', 'engine', 'powered',
  'engineeringPack', 'processor', 'beacon', 'beaconLit',
];

/** Marks the whole chain done, in a save. */
const CHAIN_DONE = 'done';

/**
 * What a save keeps of a player's place in the chain: the id of the goal they
 * are on, so a row added mid-chain later neither skips anyone past it nor
 * pays them again for goals they already met.
 */
export function goalMarker(player: Player): string {
  return GOALS[player.goal]?.id ?? CHAIN_DONE;
}

/**
 * Put a loaded player back on their goal: by id, or for an island saved
 * before ids by its old place in the chain. Anything unreadable starts them at
 * the first goal they have not met, silently.
 */
export function restoreGoal(world: World, player: Player, marker: unknown): void {
  const id =
    typeof marker === 'string' ? marker
    : typeof marker === 'number' && Number.isInteger(marker) && marker >= 0 ? (LEGACY_ORDER[marker] ?? CHAIN_DONE)
    : null;
  const at = id === CHAIN_DONE ? GOALS.length : id ? GOALS.findIndex((g) => g.id === id) : -1;
  if (at < 0) catchUpGoals(world, player);
  else player.goal = at;
}
