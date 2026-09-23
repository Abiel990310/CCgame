import { BELT_COST, MACHINES } from '../data/machines';
import { RECIPE_BY_ID, recipesFor } from '../data/recipes';
import { giveOrDrop, payAll, hasAll } from './inventory';
import { makeSlots } from './slots';
import { inBounds, opposite, step1, tileKey } from './grid';
import { clearFelledNodes, nodeOnTile } from './nodes';
import { oreAt } from './ore';
import { isWalkable, terrainAtIndex } from './terrain';
import type { Belt, Direction, ItemStack, Machine, MachineId, Player, World } from './types';

export type FactoryError = 'occupied' | 'terrain' | 'ore' | 'cost' | 'bounds' | 'scenery' | null;

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
  if (world.grid.has(tileKey(tx, ty))) return 'occupied';
  if (!isWalkable(terrainAtIndex(world.terrain, tx, ty))) return 'terrain';
  // A tree buried under a belt keeps standing and keeps regrowing; clear it first.
  if (nodeOnTile(world, tx, ty) !== null) return 'scenery';

  if (what === 'belt') {
    return hasAll(player, BELT_COST) ? null : 'cost';
  }

  const def = MACHINES[what];
  if (def.needsOre && oreAt(world.ore, tx, ty) === null) return 'ore';
  return hasAll(player, def.cost) ? null : 'cost';
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

  const def = MACHINES[type];
  if (!payAll(player, def.cost)) return null;

  const machine: Machine = {
    id: world.nextId++,
    type,
    tx,
    ty,
    dir,
    // A miner's "recipe" is whatever it is standing on; everything else is chosen.
    recipe: type === 'miner' ? null : defaultRecipe(type),
    ore: type === 'miner' ? oreAt(world.ore, tx, ty) : null,
    progress: 0,
    input: makeSlots(def.inputSlots),
    output: makeSlots(def.outputSlots),
    stalled: false,
  };
  world.machines.push(machine);
  world.grid.set(tileKey(tx, ty), machine);
  clearFelledNodes(world);
  return machine;
}

function defaultRecipe(type: MachineId): string | null {
  const options = recipesFor(type);
  return options.length > 0 ? options[0].id : null;
}

export function removeAt(world: World, player: Player, tx: number, ty: number): boolean {
  const key = tileKey(tx, ty);
  const entity = world.grid.get(key);
  if (entity === undefined) return false;

  // The grid has already resolved the tile, so the type of the piece decides
  // which list to take it out of; the lists are only scanned because they are
  // what defines the tick order.
  world.grid.delete(key);

  if ('items' in entity) {
    drop(world.belts, entity);
    refund(world, player, BELT_COST);
    // Items riding the removed belt go back to the player rather than vanishing.
    for (const riding of entity.items) giveOrDrop(world, player, riding.item, 1);
    return true;
  }

  drop(world.machines, entity);
  refund(world, player, MACHINES[entity.type].cost);
  for (const stack of [...entity.input, ...entity.output]) {
    if (stack) giveOrDrop(world, player, stack.id, stack.count);
  }
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
  if (!recipe || recipe.machine !== machine.type) return false;

  machine.recipe = recipeId;
  machine.progress = 0;
  return true;
}

/** The tile an inserter reaches back into. Nothing else has an input side. */
export function inputTile(entity: { tx: number; ty: number; dir: Direction }): {
  tx: number;
  ty: number;
} {
  return step1(entity.tx, entity.ty, opposite(entity.dir));
}

/** The tile a machine or belt pushes its output into. */
export function outputTile(entity: { tx: number; ty: number; dir: Direction }): {
  tx: number;
  ty: number;
} {
  return step1(entity.tx, entity.ty, entity.dir);
}
