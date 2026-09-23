import type { ItemStack, MachineFamily, MachineId } from '../sim/types';

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
  /**
   * The machine whose recipe rows this one runs. A tier 1 machine names
   * itself, so a steel furnace smelts everything a stone furnace does without
   * the recipe table gaining a row per tier.
   */
  family: MachineFamily;
  /** 1, 2 or 3. Drawn as pips, so a tier is readable out on the island. */
  tier: number;
  /** True when the machine must be placed on an ore tile. */
  needsOre: boolean;
  /** True when the player picks which recipe it runs. */
  choosesRecipe: boolean;
  /**
   * Tiles an arm reaches on each side, over whatever sits in between; 0 for
   * every family but the inserter. It is what separates the two arms, so a
   * longer reach is a data row rather than a second system.
   */
  reach: number;
}

export const MACHINES: Record<MachineId, MachineDef> = {
  miner: {
    id: 'miner',
    family: 'miner',
    tier: 1,
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
    reach: 0,
  },
  furnace: {
    id: 'furnace',
    family: 'furnace',
    tier: 1,
    name: 'Furnace',
    description: 'Smelts ore into plates. Feed it coal as well and it makes steel.',
    cost: [
      { id: 'stone', count: 20 },
      { id: 'wood', count: 5 },
    ],
    color: '#8c7263',
    accent: '#f0a95c',
    inputSlots: 2,
    outputSlots: 1,
    slotSize: 50,
    speed: 1,
    needsOre: false,
    choosesRecipe: true,
    reach: 0,
  },
  assembler: {
    id: 'assembler',
    family: 'assembler',
    tier: 1,
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
    reach: 0,
  },
  minerMk2: {
    id: 'minerMk2',
    family: 'miner',
    tier: 2,
    name: 'Steel Miner',
    description: 'A steel drill on the same patch. Twice the ore, one tile.',
    cost: [
      { id: 'steelPlate', count: 12 },
      { id: 'gear', count: 10 },
    ],
    color: '#79879b',
    accent: '#ffcf6b',
    inputSlots: 0,
    outputSlots: 2,
    slotSize: 50,
    speed: 2,
    needsOre: true,
    choosesRecipe: false,
    reach: 0,
  },
  minerMk3: {
    id: 'minerMk3',
    family: 'miner',
    tier: 3,
    name: 'Electric Miner',
    description: 'Four ore for every one the first drill pulled, off one patch.',
    cost: [
      { id: 'steelPlate', count: 20 },
      { id: 'motor', count: 6 },
      { id: 'advancedCircuit', count: 4 },
    ],
    color: '#5d6b8c',
    accent: '#7fd4ff',
    inputSlots: 0,
    outputSlots: 3,
    slotSize: 50,
    speed: 4,
    needsOre: true,
    choosesRecipe: false,
    reach: 0,
  },
  furnaceMk2: {
    id: 'furnaceMk2',
    family: 'furnace',
    tier: 2,
    name: 'Steel Furnace',
    description: 'Smelts at double speed, and holds enough to ride out a gap.',
    cost: [
      { id: 'steelPlate', count: 12 },
      { id: 'stone', count: 20 },
    ],
    color: '#7d7a72',
    accent: '#ffb74a',
    inputSlots: 4,
    outputSlots: 2,
    slotSize: 50,
    speed: 2,
    needsOre: false,
    choosesRecipe: true,
    reach: 0,
  },
  furnaceMk3: {
    id: 'furnaceMk3',
    family: 'furnace',
    tier: 3,
    name: 'Electric Furnace',
    description: 'Four stone furnaces in one tile. Steel banks stop sprawling.',
    cost: [
      { id: 'steelPlate', count: 20 },
      { id: 'motor', count: 8 },
      { id: 'advancedCircuit', count: 6 },
    ],
    color: '#6d7686',
    accent: '#7fd4ff',
    inputSlots: 6,
    outputSlots: 3,
    slotSize: 50,
    speed: 4,
    needsOre: false,
    choosesRecipe: true,
    reach: 0,
  },
  assemblerMk2: {
    id: 'assemblerMk2',
    family: 'assembler',
    tier: 2,
    name: 'Assembler Mk2',
    description: 'Builds the same parts twice as fast, with room for both inputs.',
    cost: [
      { id: 'steelPlate', count: 12 },
      { id: 'gear', count: 10 },
      { id: 'circuit', count: 6 },
    ],
    color: '#5f7391',
    accent: '#8fe0c0',
    inputSlots: 4,
    outputSlots: 2,
    slotSize: 50,
    speed: 2,
    needsOre: false,
    choosesRecipe: true,
    reach: 0,
  },
  assemblerMk3: {
    id: 'assemblerMk3',
    family: 'assembler',
    tier: 3,
    name: 'Industrial Assembler',
    description: 'The end of the ladder: four times the output of the first one.',
    cost: [
      { id: 'steelPlate', count: 25 },
      { id: 'motor', count: 12 },
      { id: 'advancedCircuit', count: 10 },
    ],
    color: '#55617f',
    accent: '#d48cff',
    inputSlots: 6,
    outputSlots: 2,
    slotSize: 50,
    speed: 4,
    needsOre: false,
    choosesRecipe: true,
    reach: 0,
  },
  chest: {
    id: 'chest',
    family: 'chest',
    tier: 1,
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
    reach: 0,
  },
  inserter: {
    id: 'inserter',
    family: 'inserter',
    tier: 1,
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
    reach: 1,
  },
  longInserter: {
    id: 'longInserter',
    family: 'inserter',
    // A sidegrade rather than a rung: it reaches further, not faster.
    tier: 1,
    name: 'Long Inserter',
    description: 'Reaches two tiles, so it loads a machine from across a belt.',
    cost: [
      { id: 'wood', count: 6 },
      { id: 'ironPlate', count: 4 },
      { id: 'gear', count: 2 },
    ],
    color: '#3f3a57',
    accent: '#c3a2ff',
    inputSlots: 1,
    outputSlots: 0,
    slotSize: 1,
    // The longer arm has further to travel, so it is the slower of the two.
    speed: 0.8,
    needsOre: false,
    choosesRecipe: false,
    reach: 2,
  },
};

/** Palette order: each family in tier order, storage and logistics last. */
export const MACHINE_ORDER: MachineId[] = [
  'miner',
  'minerMk2',
  'minerMk3',
  'furnace',
  'furnaceMk2',
  'furnaceMk3',
  'assembler',
  'assemblerMk2',
  'assemblerMk3',
  'chest',
  'inserter',
  'longInserter',
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
