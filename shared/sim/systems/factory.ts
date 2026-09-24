import type { MachineDef } from '../../data/machines';
import {
  BELT_CAPACITY,
  BELT_ITEM_GAP,
  BELT_SPEED,
  INSERTER_SWING,
  MACHINES,
} from '../../data/machines';
import type { Recipe } from '../../data/recipes';
import { RECIPE_BY_ID, craftTime } from '../../data/recipes';
import {
  beltAt,
  filterOf,
  inputTile,
  isSplitter,
  machineAt,
  outputTile,
  sideTiles,
  splitterAccepts,
} from '../factory';
import { tileCenter } from '../grid';
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

  // An inserter's input slot is its hand, not a hopper: it fills that itself
  // from the tile behind it. Refusing here is also what stops two inserters
  // facing each other from passing one item back and forth forever.
  if (def.family === 'inserter') return false;

  // A splitter with both sides filtered is a sorter: what it cannot route it
  // never takes, so the rest of the line still gets it.
  if (def.family === 'splitter' && !splitterAccepts(machine, item)) return false;

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
    // Dispatch on the family, not the type: a steel furnace is a furnace that
    // runs faster, and every tier added later should stay that cheap.
    switch (MACHINES[machine.type].family) {
      case 'miner':
        stepMiner(world, machine, dt);
        break;
      case 'chest':
        // Chests only receive; nothing to tick.
        machine.stalled = false;
        break;
      case 'inserter':
        stepInserter(world, machine, dt);
        break;
      case 'splitter':
        stepSplitter(world, machine);
        break;
      default:
        stepCrafter(world, machine, dt);
        break;
    }
    pushMachineOutput(world, machine);
  }
}

/** Seconds a tier 1 miner takes to extract one ore; speed divides it. */
export const MINE_TIME = 1.2;

function stepMiner(world: World, machine: Machine, dt: number): void {
  const ore = oreAt(world.ore, machine.tx, machine.ty);
  if (!ore) {
    machine.stalled = true;
    return;
  }

  const def = MACHINES[machine.type];
  if (roomFor(machine.output, ore, def.slotSize) < 1) {
    machine.stalled = true;
    return;
  }

  machine.stalled = false;
  machine.progress += dt * def.speed;
  if (machine.progress < MINE_TIME) return;

  machine.progress -= MINE_TIME;
  addToSlots(machine.output, ore, 1, def.slotSize);
  announce(world, machine, ore);
}

/**
 * Tell the client one item came out of this machine. Positions are the tile
 * centre rather than the machine, so a listener can place the sound without
 * needing the grid.
 */
function announce(world: World, machine: Machine, item: ItemId): void {
  world.events.push({
    kind: 'produced',
    pos: tileCenter(machine.tx, machine.ty),
    machine: machine.type,
    item,
  });
}

/**
 * An inserter reaches into the tile behind it, swings, and lets go into the
 * tile it faces. It is the only thing that can take items back out of a chest,
 * so without one a chest is where a production line stops.
 *
 * The item is picked up first and held in the single input slot, so a blocked
 * destination stalls an inserter with its hand full rather than quietly
 * dropping what it grabbed.
 */
function stepInserter(world: World, machine: Machine, dt: number): void {
  const def = MACHINES[machine.type];

  if (machine.input[0] === null) {
    const grabbed = grabFromBehind(world, machine, def.reach);
    if (grabbed === null) {
      // Nothing within reach is idle, not stalled — a red light on every
      // inserter waiting on a slow line would drown out real blockages.
      machine.progress = 0;
      machine.stalled = false;
      return;
    }
    machine.input[0] = { id: grabbed, count: 1 };
  }

  machine.stalled = false;
  machine.progress = Math.min(machine.progress + dt * def.speed, INSERTER_SWING);
  if (machine.progress < INSERTER_SWING) return;

  const hand = machine.input[0];
  if (!hand || !dropInFront(world, machine, hand.id, def.reach)) {
    // Arm extended over a full destination: hold the item and show it.
    machine.stalled = true;
    return;
  }

  machine.input[0] = null;
  machine.progress = 0;
}

/**
 * Take one item out of whatever sits behind the inserter, `reach` tiles back.
 * A filtered arm takes only what it is set to and leaves the rest where it is,
 * which is what lets one mixed chest or one shared belt feed several lines.
 */
function grabFromBehind(world: World, machine: Machine, reach: number): ItemId | null {
  const { tx, ty } = inputTile(machine, reach);

  const belt = beltAt(world, tx, ty);
  if (belt) {
    // The item nearest the belt's output end is the one within reach. A
    // filtered arm does not dig past it: anything else keeps riding by.
    const front = belt.items[0];
    if (!front || !wanted(machine, front.item)) return null;
    belt.items.shift();
    return front.item;
  }

  const source = machineAt(world, tx, ty);
  if (!source || MACHINES[source.type].family === 'inserter') return null;

  // A machine with an output side gives from there and nowhere else, so an
  // inserter cannot steal the ore a furnace is waiting to smelt. A chest has
  // no output side, and its storage is exactly what wants emptying.
  const from = MACHINES[source.type].outputSlots > 0 ? source.output : source.input;

  for (const slot of from) {
    if (slot && slot.count > 0 && wanted(machine, slot.id)) {
      takeStack(from, slot.id, 1);
      return slot.id;
    }
  }
  return null;
}

/** An unfiltered inserter moves anything; a filtered one moves its one item. */
function wanted(machine: Machine, item: ItemId): boolean {
  return machine.filter === null || machine.filter === item;
}

/** Put the held item into the belt or machine the inserter faces. */
function dropInFront(world: World, machine: Machine, item: ItemId, reach: number): boolean {
  const { tx, ty } = outputTile(machine, reach);

  const belt = beltAt(world, tx, ty);
  if (belt) return pushOntoBelt(belt, item);

  const target = machineAt(world, tx, ty);
  return target ? insertIntoMachine(target, item) : false;
}

/**
 * A splitter empties its buffer into the two tiles either side of it, offering
 * each item to the side whose turn it is and handing it to the other when that
 * one will not take it. The turn only advances on a side that actually took
 * something, so a blocked or filtered-out side never costs the line a slot in
 * the rotation.
 *
 * It moves as much as it can in a tick rather than on a timer: a splitter that
 * metered items would throttle every line it sat on, and the belts it feeds
 * already refuse items faster than they can carry them.
 */
function stepSplitter(world: World, machine: Machine): void {
  machine.stalled = false;

  for (let guard = 0; guard < MACHINES.splitter.slotSize; guard++) {
    const slot = machine.input.find((s): s is ItemStack => s !== null && s.count > 0);
    if (!slot) return;

    if (!offerToSides(world, machine, slot.id)) {
      // Holding something neither side will take is what a jam looks like.
      machine.stalled = true;
      return;
    }
    takeStack(machine.input, slot.id, 1);
  }
}

/** Try the side whose turn it is, then the other. */
function offerToSides(world: World, machine: Machine, item: ItemId): boolean {
  const sides = sideTiles(machine);
  const first = machine.turn === 1 ? 1 : 0;

  for (let i = 0; i < sides.length; i++) {
    const side = (first + i) % sides.length;
    const filter = filterOf(machine, side);
    if (filter !== null && filter !== item) continue;
    if (!giveToTile(world, machine, sides[side], item)) continue;

    machine.turn = (side + 1) % sides.length;
    return true;
  }
  return false;
}

/** Hand one item to whatever sits on a tile, refusing anything that feeds back. */
function giveToTile(
  world: World,
  machine: Machine,
  tile: { tx: number; ty: number },
  item: ItemId,
): boolean {
  const belt = beltAt(world, tile.tx, tile.ty);
  if (belt) {
    // A belt pointing back at the splitter would bounce the item forever.
    const back = outputTile(belt);
    if (back.tx === machine.tx && back.ty === machine.ty) return false;
    return pushOntoBelt(belt, item);
  }

  const target = machineAt(world, tile.tx, tile.ty);
  if (!target) return false;
  // Two splitters aimed at each other would pass the same item back and forth.
  if (isSplitter(target) && facesBack(target, machine)) return false;
  return insertIntoMachine(target, item);
}

function facesBack(splitter: Machine, at: Machine): boolean {
  return sideTiles(splitter).some((t) => t.tx === at.tx && t.ty === at.ty);
}

function stepCrafter(world: World, machine: Machine, dt: number): void {
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
  for (const out of recipe.outputs) {
    addToSlots(machine.output, out.id, out.count, def.slotSize);
    announce(world, machine, out.id);
  }
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
