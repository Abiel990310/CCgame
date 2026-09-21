import type { ItemId, ResourceKind, ToolKind } from '../sim/types';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Flat vector palette entry used by the renderer. */
  color: string;
  stack: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', color: '#a4713d', stack: 999 },
  stone: { id: 'stone', name: 'Stone', color: '#8f9aa6', stack: 999 },
  fiber: { id: 'fiber', name: 'Fiber', color: '#8fbf6a', stack: 999 },
  berry: { id: 'berry', name: 'Berries', color: '#d8556b', stack: 999 },
  fish: { id: 'fish', name: 'Fish', color: '#5fb8d8', stack: 999 },
  iron: { id: 'iron', name: 'Iron', color: '#c3ccd6', stack: 999 },
  gold: { id: 'gold', name: 'Gold', color: '#e8b64c', stack: 999 },
  essence: { id: 'essence', name: 'Essence', color: '#b58cf0', stack: 999 },
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
