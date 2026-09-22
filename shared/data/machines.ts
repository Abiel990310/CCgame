import type { ItemStack, MachineId } from '../sim/types';

export interface MachineDef {
  id: MachineId;
  name: string;
  description: string;
  cost: ItemStack[];
  color: string;
  accent: string;
  /** Slots of storage on each side of the recipe. */
  inputSlots: number;
  outputSlots: number;
  /** How many of one item a slot holds before the machine backs up. */
  slotSize: number;
  /** Multiplies recipe time; a faster machine is a later-tier upgrade. */
  speed: number;
  /** True when the machine must be placed on an ore tile. */
  needsOre: boolean;
  /** True when the player picks which recipe it runs. */
  choosesRecipe: boolean;
}

export const MACHINES: Record<MachineId, MachineDef> = {
  miner: {
    id: 'miner',
    name: 'Miner',
    description: 'Place on an ore patch. Pulls ore out on its own, forever.',
    cost: [
      { id: 'wood', count: 10 },
      { id: 'stone', count: 10 },
    ],
    color: '#7f8894',
    accent: '#e8b64c',
    inputSlots: 0,
    outputSlots: 1,
    slotSize: 50,
    speed: 1,
    needsOre: true,
    choosesRecipe: false,
  },
  furnace: {
    id: 'furnace',
    name: 'Furnace',
    description: 'Smelts ore into plates. The first real production step.',
    cost: [
      { id: 'stone', count: 20 },
      { id: 'wood', count: 5 },
    ],
    color: '#8c7263',
    accent: '#f0a95c',
    inputSlots: 1,
    outputSlots: 1,
    slotSize: 50,
    speed: 1,
    needsOre: false,
    choosesRecipe: true,
  },
  assembler: {
    id: 'assembler',
    name: 'Assembler',
    description: 'Combines plates into parts. Where the chains start branching.',
    cost: [
      { id: 'ironPlate', count: 15 },
      { id: 'stone', count: 10 },
    ],
    color: '#6f7a8c',
    accent: '#6fc6f0',
    inputSlots: 2,
    outputSlots: 1,
    slotSize: 50,
    speed: 1,
    needsOre: false,
    choosesRecipe: true,
  },
  chest: {
    id: 'chest',
    name: 'Storage Chest',
    description: 'Accepts anything from a belt. An inserter is how it comes back out.',
    cost: [{ id: 'wood', count: 12 }],
    color: '#a4713d',
    accent: '#e8b64c',
    inputSlots: 8,
    outputSlots: 0,
    slotSize: 200,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
  },
  inserter: {
    id: 'inserter',
    name: 'Inserter',
    description: 'Reaches behind itself and loads what it finds into the tile ahead.',
    cost: [
      { id: 'wood', count: 4 },
      { id: 'ironPlate', count: 2 },
    ],
    color: '#3c4557',
    accent: '#7fd4ff',
    // The single input slot is the inserter's hand: one item, in transit.
    inputSlots: 1,
    outputSlots: 0,
    slotSize: 1,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
  },
};

export const MACHINE_ORDER: MachineId[] = [
  'miner',
  'furnace',
  'assembler',
  'chest',
  'inserter',
];

export const BELT_COST: ItemStack[] = [
  { id: 'wood', count: 1 },
  { id: 'stone', count: 1 },
];

/** Tiles per second an item travels along a belt. */
export const BELT_SPEED = 1.6;

/** Maximum items on one belt tile before it backs up. */
export const BELT_CAPACITY = 4;

/** Minimum gap between items on a belt, as a fraction of a tile. */
export const BELT_ITEM_GAP = 1 / BELT_CAPACITY;

/** Seconds an inserter takes to swing one item from behind it to in front. */
export const INSERTER_SWING = 0.6;
