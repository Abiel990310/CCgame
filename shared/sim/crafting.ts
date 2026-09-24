import { CRAFT_BY_ID } from '../data/crafting';
import { ITEMS } from '../data/items';
import { distance } from './math';
import { hasAll, payAll, roomForItem, addItem } from './inventory';
import { isUnlocked } from './research';
import type { Building, Player, ToolKind, World } from './types';

/**
 * How close to a workbench a player must stand to use it, measured from its
 * centre. Crafting is a trip home, not something done from the far side of
 * the island.
 */
export const WORKBENCH_REACH = 110;

export type CraftError = 'unknown' | 'far' | 'locked' | 'cost' | 'room' | null;

/** The workbench this player is standing at, nearest first. */
export function nearWorkbench(world: World, player: Player): Building | null {
  let best: Building | null = null;
  let bestDist = WORKBENCH_REACH;
  for (const b of world.buildings) {
    if (b.type !== 'workbench') continue;
    const d = distance(b.pos, player.pos);
    if (d <= bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

/** Why crafting this would fail, or null when it would work. */
export function craftError(world: World, player: Player, id: string): CraftError {
  const def = CRAFT_BY_ID.get(id);
  if (!def) return 'unknown';
  if (def.unlock && !isUnlocked(world, def.unlock)) return 'locked';
  if (!nearWorkbench(world, player)) return 'far';
  if (!hasAll(player, def.cost)) return 'cost';
  // Checked before paying, so a full bag never eats the ingredients.
  if (roomForItem(player, def.output) < def.count) return 'room';
  return null;
}

export function craft(world: World, player: Player, id: string): boolean {
  const def = CRAFT_BY_ID.get(id);
  if (!def || craftError(world, player, id) !== null) return false;
  if (!payAll(player, def.cost)) return false;
  addItem(player, def.output, def.count);
  world.events.push({ kind: 'crafted', pos: { ...player.pos }, item: def.output });
  return true;
}

/**
 * How much faster the best tool of a kind in the bag gathers, 1 with none.
 * Carrying is enough: there is no equip step to forget.
 */
export function toolSpeed(player: Player, kind: ToolKind): number {
  let best = 1;
  for (const slot of player.inventory) {
    const tool = slot ? ITEMS[slot.id].tool : undefined;
    if (tool && tool.kind === kind && tool.speed > best) best = tool.speed;
  }
  return best;
}
