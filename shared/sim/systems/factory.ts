import type { MachineDef } from '../../data/machines';
import { BELT_CAPACITY, BELT_ITEM_GAP, BELT_SPEED, MACHINES } from '../../data/machines';
import type { Recipe } from '../../data/recipes';
import { RECIPE_BY_ID, craftTime } from '../../data/recipes';
import { beltAt, machineAt, outputTile } from '../factory';
import { oreAt } from '../ore';
import { addToSlots, countIn, roomFor, slotCap, takeFromSlots } from '../slots';
import type { Belt, ItemId, ItemStack, Machine, Slot, World } from '../types';

/**
 * Belts advance items toward their output end. Items are kept ordered
 * front-to-back so each one only has to check the item ahead of it, which keeps
 * the whole belt O(items) rather than O(items²).
 */
export function stepBelts(world: World, dt: number): void {
  const travel = BELT_SPEED * dt;

  for (const belt of world.belts) {
    for (let i = 0; i < belt.items.length; i++) {
      const item = belt.items[i];
      // The item ahead sets the ceiling; the front item may leave the belt.
      const ceiling = i === 0 ? 1 : belt.items[i - 1].offset - BELT_ITEM_GAP;
      item.offset = Math.min(item.offset + travel, Math.max(0, ceiling));
    }

    const front = belt.items[0];
    if (!front || front.offset < 1) continue;
    if (handoff(world, belt, front.item)) belt.items.shift();
  }
}

/** Move the front item off this belt into whatever sits at its output tile. */
function handoff(world: World, belt: Belt, item: ItemId): boolean {
  const { tx, ty } = outputTile(belt);

  const nextBelt = beltAt(world, tx, ty);
  if (nextBelt) {
    // A belt feeding directly back into this one would deadlock; refuse it.
    const back = outputTile(nextBelt);
    if (back.tx === belt.tx && back.ty === belt.ty) return false;
    return pushOntoBelt(nextBelt, item);
  }

  const machine = machineAt(world, tx, ty);
  if (machine) return insertIntoMachine(machine, item);

  return false;
}

/** Add an item at the back of a belt if there is room for it. */
export function pushOntoBelt(belt: Belt, item: ItemId): boolean {
  if (belt.items.length >= BELT_CAPACITY) return false;

  const last = belt.items[belt.items.length - 1];
  // The back of the belt must be clear enough to fit another item.
  if (last && last.offset < BELT_ITEM_GAP) return false;

  belt.items.push({ item, offset: 0 });
  return true;
}

/** Accept an item into a machine's input, respecting its recipe and slots. */
export function insertIntoMachine(machine: Machine, item: ItemId): boolean {
  const def = MACHINES[machine.type];
  if (def.inputSlots === 0) return false;

  // A machine only takes what its recipe actually uses; a chest takes anything.
  if (def.choosesRecipe) {
    const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
    if (!recipe || !recipe.inputs.some((i) => i.id === item)) return false;
    if (!ingredientFits(machine.input, def, recipe, item)) return false;
  }

  return addToSlots(machine.input, item, 1, def.slotSize) === 1;
}

/**
 * Every ingredient of a recipe has to keep a slot of its own. One belt carrying
 * two ingredients delivers them in whatever order they arrive, and without this
 * the first to turn up fills the whole input grid — the machine then waits
 * forever for a second ingredient that can no longer get in, and only a hand
 * reaching in unjams it.
 */
function ingredientFits(input: Slot[], def: MachineDef, recipe: Recipe, item: ItemId): boolean {
  const cap = slotCap(item, def.slotSize);
  let owned = 0;
  let free = 0;

  for (const slot of input) {
    if (slot === null) free++;
    else if (slot.id === item) {
      // Room in a stack this ingredient already owns costs no new slot.
      if (slot.count < cap) return true;
      owned++;
    }
  }

  if (free === 0) return false;
  return owned < Math.max(1, Math.floor(def.inputSlots / recipe.inputs.length));
}

export function stepMachines(world: World, dt: number): void {
  for (const machine of world.machines) {
    switch (machine.type) {
      case 'miner':
        stepMiner(world, machine, dt);
        break;
      case 'chest':
        // Chests only receive; nothing to tick.
        machine.stalled = false;
        break;
      default:
        stepCrafter(machine, dt);
        break;
    }
    pushMachineOutput(world, machine);
  }
}

/** Seconds a miner takes to extract one ore. */
const MINE_TIME = 1.2;

function stepMiner(world: World, machine: Machine, dt: number): void {
  const ore = oreAt(world.ore, machine.tx, machine.ty);
  if (!ore) {
    machine.stalled = true;
    return;
  }

  const def = MACHINES.miner;
  if (roomFor(machine.output, ore, def.slotSize) < 1) {
    machine.stalled = true;
    return;
  }

  machine.stalled = false;
  machine.progress += dt * def.speed;
  if (machine.progress < MINE_TIME) return;

  machine.progress -= MINE_TIME;
  addToSlots(machine.output, ore, 1, def.slotSize);
}

function stepCrafter(machine: Machine, dt: number): void {
  const def = MACHINES[machine.type];
  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  if (!recipe) {
    machine.stalled = true;
    return;
  }

  const duration = craftTime(recipe, def.speed);

  // Only consume inputs once, at the moment a craft starts.
  if (machine.progress === 0) {
    if (!hasInputs(machine.input, recipe.inputs) || outputFull(machine, def.slotSize)) {
      machine.stalled = true;
      return;
    }
    for (const input of recipe.inputs) takeStack(machine.input, input.id, input.count);
  }

  machine.stalled = false;
  machine.progress += dt;
  if (machine.progress < duration) return;

  machine.progress = 0;
  for (const out of recipe.outputs) addToSlots(machine.output, out.id, out.count, def.slotSize);
}

function outputFull(machine: Machine, slotSize: number): boolean {
  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  if (!recipe) return true;

  // A craft is all-or-nothing, so every output has to have somewhere to land
  // before the inputs are consumed.
  return recipe.outputs.some((out) => roomFor(machine.output, out.id, slotSize) < out.count);
}

/** Feed finished goods onto the belt or machine the output side faces. */
function pushMachineOutput(world: World, machine: Machine): void {
  let first: ItemStack | null = null;
  for (const slot of machine.output) {
    if (slot && slot.count > 0) {
      first = slot;
      break;
    }
  }
  if (!first) return;

  const { tx, ty } = outputTile(machine);

  const belt = beltAt(world, tx, ty);
  if (belt) {
    if (pushOntoBelt(belt, first.id)) takeStack(machine.output, first.id, 1);
    return;
  }

  const target = machineAt(world, tx, ty);
  if (target && insertIntoMachine(target, first.id)) {
    takeStack(machine.output, first.id, 1);
  }
}

export function hasInputs(have: Slot[], need: ItemStack[]): boolean {
  return need.every((n) => countIn(have, n.id) >= n.count);
}

/** Take a whole amount, or nothing at all. */
export function takeStack(slots: Slot[], id: ItemId, count: number): boolean {
  if (countIn(slots, id) < count) return false;
  takeFromSlots(slots, id, count);
  return true;
}
