import { BELT_COST, MACHINES } from '../data/machines';
import { RECIPE_BY_ID, recipesFor } from '../data/recipes';
import { addItem, payAll, hasAll } from './inventory';
import { inBounds, step1, tileKey } from './grid';
import { oreAt } from './ore';
import { isWalkable, terrainAtIndex } from './terrain';
import type { Belt, Direction, ItemId, Machine, MachineId, Player, World } from './types';

export type FactoryError = 'occupied' | 'terrain' | 'ore' | 'cost' | 'bounds' | null;

export function entityAt(world: World, tx: number, ty: number): Belt | Machine | null {
  const id = world.grid.get(tileKey(tx, ty));
  if (id === undefined) return null;
  return (
    world.belts.find((b) => b.id === id) ?? world.machines.find((m) => m.id === id) ?? null
  );
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
  world.grid.set(tileKey(tx, ty), belt.id);
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
    progress: 0,
    input: [],
    output: [],
    stalled: false,
  };
  world.machines.push(machine);
  world.grid.set(tileKey(tx, ty), machine.id);
  return machine;
}

function defaultRecipe(type: MachineId): string | null {
  const options = recipesFor(type);
  return options.length > 0 ? options[0].id : null;
}

export function removeAt(world: World, player: Player, tx: number, ty: number): boolean {
  const key = tileKey(tx, ty);
  const id = world.grid.get(key);
  if (id === undefined) return false;

  const beltIndex = world.belts.findIndex((b) => b.id === id);
  if (beltIndex >= 0) {
    const [belt] = world.belts.splice(beltIndex, 1);
    world.grid.delete(key);
    refund(world, player, BELT_COST.map((c) => ({ ...c })));
    // Items riding the removed belt go back to the player rather than vanishing.
    for (const riding of belt.items) giveItem(world, player, riding.item, 1);
    return true;
  }

  const machineIndex = world.machines.findIndex((m) => m.id === id);
  if (machineIndex >= 0) {
    const [machine] = world.machines.splice(machineIndex, 1);
    world.grid.delete(key);
    refund(world, player, MACHINES[machine.type].cost.map((c) => ({ ...c })));
    for (const stack of [...machine.input, ...machine.output]) {
      giveItem(world, player, stack.id, stack.count);
    }
    return true;
  }

  return false;
}

function refund(world: World, player: Player, cost: Array<{ id: ItemId; count: number }>): void {
  for (const entry of cost) giveItem(world, player, entry.id, entry.count);
}

function giveItem(world: World, player: Player, item: ItemId, count: number): void {
  // Anything that will not fit is dropped at the player's feet, never destroyed.
  const stored = addItem(player, item, count);
  if (stored >= count) return;
  world.pickups.push({
    id: world.nextId++,
    pos: { ...player.pos },
    vel: { x: 0, y: 0 },
    item,
    count: count - stored,
    xp: 0,
    settle: 0.3,
  });
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

/** The tile a machine or belt pushes its output into. */
export function outputTile(entity: { tx: number; ty: number; dir: Direction }): {
  tx: number;
  ty: number;
} {
  return step1(entity.tx, entity.ty, entity.dir);
}
