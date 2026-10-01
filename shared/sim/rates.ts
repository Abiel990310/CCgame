import { MACHINES, TRAP_TIME } from '../data/machines';
import { RESOURCES } from '../data/items';
import { RECIPE_BY_ID, craftTime, type Recipe } from '../data/recipes';
import { withBeacon } from './beacon';
import { TICK_DT } from './constants';
import { moduleEffects } from './modules';
import { powerFactor } from './power';
import { activeTech, researchBonuses } from './research';
import { MINE_TIME } from './systems/factory';
import type { ItemId, Machine, World } from './types';

/**
 * How long a machine really takes, with research, a burning beacon and its
 * modules applied. The machine steps scale how fast progress climbs rather than
 * the length of a craft, so the number a player wants (seconds per craft, items
 * per minute) is only ever derived, here, from the same factors the step reads.
 * Power is left out: a brown-out comes and goes, and `machineRates` applies it.
 */
export function workSpeed(world: World, machine: Machine): number {
  const def = MACHINES[machine.type];
  const bonus = withBeacon(world, researchBonuses(world));
  const modules = moduleEffects(machine);
  return (def.family === 'miner' ? bonus.mining : bonus.crafting) * modules.speed;
}

/**
 * Seconds one craft of `recipe` takes in `machine` as it stands. A craft ends
 * on the tick its progress passes the recipe time and the spill-over is
 * dropped, so a short craft on a fast machine takes a whole number of ticks
 * rather than its nominal time: 0.2s of work is really seven ticks, 0.23s.
 * `power` is the share of full pace a brown-out leaves it.
 */
export function recipeSeconds(world: World, machine: Machine, recipe: Recipe, power = 1): number {
  const duration = craftTime(recipe, MACHINES[machine.type].speed);
  const bonus = withBeacon(world, researchBonuses(world));
  // Added up tick by tick, in the step's own order of multiplying, because a
  // craft that should land exactly on a tick lands on one side of it by float
  // error and only the same arithmetic knows which.
  const perTick = TICK_DT * power * bonus.crafting * moduleEffects(machine).speed;
  let progress = 0;
  let ticks = 0;
  do {
    progress += perTick;
    ticks++;
  } while (progress < duration && ticks < MAX_TICKS);
  return ticks * TICK_DT;
}

/** A craft this long is not a number worth quoting to the tick. */
const MAX_TICKS = 100_000;

/** Seconds a miner takes to bring up one ore as it stands. */
export function mineSeconds(world: World, machine: Machine): number {
  return MINE_TIME / (MACHINES[machine.type].speed * workSpeed(world, machine));
}

export interface MachineRate {
  item: ItemId;
  /** Items per minute at the pace the machine is going right now, power included. */
  perMinute: number;
}

/**
 * What a working machine puts out per minute: the units the production ledger
 * counts in, so a card and the ledger can be read against each other. It is
 * the pace while it has input and room, not what it is managing this second.
 */
export function machineRates(world: World, machine: Machine): MachineRate[] {
  const def = MACHINES[machine.type];
  // An output module's free crafts are paid out on average, so they count.
  const yieldShare = 1 + moduleEffects(machine).output;
  const power = powerFactor(world, machine);
  if (power <= 0) return [];
  const pace = 60 * yieldShare;
  if (def.family === 'miner') {
    return machine.ore ? [{ item: machine.ore, perMinute: (pace * power) / mineSeconds(world, machine) }] : [];
  }
  if (def.family === 'fishTrap') {
    // The expected catch: one roll every TRAP_TIME, split by the table's
    // weights, so the card quotes the average and not any one lucky minute.
    const { drops } = RESOURCES.fish;
    const total = drops.reduce((sum, d) => sum + d.weight, 0);
    const rolls = (pace * def.speed) / TRAP_TIME;
    return drops.map((d) => ({ item: d.item, perMinute: (rolls * d.count * d.weight) / total }));
  }
  const recipe = def.choosesRecipe && machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  if (!recipe) return [];
  const seconds = recipeSeconds(world, machine, recipe, power);
  return recipe.outputs.map((out) => ({ item: out.id, perMinute: (pace * out.count) / seconds }));
}

/**
 * Research cycles a lab finishes per minute on the island's current tech, or
 * null when it has nothing to work on. A lab makes no item, so it has no row in
 * `machineRates`; this is its rate in the unit that matters, a cycle.
 */
export function labCyclesPerMinute(world: World, machine: Machine): number | null {
  const def = MACHINES[machine.type];
  const tech = activeTech(world);
  if (def.family !== 'lab' || !tech) return null;
  const bonus = withBeacon(world, researchBonuses(world));
  return (60 * def.speed * bonus.lab) / tech.time;
}
