import { ITEMS } from '../data/items';
import { distance } from './math';
import { addItem, countItem, removeItem } from './inventory';
import type { Building, ItemId, Player, World } from './types';

/**
 * Which food in the bag to eat next: the smallest that fills the gap, or the
 * biggest when none does. One key eats, so it has to spend berries on a
 * scratch and keep the grilled fish for when it counts.
 */
export function pickFood(player: Player): ItemId | null {
  const missing = player.maxHp - player.hp;
  let fits: ItemId | null = null;
  let biggest: ItemId | null = null;
  for (const slot of player.inventory) {
    const heal = slot ? (ITEMS[slot.id].food ?? 0) : 0;
    if (!slot || heal <= 0) continue;
    if (heal >= missing && (fits === null || heal < ITEMS[fits].food!)) fits = slot.id;
    if (biggest === null || heal > ITEMS[biggest].food!) biggest = slot.id;
  }
  return fits ?? biggest;
}

/** Eat one food from the bag. Nothing happens at full health or while downed. */
export function eat(world: World, player: Player): boolean {
  if (player.downed > 0 || player.hp >= player.maxHp) return false;
  const item = pickFood(player);
  if (!item || !removeItem(player, item, 1)) return false;
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + ITEMS[item].food!);
  world.events.push({ kind: 'ate', playerId: player.id, pos: { ...player.pos }, item, healed: player.hp - before });
  return true;
}

/**
 * How close to the campfire a player must stand to cook, from its centre. A
 * few steps further than the fire itself, so standing at its edge works.
 */
export const COOK_REACH = 90;

/** The campfire this player is standing at, if any. */
export function nearCampfire(world: World, player: Player): Building | null {
  for (const b of world.buildings) {
    if (b.type === 'campfire' && distance(b.pos, player.pos) <= COOK_REACH) return b;
  }
  return null;
}

/**
 * Grill every fish in the bag at the campfire, by hand, so a fish trap does
 * not need a furnace to be worth eating. Returns how many were cooked.
 */
export function cook(world: World, player: Player): number {
  if (player.downed > 0 || !nearCampfire(world, player)) return 0;
  const fish = countItem(player, 'fish');
  if (fish <= 0 || !removeItem(player, 'fish', fish)) return 0;
  // Fish and grilled fish stack alike, so the room the raw ones leave holds the cooked.
  addItem(player, 'grilledFish', fish);
  world.events.push({ kind: 'crafted', pos: { ...player.pos }, item: 'grilledFish' });
  return fish;
}
