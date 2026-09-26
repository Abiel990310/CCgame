import type { CraftedMachineId, ItemId, MobTypeId, ResourceKind, ToolKind } from '../sim/types';
import { CRAFTED_MACHINES, MACHINES } from './machines';

/**
 * The silhouette an item is drawn with. There is no art in this project, so
 * shape plus colour is the whole identity of an item, and the same name is
 * drawn in the bag and out in the world — see `src/render/items.ts`. Colour
 * alone is not enough: iron and steel plate are both grey, so they have to
 * differ in outline or they are the same object to a player.
 */
export type ItemShape =
  | 'chunk'
  | 'nugget'
  | 'log'
  | 'strand'
  | 'orb'
  | 'fish'
  | 'plate'
  | 'ingot'
  | 'gear'
  | 'coil'
  | 'board'
  | 'chip'
  | 'cell'
  | 'motor'
  | 'flask'
  | 'axe'
  | 'pick'
  | 'rod'
  | 'basket'
  | 'pack'
  | 'crate';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Flat vector palette entry used by the renderer. */
  color: string;
  stack: number;
  shape: ItemShape;
  /**
   * A hand tool: carried anywhere in the bag, it multiplies how fast nodes of
   * its kind are gathered. Only the best one of a kind counts.
   */
  tool?: { kind: ToolKind; speed: number };
  /**
   * A bag, by tier. Made at the workbench, it is sewn onto the player's bag
   * at once instead of landing in it: a bag carried in a slot could be put in
   * a chest, and the bag would shrink out from under what it held.
   */
  bag?: number;
}

/** Every crafted machine is also an item, drawn as a crate in the machine's colour. */
const MACHINE_ITEMS = Object.fromEntries(
  CRAFTED_MACHINES.map((id): [CraftedMachineId, ItemDef] => [
    id,
    { id, name: MACHINES[id].name, color: MACHINES[id].color, stack: 20, shape: 'crate' },
  ]),
) as Record<CraftedMachineId, ItemDef>;

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', color: '#a4713d', stack: 999, shape: 'log' },
  stone: { id: 'stone', name: 'Stone', color: '#8f9aa6', stack: 999, shape: 'chunk' },
  fiber: { id: 'fiber', name: 'Fiber', color: '#8fbf6a', stack: 999, shape: 'strand' },
  berry: { id: 'berry', name: 'Berries', color: '#d8556b', stack: 999, shape: 'orb' },
  fish: { id: 'fish', name: 'Fish', color: '#5fb8d8', stack: 999, shape: 'fish' },
  iron: { id: 'iron', name: 'Iron', color: '#c3ccd6', stack: 999, shape: 'nugget' },
  gold: { id: 'gold', name: 'Gold', color: '#e8b64c', stack: 999, shape: 'nugget' },
  essence: { id: 'essence', name: 'Essence', color: '#b58cf0', stack: 999, shape: 'orb' },

  ironOre: { id: 'ironOre', name: 'Iron Ore', color: '#7391b6', stack: 999, shape: 'chunk' },
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
  steelPlate: { id: 'steelPlate', name: 'Steel Plate', color: '#7e8ea6', stack: 999, shape: 'ingot' },

  gear: { id: 'gear', name: 'Gear', color: '#9aa4ae', stack: 999, shape: 'gear' },
  wire: { id: 'wire', name: 'Wire', color: '#e8a860', stack: 999, shape: 'coil' },
  circuit: { id: 'circuit', name: 'Circuit', color: '#6fc98a', stack: 999, shape: 'board' },
  battery: { id: 'battery', name: 'Battery', color: '#e3d24a', stack: 999, shape: 'cell' },
  motor: { id: 'motor', name: 'Motor', color: '#4f7fb8', stack: 999, shape: 'motor' },
  advancedCircuit: {
    id: 'advancedCircuit',
    name: 'Advanced Circuit',
    color: '#d4664f',
    stack: 999,
    shape: 'chip',
  },
  pipe: { id: 'pipe', name: 'Pipe', color: '#a9b4bf', stack: 999, shape: 'log' },
  engineUnit: { id: 'engineUnit', name: 'Engine Unit', color: '#c8923e', stack: 999, shape: 'motor' },
  processor: { id: 'processor', name: 'Processor', color: '#3fb0a0', stack: 999, shape: 'chip' },
  frame: { id: 'frame', name: 'Steel Frame', color: '#6c7a92', stack: 999, shape: 'ingot' },
  lens: { id: 'lens', name: 'Resonant Lens', color: '#bfe8ff', stack: 999, shape: 'orb' },
  rounds: { id: 'rounds', name: 'Iron Rounds', color: '#d8b070', stack: 999, shape: 'nugget' },

  researchPack: {
    id: 'researchPack',
    name: 'Research Pack',
    color: '#e0574f',
    stack: 999,
    shape: 'flask',
  },
  logicPack: { id: 'logicPack', name: 'Logic Pack', color: '#5fbf7a', stack: 999, shape: 'flask' },
  powerPack: { id: 'powerPack', name: 'Power Pack', color: '#6f8cf0', stack: 999, shape: 'flask' },
  resonancePack: {
    id: 'resonancePack',
    name: 'Resonance Pack',
    color: '#b58cf0',
    stack: 999,
    shape: 'flask',
  },
  engineeringPack: {
    id: 'engineeringPack',
    name: 'Engineering Pack',
    color: '#e8a24a',
    stack: 999,
    shape: 'flask',
  },

  stoneAxe: tool('stoneAxe', 'Stone Axe', '#9a8f80', 'axe', 1.5),
  stonePick: tool('stonePick', 'Stone Pickaxe', '#9a8f80', 'pick', 1.5),
  ironAxe: tool('ironAxe', 'Iron Axe', '#c3ccd6', 'axe', 2.2),
  ironPick: tool('ironPick', 'Iron Pickaxe', '#c3ccd6', 'pick', 2.2),
  steelAxe: tool('steelAxe', 'Steel Axe', '#7e9bc4', 'axe', 3.2),
  steelPick: tool('steelPick', 'Steel Pickaxe', '#7e9bc4', 'pick', 3.2),
  fishingRod: tool('fishingRod', 'Fishing Rod', '#b9854e', 'rod', 1.8),
  forageBasket: tool('forageBasket', 'Forage Basket', '#c9a36a', 'hand', 1.6),
  satchel: { id: 'satchel', name: 'Woven Satchel', color: '#b89660', stack: 1, shape: 'pack', bag: 1 },
  ironPack: { id: 'ironPack', name: 'Iron-Frame Pack', color: '#8a7768', stack: 1, shape: 'pack', bag: 2 },
  steelPack: { id: 'steelPack', name: 'Steel Rucksack', color: '#5f7488', stack: 1, shape: 'pack', bag: 3 },

  ...MACHINE_ITEMS,
};

function tool(id: ItemId, name: string, color: string, kind: ToolKind, speed: number): ItemDef {
  const shape: ItemShape = kind === 'hand' ? 'basket' : kind;
  return { id, name, color, stack: 1, shape, tool: { kind, speed } };
}

/** The last bag the workbench sews on. */
export const BAG_MAX = Math.max(...Object.values(ITEMS).map((i) => i.bag ?? 0));

/** Every item in table order, which is the order an item picker offers them. */
export const ITEM_ORDER = Object.keys(ITEMS) as ItemId[];

export interface ResourceDef {
  kind: ResourceKind;
  name: string;
  tool: ToolKind;
  radius: number;
  charges: number;
  /** Weighted drop table; picked once per harvest tick. */
  drops: Array<{ item: ItemId; count: number; weight: number }>;
  xp: number;
  /**
   * Landmarks only. Searching one takes `work` times as long as a harvest,
   * spills the whole `cache` at once, and the landmark is gone for good.
   * The farther from camp it stands, the more the cache holds.
   */
  landmark?: {
    work: number;
    cache: Array<{ item: ItemId; count: number }>;
    boon?: 'upgrade';
    /**
     * Creatures that wake when a player first comes near and hold the ground
     * around it, day or night. The rarer finds are a fight as well as a walk.
     */
    guards?: Array<{ type: MobTypeId; count: number }>;
  };
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
  cache: {
    kind: 'cache',
    name: 'Buried Cache',
    tool: 'hand',
    radius: 14,
    charges: 1,
    drops: [],
    xp: 12,
    landmark: {
      work: 2,
      cache: [
        { item: 'wood', count: 30 },
        { item: 'ironPlate', count: 12 },
        { item: 'coal', count: 20 },
      ],
    },
  },
  ruin: {
    kind: 'ruin',
    name: 'Old Ruins',
    tool: 'hand',
    radius: 22,
    charges: 1,
    drops: [],
    xp: 25,
    landmark: {
      work: 3,
      cache: [
        { item: 'stone', count: 25 },
        { item: 'iron', count: 10 },
        { item: 'gold', count: 5 },
        { item: 'gear', count: 8 },
      ],
      guards: [{ type: 'crawler', count: 3 }],
    },
  },
  pod: {
    kind: 'pod',
    name: 'Crashed Supply Pod',
    tool: 'hand',
    radius: 20,
    charges: 1,
    drops: [],
    xp: 40,
    landmark: {
      work: 4,
      cache: [
        { item: 'steelPlate', count: 20 },
        { item: 'circuit', count: 12 },
        { item: 'battery', count: 5 },
        { item: 'motor', count: 4 },
      ],
      guards: [
        { type: 'spitter', count: 2 },
        { type: 'brute', count: 1 },
      ],
    },
  },
  shrine: {
    kind: 'shrine',
    name: 'Essence Shrine',
    tool: 'hand',
    radius: 18,
    charges: 1,
    drops: [],
    xp: 60,
    landmark: {
      work: 5,
      cache: [{ item: 'essence', count: 12 }],
      // A shrine also hands its finder a level-up pick of their own.
      boon: 'upgrade',
      guards: [
        { type: 'shellback', count: 2 },
        { type: 'wisp', count: 3 },
      ],
    },
  },
};
