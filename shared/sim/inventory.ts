import { addToSlots, countIn, makeSlots, roomFor, takeFromSlots } from './slots';
import type { ItemId, ItemStack, Player, Slot, World } from './types';

export const INVENTORY_SLOTS = 24;

/** Slots a sewn-on bag adds: one row of the grid. */
export const BAG_ROW = 8;

/** How big this player's bag is, with every bag they have sewn on. */
export function bagSlots(player: Pick<Player, 'bag'>): number {
  return INVENTORY_SLOTS + BAG_ROW * (player.bag ?? 0);
}

export function newInventory(): Slot[] {
  return makeSlots(INVENTORY_SLOTS);
}

export function countItem(player: Player, id: ItemId): number {
  return countIn(player.inventory, id);
}

/** Returns how many were actually stored — the inventory can be full. */
export function addItem(player: Player, id: ItemId, count: number): number {
  return addToSlots(player.inventory, id, count);
}

export function roomForItem(player: Player, id: ItemId): number {
  return roomFor(player.inventory, id);
}

export function removeItem(player: Player, id: ItemId, count: number): boolean {
  if (countItem(player, id) < count) return false;
  takeFromSlots(player.inventory, id, count);
  return true;
}

export function hasAll(player: Player, cost: readonly ItemStack[]): boolean {
  return cost.every((c) => countItem(player, c.id) >= c.count);
}

export function payAll(player: Player, cost: readonly ItemStack[]): boolean {
  if (!hasAll(player, cost)) return false;
  for (const c of cost) removeItem(player, c.id, c.count);
  return true;
}

/** Hand items over, dropping anything that will not fit at the player's feet. */
export function giveOrDrop(world: World, player: Player, id: ItemId, count: number): void {
  const stored = addItem(player, id, count);
  if (stored >= count) return;
  world.pickups.push({
    id: world.nextId++,
    pos: { ...player.pos },
    vel: { x: 0, y: 0 },
    item: id,
    count: count - stored,
    xp: 0,
    settle: 0.3,
  });
}
