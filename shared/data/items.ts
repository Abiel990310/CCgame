import type { ItemId, ResourceKind, ToolKind } from '../sim/types';

/**
 * How an item draws in an inventory slot. There is no art in this project, so
 * a shape plus the item's colour is what makes a grid of stacks readable at a
 * glance instead of a wall of identical squares.
 */
export type ItemShape = 'chunk' | 'plate' | 'round' | 'strand' | 'leaf' | 'log';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Flat vector palette entry used by the renderer. */
  color: string;
  stack: number;
  shape: ItemShape;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', color: '#a4713d', stack: 999, shape: 'log' },
  stone: { id: 'stone', name: 'Stone', color: '#8f9aa6', stack: 999, shape: 'chunk' },
  fiber: { id: 'fiber', name: 'Fiber', color: '#8fbf6a', stack: 999, shape: 'strand' },
  berry: { id: 'berry', name: 'Berries', color: '#d8556b', stack: 999, shape: 'round' },
  fish: { id: 'fish', name: 'Fish', color: '#5fb8d8', stack: 999, shape: 'leaf' },
  iron: { id: 'iron', name: 'Iron', color: '#c3ccd6', stack: 999, shape: 'chunk' },
  gold: { id: 'gold', name: 'Gold', color: '#e8b64c', stack: 999, shape: 'chunk' },
  essence: { id: 'essence', name: 'Essence', color: '#b58cf0', stack: 999, shape: 'round' },

  ironOre: { id: 'ironOre', name: 'Iron Ore', color: '#9c8378', stack: 999, shape: 'chunk' },
  copperOre: { id: 'copperOre', name: 'Copper Ore', color: '#c28356', stack: 999, shape: 'chunk' },
  coal: { id: 'coal', name: 'Coal', color: '#4a4a52', stack: 999, shape: 'chunk' },

  ironPlate: { id: 'ironPlate', name: 'Iron Plate', color: '#c3ccd6', stack: 999, shape: 'plate' },
  copperPlate: {
    id: 'copperPlate',
    name: 'Copper Plate',
    color: '#e08a4c',
    stack: 999,
    shape: 'plate',
  },

  gear: { id: 'gear', name: 'Gear', color: '#9aa4ae', stack: 999, shape: 'round' },
  wire: { id: 'wire', name: 'Wire', color: '#e8a860', stack: 999, shape: 'strand' },
  circuit: { id: 'circuit', name: 'Circuit', color: '#6fc98a', stack: 999, shape: 'plate' },
};

export interface ResourceDef {
  kind: ResourceKind;
  name: string;
  tool: ToolKind;
  radius: number;
  charges: number;
  /** Weighted drop table; picked once per harvest tick. */
  drops: Array<{ item: ItemId; count: number; weight: number }>;
  xp: number;
}

export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  tree: {
    kind: 'tree',
    name: 'Tree',
    tool: 'axe',
    radius: 16,
    charges: 4,
    drops: [
      { item: 'wood', count: 2, weight: 10 },
      { item: 'fiber', count: 1, weight: 3 },
    ],
    xp: 2,
  },
  rock: {
    kind: 'rock',
    name: 'Rock',
    tool: 'pick',
    radius: 15,
    charges: 4,
    drops: [
      { item: 'stone', count: 2, weight: 10 },
      { item: 'iron', count: 1, weight: 3 },
      { item: 'gold', count: 1, weight: 1 },
    ],
    xp: 3,
  },
  bush: {
    kind: 'bush',
    name: 'Bush',
    tool: 'hand',
    radius: 13,
    charges: 3,
    drops: [
      { item: 'berry', count: 2, weight: 10 },
      { item: 'fiber', count: 2, weight: 6 },
    ],
    xp: 1,
  },
  fish: {
    kind: 'fish',
    name: 'Fishing spot',
    tool: 'rod',
    radius: 18,
    charges: 5,
    drops: [
      { item: 'fish', count: 1, weight: 10 },
      { item: 'essence', count: 1, weight: 2 },
    ],
    xp: 4,
  },
};
