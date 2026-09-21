import { addToSlots, countIn, makeSlots, roomFor, takeFromSlots } from './slots';
import type { ItemId, ItemStack, Player, Slot } from './types';

export const INVENTORY_SLOTS = 24;

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

export function hasAll(player: Player, cost: ItemStack[]): boolean {
  return cost.every((c) => countItem(player, c.id) >= c.count);
}

export function payAll(player: Player, cost: ItemStack[]): boolean {
  if (!hasAll(player, cost)) return false;
  for (const c of cost) removeItem(player, c.id, c.count);
  return true;
}
