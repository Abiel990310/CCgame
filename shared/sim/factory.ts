import { BELT_COST, MACHINES, TUNNEL_REACH, placementCost } from '../data/machines';
import { RECIPE_BY_ID, recipesFor } from '../data/recipes';
import { buildingOnTile } from './building';
import { giveOrDrop, payAll, hasAll } from './inventory';
import { makeSlots, normalizeSlots } from './slots';
import { inBounds, opposite, rotate, step1, stepN, tileCenter, tileKey, turnLeft } from './grid';
import { clearFelledNodes, nodeOnTile } from './nodes';
import { oreAt } from './ore';
import { isUnlocked } from './research';
import { isShore, isWalkable, terrainAtIndex } from './terrain';
import type {
  Belt,
  Direction,
  ItemId,
  ItemStack,
  Machine,
  MachineFamily,
  MachineId,
  Player,
  World,
} from './types';

export type FactoryError =
  | 'occupied'
  | 'terrain'
  | 'ore'
  | 'shore'
  | 'locked'
  | 'cost'
  | 'bounds'
  | 'scenery'
  | 'camp'
  | null;

export function entityAt(world: World, tx: number, ty: number): Belt | Machine | null {
  return world.grid.get(tileKey(tx, ty)) ?? null;
}

export function machineAt(world: World, tx: number, ty: number): Machine | null {
  const found = entityAt(world, tx, ty);
  return found && 'type' in found ? found : null;
}

export function beltAt(world: World, tx: number, ty: number): Belt | null {
  const found = entityAt(world, tx, ty);
  return found && 'items' in found ? found : null;
}

/** Why placing here would fail, or null when it is legal. Drives the preview. */
export function factoryPlacementError(
  world: World,
  player: Player,
  what: MachineId | 'belt',
  tx: number,
  ty: number,
): FactoryError {
  if (!inBounds(tx, ty)) return 'bounds';
  // Checked before the upgrade shortcut, since dropping a tier onto the one
  // below it is still building that tier.
  if (what !== 'belt' && !isUnlocked(world, what)) return 'locked';
  // An upgrade stands where its predecessor already passed every tile check,
  // including the ore one: a miner that has emptied its own tile still works
  // the ring around it, and swapping in a faster drill must not strand it.
  if (what !== 'belt' && upgradeTarget(world, what, tx, ty) !== null) {
    return hasAll(player, placementCost(what)) ? null : 'cost';
  }
  if (world.grid.has(tileKey(tx, ty))) return 'occupied';
  if (!isWalkable(terrainAtIndex(world.terrain, tx, ty))) return 'terrain';
  // A tree buried under a belt keeps standing and keeps regrowing; clear it first.
  if (nodeOnTile(world, tx, ty) !== null) return 'scenery';
  // Camp pieces are held by radius rather than on the grid, so without their
  // own pass a belt runs straight through a wall.
  if (buildingOnTile(world, tx, ty) !== null) return 'camp';

  if (what === 'belt') {
    return hasAll(player, BELT_COST) ? null : 'cost';
  }

  const def = MACHINES[what];
  if (def.needsOre && oreAt(world.ore, tx, ty) === null) return 'ore';
  if (def.needsShore && !isShore(world.terrain, tx, ty)) return 'shore';
  return hasAll(player, placementCost(what)) ? null : 'cost';
}

export function placeBelt(
  world: World,
  player: Player,
  tx: number,
  ty: number,
  dir: Direction,
): Belt | null {
  if (factoryPlacementError(world, player, 'belt', tx, ty) !== null) return null;
  if (!payAll(player, BELT_COST)) return null;

  const belt: Belt = { id: world.nextId++, tx, ty, dir, items: [] };
  world.belts.push(belt);
  world.grid.set(tileKey(tx, ty), belt);
  world.events.push({ kind: 'placed', pos: tileCenter(tx, ty), what: 'belt' });
  clearFelledNodes(world);
  return belt;
}

export function placeMachine(
  world: World,
  player: Player,
  type: MachineId,
  tx: number,
  ty: number,
  dir: Direction,
): Machine | null {
  if (factoryPlacementError(world, player, type, tx, ty) !== null) return null;
  type = tunnelEnd(world, type, tx, ty, dir);

  const existing = upgradeTarget(world, type, tx, ty);
  if (existing) return upgradeMachine(world, player, existing, type);

  const def = MACHINES[type];
  if (!payAll(player, placementCost(type))) return null;

  const machine: Machine = {
    id: world.nextId++,
    type,
    tx,
    ty,
    dir,
    // A miner's "recipe" is whatever it is standing on; everything else is chosen.
    recipe: def.family === 'miner' ? null : defaultRecipe(type),
    filter: null,
    ore: def.family === 'miner' ? oreAt(world.ore, tx, ty) : null,
    progress: 0,
    input: makeSlots(def.inputSlots),
    output: makeSlots(def.outputSlots),
    stalled: false,
  };
  // Only a splitter carries sides and only storage carries slot filters, so
  // nothing else pays for the fields.
  if (def.family === 'splitter') {
    machine.filters = [null, null];
    machine.turn = 0;
  }
  if (def.family === 'merger') machine.turn = 0;
  if (def.family === 'chest') machine.filters = new Array<ItemId | null>(def.inputSlots).fill(null);
  if (def.fuelSlots > 0) {
    machine.fuel = makeSlots(def.fuelSlots);
    machine.heat = 0;
  }

  world.machines.push(machine);
  world.grid.set(tileKey(tx, ty), machine);
  world.events.push({ kind: 'placed', pos: tileCenter(tx, ty), what: type });
  clearFelledNodes(world);
  return machine;
}

/**
 * The machine a placement of `type` here would replace: one of the same family
 * at a lower tier. Anything else on the tile is simply in the way.
 */
export function upgradeTarget(
  world: World,
  type: MachineId,
  tx: number,
  ty: number,
): Machine | null {
  const machine = machineAt(world, tx, ty);
  if (!machine) return null;
  const from = MACHINES[machine.type];
  const to = MACHINES[type];
  return from.family === to.family && to.tier > from.tier ? machine : null;
}

/**
 * Swap a machine for a higher tier of its own family without taking it apart.
 * The same object stays on the grid, so its id, its place in the tick order,
 * its recipe, facing, filter and progress all carry over, and whatever is in
 * its grids stays in the slots it was in. The old machine comes back as its
 * cost, exactly as removing it would have given.
 */
function upgradeMachine(
  world: World,
  player: Player,
  machine: Machine,
  type: MachineId,
): Machine | null {
  const def = MACHINES[type];
  if (!payAll(player, placementCost(type))) return null;
  refund(world, player, placementCost(machine.type));

  machine.type = type;
  // A higher tier never has fewer slots, so every stack keeps its position.
  machine.input = normalizeSlots(machine.input, def.inputSlots, def.slotSize);
  machine.output = normalizeSlots(machine.output, def.outputSlots, def.slotSize);
  // A bigger chest keeps its slot filters where they were and opens the rest.
  if (def.family === 'chest') {
    machine.filters = machine.input.map((_, i) => machine.filters?.[i] ?? null);
  }
  // A stone furnace upgraded to steel becomes a burner, and starts cold.
  if (def.fuelSlots > 0) {
    machine.fuel = normalizeSlots(machine.fuel ?? [], def.fuelSlots, def.slotSize);
    machine.heat ??= 0;
  } else if (machine.fuel) {
    // A steel furnace upgraded to electric stops burning, and the coal it was
    // holding goes back to whoever did it rather than vanishing.
    refund(world, player, machine.fuel.flatMap((slot) => (slot ? [slot] : [])));
    delete machine.fuel;
    delete machine.heat;
  }
  machine.stalled = false;

  world.events.push({ kind: 'placed', pos: tileCenter(machine.tx, machine.ty), what: type });
  return machine;
}

function defaultRecipe(type: MachineId): string | null {
  const options = recipesFor(type);
  return options.length > 0 ? options[0].id : null;
}

/**
 * Restrict an inserter to one item, or clear the restriction with null. A
 * filtered arm is what lets one mixed chest feed several lines: everything it
 * is not set to rides past untouched.
 */
export function setFilter(world: World, machineId: number, item: ItemId | null): boolean {
  const machine = world.machines.find((m) => m.id === machineId);
  if (!machine || MACHINES[machine.type].family !== 'inserter') return false;

  machine.filter = item;
  return true;
}

export function removeAt(world: World, player: Player, tx: number, ty: number): boolean {
  const key = tileKey(tx, ty);
  const entity = world.grid.get(key);
  if (entity === undefined) return false;

  // The grid has already resolved the tile, so the type of the piece decides
  // which list to take it out of; the lists are only scanned because they are
  // what defines the tick order.
  world.grid.delete(key);
  world.events.push({ kind: 'removed', pos: tileCenter(tx, ty) });

  if ('items' in entity) {
    drop(world.belts, entity);
    refund(world, player, BELT_COST);
    // Items riding the removed belt go back to the player rather than vanishing.
    for (const riding of entity.items) giveOrDrop(world, player, riding.item, 1);
    return true;
  }

  drop(world.machines, entity);
  refund(world, player, placementCost(entity.type));
  for (const stack of [...entity.input, ...entity.output, ...(entity.fuel ?? [])]) {
    if (stack) giveOrDrop(world, player, stack.id, stack.count);
  }
  return true;
}

/**
 * Face a placed belt or machine another way, free. Dragging a belt line
 * decides its direction only once the second tile is reached, so the first
 * belt has to be turned after it is down; the items riding it keep their place.
 */
export function turnAt(world: World, tx: number, ty: number, dir: Direction): boolean {
  const entity = world.grid.get(tileKey(tx, ty));
  if (entity === undefined || entity.dir === dir) return false;
  entity.dir = dir;
  world.events.push({
    kind: 'placed',
    pos: tileCenter(tx, ty),
    what: 'items' in entity ? 'belt' : entity.type,
  });
  return true;
}

function drop<T>(list: T[], entity: T): void {
  const index = list.indexOf(entity);
  if (index >= 0) list.splice(index, 1);
}

function refund(world: World, player: Player, cost: readonly ItemStack[]): void {
  for (const entry of cost) giveOrDrop(world, player, entry.id, entry.count);
}

export function setRecipe(world: World, machineId: number, recipeId: string): boolean {
  const machine = world.machines.find((m) => m.id === machineId);
  if (!machine) return false;
  if (!MACHINES[machine.type].choosesRecipe) return false;

  const recipe = RECIPE_BY_ID.get(recipeId);
  if (!recipe || recipe.machine !== MACHINES[machine.type].family) return false;

  machine.recipe = recipeId;
  machine.progress = 0;
  return true;
}

/**
 * The tile an inserter reaches back into. Nothing else has an input side.
 * `reach` is the arm's length in tiles: a long arm passes over whatever is in
 * between rather than interacting with it.
 */
export function inputTile(
  entity: { tx: number; ty: number; dir: Direction },
  reach = 1,
): { tx: number; ty: number } {
  return stepN(entity.tx, entity.ty, opposite(entity.dir), reach);
}

/** The tile a machine or belt pushes its output into. */
export function outputTile(
  entity: { tx: number; ty: number; dir: Direction },
  reach = 1,
): { tx: number; ty: number } {
  return stepN(entity.tx, entity.ty, entity.dir, reach);
}

/**
 * A splitter's two output tiles: the one on its left, then the one on its
 * right. It is a T-piece — what feeds it comes in from any other side, and the
 * two arms are what the belt line becomes.
 */
export function sideTiles(entity: { tx: number; ty: number; dir: Direction }): [
  { tx: number; ty: number },
  { tx: number; ty: number },
] {
  return [
    step1(entity.tx, entity.ty, turnLeft(entity.dir)),
    step1(entity.tx, entity.ty, rotate(entity.dir)),
  ];
}

/**
 * The tiles a merger takes from, in the order it takes turns: left, behind,
 * right. It is the splitter read backwards, with the stem as the way out, and
 * behind is included so a straight line can run through one and be joined
 * from the side.
 */
export function mergerSources(entity: { tx: number; ty: number; dir: Direction }): [
  { tx: number; ty: number },
  { tx: number; ty: number },
  { tx: number; ty: number },
] {
  return [
    step1(entity.tx, entity.ty, turnLeft(entity.dir)),
    inputTile(entity),
    step1(entity.tx, entity.ty, rotate(entity.dir)),
  ];
}

/**
 * What placing `type` here actually puts down. An underground belt becomes the
 * exit of the nearest entrance behind it that faces the same way and is still
 * open, and an entrance otherwise, so one item in the palette lays both ends.
 * Every other machine is itself.
 */
export function tunnelEnd(world: World, type: MachineId, tx: number, ty: number, dir: Direction): MachineId {
  if (MACHINES[type].tunnel !== 'in') return type;
  // An exit nearer than any entrance already closes the tunnel behind it, so
  // this piece starts a new one.
  const behind = tunnelPiece(world, { tx, ty, dir: opposite(dir) }, dir);
  if (!behind || MACHINES[behind.type].tunnel !== 'in') return type;
  return MACHINES[type].pairsWith ?? type;
}

/**
 * The exit an underground entrance delivers to: the first tunnel end ahead of
 * it, within reach, that faces the same way — when that end is an exit. A
 * second entrance in the way means this one has nowhere to come up.
 */
export function tunnelExitOf(world: World, entrance: Machine): Machine | null {
  const found = tunnelPiece(world, entrance, entrance.dir);
  return found && MACHINES[found.type].tunnel === 'out' ? found : null;
}

/** The entrance feeding an underground exit, found the same way from the other end. */
export function tunnelEntranceOf(world: World, exit: Machine): Machine | null {
  const found = tunnelPiece(world, { tx: exit.tx, ty: exit.ty, dir: opposite(exit.dir) }, exit.dir);
  return found && MACHINES[found.type].tunnel === 'in' ? found : null;
}

/**
 * The nearest tunnel end facing `facing` along a line from `from`, within the
 * reach of one tunnel. Belts, machines and ends facing elsewhere are passed
 * under, which is the whole point of the thing.
 */
function tunnelPiece(
  world: World,
  from: { tx: number; ty: number; dir: Direction },
  facing: Direction,
): Machine | null {
  for (let d = 1; d <= TUNNEL_REACH + 1; d++) {
    const at = stepN(from.tx, from.ty, from.dir, d);
    const machine = machineAt(world, at.tx, at.ty);
    if (machine && machine.dir === facing && MACHINES[machine.type].tunnel) return machine;
  }
  return null;
}

export function isMerger(machine: Machine): boolean {
  return MACHINES[machine.type].family === 'merger';
}

/** Keyed on the family, so a faster splitter tier would need no changes here. */
export function isSplitter(machine: Machine): boolean {
  return MACHINES[machine.type].family === 'splitter';
}

/** The item a splitter's side is set to take, or null when it takes anything. */
export function filterOf(machine: Machine, side: number): ItemId | null {
  return machine.filters?.[side] ?? null;
}

/**
 * Whether a splitter has any side that would take this item. A splitter with
 * both sides filtered is a sorter: it refuses what it cannot route rather than
 * swallowing it, so the belt carries the rest on to the next machine.
 */
export function splitterAccepts(machine: Machine, item: ItemId): boolean {
  const filters = machine.filters;
  if (!filters || filters.length === 0) return true;
  return filters.some((f) => f == null || f === item);
}

/**
 * Point one of a splitter's sides at a single item, or clear it with null.
 * Named apart from the inserter's `setFilter` because a splitter has two.
 */
export function setSideFilter(
  world: World,
  machineId: number,
  side: number,
  item: ItemId | null,
): boolean {
  const machine = world.machines.find((m) => m.id === machineId);
  if (!machine || !isSplitter(machine)) return false;
  if (side !== 0 && side !== 1) return false;

  const filters = machine.filters ?? [null, null];
  if (filters[side] === item) return false;
  filters[side] = item;
  machine.filters = filters;
  return true;
}

/**
 * Whether a machine keeps a filter per storage slot. Keyed on the family, so a
 * bigger chest tier would carry them with no changes here; a splitter holds
 * items too, but its filters are its sides.
 */
export function hasSlotFilters(machine: Machine): boolean {
  return MACHINES[machine.type].family === 'chest';
}

/**
 * Keep one of a chest's slots for a single item, or open it back up with null.
 * The filter governs what goes in, not what is already there: a stack of
 * something else stays put until it is taken out, and nothing new joins it.
 */
export function setSlotFilter(
  world: World,
  machineId: number,
  index: number,
  item: ItemId | null,
): boolean {
  const machine = world.machines.find((m) => m.id === machineId);
  if (!machine || !hasSlotFilters(machine)) return false;
  if (!Number.isInteger(index) || index < 0 || index >= machine.input.length) return false;

  const filters = machine.filters ?? new Array<ItemId | null>(machine.input.length).fill(null);
  if ((filters[index] ?? null) === item) return false;
  filters[index] = item;
  machine.filters = filters;
  return true;
}

/**
 * Everything a player sets on a machine, lifted off it so it can be put on
 * another. What a machine holds and how far through a cycle it is are not
 * settings, so a paste never moves items or progress.
 */
export interface MachineSettings {
  family: MachineFamily;
  recipe: string | null;
  filter: ItemId | null;
  filters: (ItemId | null)[] | null;
}

/**
 * Whether a machine has anything to copy. A miner works whatever it stands on
 * and a lab whatever the island researches, so neither has a setting of its own.
 */
export function hasSettings(machine: Machine): boolean {
  const def = MACHINES[machine.type];
  return (
    def.choosesRecipe ||
    def.family === 'inserter' ||
    def.family === 'splitter' ||
    def.family === 'chest'
  );
}

export function copySettings(machine: Machine): MachineSettings {
  return {
    family: MACHINES[machine.type].family,
    recipe: machine.recipe,
    filter: machine.filter,
    filters: machine.filters ? [...machine.filters] : null,
  };
}

/**
 * Put copied settings on another machine of the same family. Tiers share a
 * family, so a Mk1 furnace's recipe goes onto a Mk3 as readily as onto another
 * Mk1; a chest's slot filters go on slot for slot, as far as both grids reach.
 * Returns whether anything changed.
 */
export function pasteSettings(world: World, machineId: number, settings: MachineSettings): boolean {
  const machine = world.machines.find((m) => m.id === machineId);
  if (!machine) return false;
  const def = MACHINES[machine.type];
  if (def.family !== settings.family) return false;

  let changed = false;
  if (def.choosesRecipe && settings.recipe !== null && settings.recipe !== machine.recipe) {
    changed = setRecipe(world, machineId, settings.recipe) || changed;
  }
  if (def.family === 'inserter' && settings.filter !== machine.filter) {
    changed = setFilter(world, machineId, settings.filter) || changed;
  }
  if (settings.filters) {
    if (isSplitter(machine)) {
      for (const side of [0, 1]) {
        changed = setSideFilter(world, machineId, side, settings.filters[side] ?? null) || changed;
      }
    } else if (hasSlotFilters(machine)) {
      for (let i = 0; i < machine.input.length; i++) {
        changed = setSlotFilter(world, machineId, i, settings.filters[i] ?? null) || changed;
      }
    }
  }
  return changed;
}
