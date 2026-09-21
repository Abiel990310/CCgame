import { ITEMS } from '../data/items';
import type { ItemId, ItemStack, Player, World } from './types';

export const INVENTORY_SLOTS = 24;

export function countItem(player: Player, id: ItemId): number {
  let total = 0;
  for (const stack of player.inventory) if (stack.id === id) total += stack.count;
  return total;
}

/** Returns how many were actually stored — the inventory can be full. */
export function addItem(player: Player, id: ItemId, count: number): number {
  const max = ITEMS[id].stack;
  let remaining = count;

  for (const stack of player.inventory) {
    if (stack.id !== id || stack.count >= max) continue;
    const room = max - stack.count;
    const moved = Math.min(room, remaining);
    stack.count += moved;
    remaining -= moved;
    if (remaining === 0) return count;
  }

  while (remaining > 0 && player.inventory.length < INVENTORY_SLOTS) {
    const moved = Math.min(max, remaining);
    player.inventory.push({ id, count: moved });
    remaining -= moved;
  }

  return count - remaining;
}

export function removeItem(player: Player, id: ItemId, count: number): boolean {
  if (countItem(player, id) < count) return false;
  let remaining = count;
  for (let i = player.inventory.length - 1; i >= 0 && remaining > 0; i--) {
    const stack = player.inventory[i];
    if (stack.id !== id) continue;
    const taken = Math.min(stack.count, remaining);
    stack.count -= taken;
    remaining -= taken;
    if (stack.count === 0) player.inventory.splice(i, 1);
  }
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
