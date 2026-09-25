import { insertIntoBeacon, stepBeacon } from '../beacon';
import type { MachineDef } from '../../data/machines';
import {
  BELT_CAPACITY,
  BELT_ITEM_GAP,
  BELT_SPEED,
  FUEL_RESERVE,
  FUEL_VALUE,
  INSERTER_SWING,
  MACHINES,
  TRAP_TIME,
  isFuel,
} from '../../data/machines';
import { RESOURCES } from '../../data/items';
import { RECIPE_BY_ID, craftTime } from '../../data/recipes';
import { RESEARCH_PACKS, TECH_BY_ID, isResearchPack } from '../../data/techs';
import {
  beltAt,
  filterOf,
  inputTile,
  isMerger,
  isSplitter,
  machineAt,
  mergerSources,
  outputTile,
  sideTiles,
  splitterAccepts,
} from '../factory';
import { tileCenter } from '../grid';
import { rollDrop } from './gathering';
import { minerSource, oreAt, takeOre } from '../ore';
import { powerFactor, powerNetOf } from '../power';
import { activeTech, finishCycle, researchBonuses, type ResearchBonuses } from '../research';
import { addToSlots, countIn, roomFor, slotCap, takeFromSlots } from '../slots';
import type { Belt, ItemId, ItemStack, Machine, Slot, World } from '../types';

/**
 * Belts advance items toward their output end. Items are kept ordered
 * front-to-back so each one only has to check the item ahead of it, which keeps
 * the whole belt O(items) rather than O(items²).
 */
export function stepBelts(world: World, dt: number): void {
  const travel = BELT_SPEED * researchBonuses(world).belt * dt;

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
  // A merger takes from the belts feeding it by turns. Letting them push would
  // hand the whole line to whichever belt happens to tick first.
  if (machine) return !isMerger(machine) && insertIntoMachine(machine, item);

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
  // A generator has no recipe, only a firebox.
  if (def.family === 'generator') {
    return !!machine.fuel && isFuel(item) && addToSlots(machine.fuel, item, 1, def.slotSize) === 1;
  }
  if (def.inputSlots === 0) return false;
  if (def.family === 'beacon') return insertIntoBeacon(machine, item, def.slotSize);

  // An inserter's input slot is its hand, not a hopper: it fills that itself
  // from the tile behind it. Refusing here is also what stops two inserters
  // facing each other from passing one item back and forth forever.
  if (def.family === 'inserter') return false;

  // A splitter with both sides filtered is a sorter: what it cannot route it
  // never takes, so the rest of the line still gets it.
  if (def.family === 'splitter' && !splitterAccepts(machine, item)) return false;
  // A lab takes research packs and nothing else, whatever is being researched
  // at this moment: a line is free to stockpile the packs the next tech will
  // want rather than backing up every time one finishes.
  if (def.family === 'lab') {
    if (!isResearchPack(item)) return false;
    if (!ingredientFits(machine.input, def, RESEARCH_PACKS.length, item)) return false;
    return addToSlots(machine.input, item, 1, def.slotSize) === 1;
  }

  // A machine only takes what its recipe actually uses; a chest takes anything.
  if (def.choosesRecipe) {
    const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
    const ingredient = !!recipe && recipe.inputs.some((i) => i.id === item);

    if (machine.fuel && isFuel(item)) {
      // Fuel comes first up to a small reserve, then the recipe gets its share,
      // then the fuel grid takes whatever is left: a steel furnace on one coal
      // belt keeps burning and keeps smelting.
      if (countIn(machine.fuel, item) < FUEL_RESERVE && addToSlots(machine.fuel, item, 1, def.slotSize) === 1) {
        return true;
      }
      if (ingredient && ingredientFits(machine.input, def, recipe.inputs.length, item)) {
        return addToSlots(machine.input, item, 1, def.slotSize) === 1;
      }
      return addToSlots(machine.fuel, item, 1, def.slotSize) === 1;
    }

    if (!recipe || !ingredient) return false;
    if (!ingredientFits(machine.input, def, recipe.inputs.length, item)) return false;
  }

  // A chest's filtered slots are kept for their own item, so a line that
  // fills a buffer with one thing still leaves room for what the next needs.
  const filters = def.family === 'chest' ? machine.filters : undefined;
  return addToSlots(machine.input, item, 1, def.slotSize, filters) === 1;
}

/**
 * Make sure a burner has heat for the work ahead, burning one item of fuel from
 * its grid when the last has run out. Machines with no fuel grid always can.
 */
function stoke(machine: Machine, fuelBonus = 1): boolean {
  if (!machine.fuel) return true;
  if ((machine.heat ?? 0) > 0) return true;

  for (const slot of machine.fuel) {
    const value = slot ? FUEL_VALUE[slot.id] ?? 0 : 0;
    if (slot && value > 0) {
      takeStack(machine.fuel, slot.id, 1);
      machine.heat = (machine.heat ?? 0) + value * fuelBonus;
      return true;
    }
  }
  return false;
}

/**
 * Every ingredient of a recipe has to keep a slot of its own. One belt carrying
 * two ingredients delivers them in whatever order they arrive, and without this
 * the first to turn up fills the whole input grid — the machine then waits
 * forever for a second ingredient that can no longer get in, and only a hand
 * reaching in unjams it.
 */
function ingredientFits(
  input: Slot[],
  def: MachineDef,
  ingredients: number,
  item: ItemId,
): boolean {
  return ingredientRoom(input, def, ingredients, item) > 0;
}

/**
 * How many more of one ingredient the input grid can take while every other
 * ingredient keeps its share: room in the stacks it already holds, plus the
 * new slots its share still allows.
 */
function ingredientRoom(
  input: Slot[],
  def: MachineDef,
  ingredients: number,
  item: ItemId,
): number {
  const cap = slotCap(item, def.slotSize);
  let owned = 0;
  let free = 0;
  let room = 0;

  for (const slot of input) {
    if (slot === null) free++;
    else if (slot.id === item) {
      owned++;
      room += Math.max(0, cap - slot.count);
    }
  }

  const share = Math.max(1, Math.floor(def.inputSlots / ingredients));
  return room + Math.min(free, Math.max(0, share - owned)) * cap;
}

/**
 * How many of an item a hand may load into a machine's input grid at once. A
 * shift-click is held to the same per-ingredient share a belt is, or one big
 * stack fills every slot and the recipe's other ingredient never gets in. A
 * single click on a chosen slot stays free: that player is arranging the grid
 * on purpose and can take it back out.
 */
export function handLoadRoom(machine: Machine, item: ItemId): number {
  const def = MACHINES[machine.type];
  if (def.family === 'lab') return ingredientRoom(machine.input, def, RESEARCH_PACKS.length, item);
  if (!def.choosesRecipe) return Infinity;
  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  if (!recipe) return Infinity;
  return ingredientRoom(machine.input, def, recipe.inputs.length, item);
}

export function stepMachines(world: World, dt: number): void {
  // Research multiplies what every machine on the island is worth, so the
  // bonuses are read once per tick rather than per machine.
  const bonus = researchBonuses(world);

  for (const machine of world.machines) {
    // An electric machine works at its network's pace, and not at all off one.
    // Scaling its time step is all it takes: every family below already
    // measures its work in seconds.
    let mdt = dt;
    if (MACHINES[machine.type].power) {
      const factor = powerFactor(world, machine);
      if (factor <= 0) {
        machine.stalled = true;
        machine.unpowered = true;
        pushMachineOutput(world, machine);
        continue;
      }
      if (machine.unpowered) delete machine.unpowered;
      mdt = dt * factor;
    }

    // Dispatch on the family, not the type: a steel furnace is a furnace that
    // runs faster, and every tier added later should stay that cheap.
    switch (MACHINES[machine.type].family) {
      case 'miner':
        stepMiner(world, machine, mdt, bonus);
        break;
      case 'chest':
        // Chests only receive; nothing to tick.
        machine.stalled = false;
        break;
      case 'inserter':
        stepInserter(world, machine, mdt, bonus);
        break;
      case 'lab':
        stepLab(world, machine, dt, bonus);
        break;
      case 'splitter':
        stepSplitter(world, machine);
        break;
      case 'merger':
        stepMerger(world, machine);
        break;
      case 'fishTrap':
        stepTrap(world, machine, dt);
        break;
      case 'generator':
      case 'solar':
        // `stepPower` runs generators on a network; one no pole reaches is idle.
        if (!powerNetOf(world, machine)) machine.stalled = true;
        break;
      case 'pole':
        machine.stalled = false;
        break;
      case 'beacon':
        stepBeacon(world, machine);
        break;
      default:
        stepCrafter(world, machine, mdt, bonus);
        break;
    }
    pushMachineOutput(world, machine);
  }
}

/**
 * Seconds a tier 1 miner takes to extract one ore; speed divides it. Exported
 * because the renderer's progress bar has to agree with it.
 */
export const MINE_TIME = 1.2;

/**
 * A miner works the ground it stands on and the ring around it, and the ore is
 * finite: it goes dark once everything in reach has been pulled up, which is
 * what eventually moves a factory out to a fresh patch.
 */
function stepMiner(world: World, machine: Machine, dt: number, bonus: ResearchBonuses): void {
  // Islands saved before ore ran out have miners that never recorded a kind.
  machine.ore ??= oreAt(world.ore, machine.tx, machine.ty);
  const ore = machine.ore;
  if (!ore) {
    machine.stalled = true;
    return;
  }

  const source = minerSource(world, machine, ore);
  if (!source) {
    machine.stalled = true;
    return;
  }

  const def = MACHINES[machine.type];
  if (roomFor(machine.output, ore, def.slotSize) < 1) {
    machine.stalled = true;
    return;
  }

  machine.stalled = false;
  machine.progress += dt * def.speed * bonus.mining;
  if (machine.progress < MINE_TIME) return;

  machine.progress -= MINE_TIME;
  if (!takeOre(world, source.tx, source.ty)) return;
  addToSlots(machine.output, ore, 1, def.slotSize);
  announce(world, machine, ore);
  // Said once, on the ore that emptied it: from here on a stalled miner looks
  // the same as one whose belt has backed up, and the player needs to know
  // this one will not start again.
  if (!minerSource(world, machine, ore)) {
    world.events.push({ kind: 'minerDry', pos: tileCenter(machine.tx, machine.ty), machine: machine.type, ore });
  }
}

/**
 * A fish trap pulls from the same table a rod does, one roll per catch. It is
 * how a peaceful island, which has no wisps, gets essence in quantity: the top
 * research tier needs it by the belt, not by the pocketful.
 */
function stepTrap(world: World, machine: Machine, dt: number): void {
  const def = MACHINES[machine.type];
  // Checked against a full catch of anything, so a slot that fits fish but
  // not essence cannot make one roll's result silently vanish.
  const drops = RESOURCES.fish.drops;
  if (drops.some((d) => roomFor(machine.output, d.item, def.slotSize) < d.count)) {
    machine.stalled = true;
    return;
  }

  machine.stalled = false;
  machine.progress += dt * def.speed;
  if (machine.progress < TRAP_TIME) return;

  machine.progress -= TRAP_TIME;
  const catchOf = rollDrop(world, 'fish');
  addToSlots(machine.output, catchOf.item, catchOf.count, def.slotSize);
  announce(world, machine, catchOf.item, catchOf.count);
}

/**
 * Tell the client what came out of this machine. Positions are the tile
 * centre rather than the machine, so a listener can place the sound without
 * needing the grid.
 */
function announce(world: World, machine: Machine, item: ItemId, count = 1): void {
  world.events.push({
    kind: 'produced',
    pos: tileCenter(machine.tx, machine.ty),
    machine: machine.type,
    item,
    count,
  });
}

/**
 * An inserter reaches into the tile behind it, swings, and lets go into the
 * tile it faces. It is the only thing that can take items back out of a chest,
 * so without one a chest is where a production line stops.
 *
 * What it picks up is held in the single input slot, so a blocked destination
 * stalls an inserter with its hand full rather than quietly dropping what it
 * grabbed. The slot's size is the hand's size: a stack arm lifts several of
 * one item per swing and lets them go one by one at the far end, which is how
 * it outpaces the arm's travel time without swinging any faster.
 */
function stepInserter(world: World, machine: Machine, dt: number, bonus: ResearchBonuses): void {
  const def = MACHINES[machine.type];

  if (machine.input[0] === null) {
    const grabbed = grabFromBehind(world, machine, def.reach, def.slotSize);
    if (grabbed === null) {
      // Nothing within reach is idle, not stalled — a red light on every
      // inserter waiting on a slow line would drown out real blockages.
      machine.progress = 0;
      machine.stalled = false;
      return;
    }
    machine.input[0] = grabbed;
  }

  // Past the end of the swing, progress keeps counting how long the arm has
  // hung over its target; the renderer clamps it, so the arm just holds still.
  machine.progress = Math.min(
    machine.progress + dt * def.speed * bonus.inserter,
    INSERTER_SWING * 2,
  );
  machine.stalled = false;
  if (machine.progress < INSERTER_SWING) return;

  const hand = machine.input[0];
  if (!hand) return;
  let dropped = false;
  while (hand.count > 0 && dropInFront(world, machine, hand.id, def.reach)) {
    hand.count--;
    dropped = true;
  }

  if (hand.count > 0) {
    // Arm extended over a destination that will not take the rest: hold it.
    // Only a whole swing's wait with nothing let go shows red, so a stack arm
    // feeding a belt faster than the belt can space items is not blocked.
    if (dropped) machine.progress = INSERTER_SWING;
    machine.stalled = machine.progress >= INSERTER_SWING * 2;
    return;
  }

  machine.input[0] = null;
  machine.progress = 0;
}

/**
 * Take up to `hand` of one item out of whatever sits behind the inserter,
 * `reach` tiles back. A filtered arm takes only what it is set to and leaves
 * the rest where it is, which is what lets one mixed chest or one shared belt
 * feed several lines.
 */
function grabFromBehind(
  world: World,
  machine: Machine,
  reach: number,
  hand: number,
): ItemStack | null {
  const { tx, ty } = inputTile(machine, reach);

  const belt = beltAt(world, tx, ty);
  if (belt) {
    // The item nearest the belt's output end is the one within reach. A
    // filtered arm does not dig past it: anything else keeps riding by. A
    // bigger hand keeps taking from the front while the item stays the same.
    const front = belt.items[0];
    if (!front || !wanted(machine, front.item)) return null;
    let count = 0;
    while (count < hand && belt.items[0]?.item === front.item) {
      belt.items.shift();
      count++;
    }
    return { id: front.item, count };
  }

  const source = machineAt(world, tx, ty);
  if (!source || MACHINES[source.type].family === 'inserter') return null;

  // A machine with an output side gives from there and nowhere else, so an
  // inserter cannot steal the ore a furnace is waiting to smelt. A chest has
  // no output side, and its storage is exactly what wants emptying — but a lab
  // has no output side either, and the packs in it are already spent.
  const sourceDef = MACHINES[source.type];
  if (sourceDef.outputSlots === 0 && !sourceDef.storage) return null;
  const from = sourceDef.outputSlots > 0 ? source.output : source.input;

  for (const slot of from) {
    if (slot && slot.count > 0 && wanted(machine, slot.id)) {
      const id = slot.id;
      const count = Math.min(hand, countIn(from, id));
      takeStack(from, id, count);
      return { id, count };
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
  // Two splitters aimed at each other would pass the same item back and forth,
  // and so would a merger emptying into whatever feeds it.
  if (isSplitter(target) && facesBack(target, machine)) return false;
  if (isMerger(target)) {
    const out = outputTile(target);
    if (out.tx === machine.tx && out.ty === machine.ty) return false;
  }
  return insertIntoMachine(target, item);
}

/**
 * A merger passes its buffer out of its front, then refills it from the belts
 * running into it, one item from each in turn. Taking rather than being given
 * is the point: with the line ahead full, every waiting belt still gets its
 * share of the gaps instead of the first one in the tick order taking them all.
 * The turn only advances past a belt that gave something, as on a splitter.
 */
function stepMerger(world: World, machine: Machine): void {
  const cap = MACHINES[machine.type].slotSize;
  machine.stalled = false;

  for (let guard = 0; guard < cap; guard++) {
    const slot = machine.input.find((s): s is ItemStack => s !== null && s.count > 0);
    if (!slot) break;
    if (!giveToTile(world, machine, outputTile(machine), slot.id)) {
      machine.stalled = true;
      break;
    }
    takeStack(machine.input, slot.id, 1);
  }

  const sources = mergerSources(machine);
  for (let guard = 0; guard < cap; guard++) {
    if (!takeFromFeeds(world, machine, sources)) return;
  }
}

/** Lift the front item off the first feeding belt, from whose turn it is. */
function takeFromFeeds(
  world: World,
  machine: Machine,
  sources: { tx: number; ty: number }[],
): boolean {
  const first = machine.turn ?? 0;
  for (let i = 0; i < sources.length; i++) {
    const at = (first + i) % sources.length;
    const belt = beltAt(world, sources[at].tx, sources[at].ty);
    if (!belt) continue;
    const out = outputTile(belt);
    if (out.tx !== machine.tx || out.ty !== machine.ty) continue;
    const front = belt.items[0];
    if (!front || front.offset < 1) continue;
    if (addToSlots(machine.input, front.item, 1, MACHINES[machine.type].slotSize) !== 1) return false;

    belt.items.shift();
    machine.turn = (at + 1) % sources.length;
    return true;
  }
  return false;
}

function facesBack(splitter: Machine, at: Machine): boolean {
  return sideTiles(splitter).some((t) => t.tx === at.tx && t.ty === at.ty);
}

function stepCrafter(
  world: World,
  machine: Machine,
  dt: number,
  bonus: ResearchBonuses,
): void {
  const def = MACHINES[machine.type];
  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  if (!recipe) {
    machine.stalled = true;
    return;
  }

  // Research speeds up how fast a craft advances rather than shortening it,
  // the same as a miner's, so every progress bar can keep reading the base time.
  const duration = craftTime(recipe, def.speed);

  // Only consume inputs once, at the moment a craft starts.
  if (machine.progress === 0) {
    if (!hasInputs(machine.input, recipe.inputs) || outputFull(machine, def.slotSize)) {
      machine.stalled = true;
      return;
    }
    // A burner with nothing to burn keeps its ingredients in the grid rather
    // than swallowing them into a craft it cannot run.
    if (!stoke(machine, bonus.fuel)) {
      machine.stalled = true;
      return;
    }
    for (const input of recipe.inputs) takeStack(machine.input, input.id, input.count);
  }

  // Running dry mid-craft pauses it; the progress is kept for when coal arrives.
  if (!stoke(machine, bonus.fuel)) {
    machine.stalled = true;
    return;
  }

  machine.stalled = false;
  const step = dt * bonus.crafting;
  machine.progress += step;
  // Heat is spent in recipe seconds, so the same craft costs the same fuel in
  // every tier. It may dip below zero by one tick's worth, which the next
  // burn pays back, so no work is ever done for free.
  if (machine.heat !== undefined) machine.heat -= step * def.speed;
  if (machine.progress < duration) return;

  machine.progress = 0;
  for (const out of recipe.outputs) {
    addToSlots(machine.output, out.id, out.count, def.slotSize);
    announce(world, machine, out.id, out.count);
  }
}

/**
 * A lab turns packs into research. It is the one machine whose recipe is not
 * its own: every lab on the island works on whatever the world is researching,
 * which is what makes research a throughput problem — a second lab is worth
 * exactly as much as a second furnace on a line.
 *
 * `machine.recipe` holds the tech whose packs this lab has already swallowed,
 * so a cycle can never be finished against a tech it was not paid for.
 */
function stepLab(world: World, machine: Machine, dt: number, bonus: ResearchBonuses): void {
  const def = MACHINES[machine.type];
  const tech = activeTech(world);

  if (machine.recipe !== null && machine.recipe !== tech?.id) refundCycle(machine);

  if (!tech) {
    machine.stalled = true;
    return;
  }

  if (machine.progress === 0) {
    if (!hasInputs(machine.input, tech.inputs)) {
      machine.stalled = true;
      return;
    }
    for (const input of tech.inputs) takeStack(machine.input, input.id, input.count);
    machine.recipe = tech.id;
  }

  machine.stalled = false;
  machine.progress += dt * def.speed * bonus.lab;
  if (machine.progress < tech.time) return;

  machine.progress = 0;
  machine.recipe = null;
  finishCycle(world, tech, bonus.xp);
}

/**
 * Hand back the packs of a cycle that will never finish, because the island is
 * now researching something else. They go back into the lab's own grid, which
 * has the room they came out of unless a belt filled it in the meantime.
 */
function refundCycle(machine: Machine): void {
  const previous = machine.recipe ? TECH_BY_ID.get(machine.recipe) : null;
  machine.recipe = null;
  machine.progress = 0;
  if (!previous) return;

  const { slotSize } = MACHINES[machine.type];
  for (const input of previous.inputs) {
    addToSlots(machine.input, input.id, input.count, slotSize);
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
