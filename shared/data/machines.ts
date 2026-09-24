import type { ItemId, ItemStack, MachineFamily, MachineId } from '../sim/types';

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
  /** True when the machine must stand on land that touches water. */
  needsShore?: boolean;
  /** True when the player picks which recipe it runs. */
  choosesRecipe: boolean;
  /**
   * Tiles an arm reaches on each side, over whatever sits in between; 0 for
   * every family but the inserter. It is what separates the two arms, so a
   * longer reach is a data row rather than a second system.
   */
  reach: number;
  /**
   * True when the machine holds items for anyone to take back out. An inserter
   * empties storage through its input grid, because a chest has no output side;
   * a machine that consumes what it is fed must not be drained the same way.
   */
  storage: boolean;
  /**
   * Slots of fuel beside the recipe grid; 0 for a machine that runs on
   * nothing. A burner stops the moment it runs dry, so a furnace bank needs a
   * second line feeding it coal, which is most of what makes a layout
   * interesting to plan.
   */
  fuelSlots: number;
  /**
   * True when players and mobs bump into it. A splitter is part of a belt
   * line, and belts are walkable so a factory never walls its owner in.
   */
  solid: boolean;
}

/**
 * Seconds of recipe work one item of fuel pays for, at speed 1. The burn rate
 * follows the machine's work rate, so a faster tier eats fuel faster but every
 * craft costs the same coal whatever it is made in: one coal smelts four plates.
 */
export const FUEL_VALUE: Partial<Record<ItemId, number>> = {
  coal: 8,
};

export function isFuel(item: ItemId): boolean {
  return (FUEL_VALUE[item] ?? 0) > 0;
}

/**
 * A burner keeps this much fuel in hand before coal that a recipe also uses is
 * let through to the ingredient grid, so one coal belt can feed a steel
 * furnace both its fuel and its ingredient without either starving the other.
 */
export const FUEL_RESERVE = 5;

/** Items a splitter holds while waiting for a side to take them. */
export const SPLITTER_BUFFER = 4;

export const MACHINES: Record<MachineId, MachineDef> = {
  miner: {
    id: 'miner',
    family: 'miner',
    tier: 1,
    name: 'Miner',
    description: 'Place on an ore patch. Works the ground around it until the ore is gone.',
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
    storage: false,
    fuelSlots: 0,
    solid: true,
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
    storage: false,
    fuelSlots: 0,
    solid: true,
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
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  minerMk2: {
    id: 'minerMk2',
    family: 'miner',
    tier: 2,
    name: 'Steel Miner',
    description: 'A steel drill on the same ground. Twice the ore, and it runs out twice as fast.',
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
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  minerMk3: {
    id: 'minerMk3',
    family: 'miner',
    tier: 3,
    name: 'Electric Miner',
    description: 'Four ore for every one the first drill pulled, and a patch that lasts a quarter as long.',
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
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  furnaceMk2: {
    id: 'furnaceMk2',
    family: 'furnace',
    tier: 2,
    name: 'Steel Furnace',
    description: 'Smelts at double speed, and holds enough to ride out a gap. Burns coal.',
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
    storage: false,
    fuelSlots: 1,
    solid: true,
  },
  furnaceMk3: {
    id: 'furnaceMk3',
    family: 'furnace',
    tier: 3,
    name: 'Electric Furnace',
    description: 'Four stone furnaces in one tile. Steel banks stop sprawling. Burns coal.',
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
    storage: false,
    fuelSlots: 1,
    solid: true,
  },
  assemblerMk2: {
    id: 'assemblerMk2',
    family: 'assembler',
    tier: 2,
    name: 'Assembler Mk2',
    description: 'Builds the same parts twice as fast, with room for both inputs. Burns coal.',
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
    storage: false,
    fuelSlots: 1,
    solid: true,
  },
  assemblerMk3: {
    id: 'assemblerMk3',
    family: 'assembler',
    tier: 3,
    name: 'Industrial Assembler',
    description: 'The end of the ladder: four times the output of the first one. Burns coal.',
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
    storage: false,
    fuelSlots: 1,
    solid: true,
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
    storage: true,
    fuelSlots: 0,
    solid: true,
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
    storage: false,
    fuelSlots: 0,
    solid: true,
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
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  steelChest: {
    id: 'steelChest',
    family: 'chest',
    tier: 2,
    name: 'Steel Chest',
    description: 'Twice the room of a wooden chest, for a buffer that rides out a long night.',
    cost: [{ id: 'steelPlate', count: 16 }],
    color: '#6f7784',
    accent: '#cfd8e3',
    inputSlots: 16,
    outputSlots: 0,
    slotSize: 200,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    solid: true,
    storage: true,
    fuelSlots: 0,
  },
  fastInserter: {
    id: 'fastInserter',
    family: 'inserter',
    tier: 2,
    name: 'Fast Inserter',
    description: 'Swings two and a half times as fast, enough to keep an electric furnace fed.',
    cost: [
      { id: 'steelPlate', count: 2 },
      { id: 'gear', count: 4 },
      { id: 'circuit', count: 2 },
    ],
    color: '#4a3c3c',
    accent: '#ff8a6b',
    inputSlots: 1,
    outputSlots: 0,
    slotSize: 1,
    // About four items a second: one arm keeps pace with a Mk3 furnace, where
    // the first arm managed under two and starved it.
    speed: 2.5,
    needsOre: false,
    choosesRecipe: false,
    reach: 1,
    solid: true,
    storage: false,
    fuelSlots: 0,
  },
  stackInserter: {
    id: 'stackInserter',
    family: 'inserter',
    tier: 3,
    name: 'Stack Inserter',
    description: 'Lifts four of one item at a time, so a single arm can empty a chest onto a belt.',
    cost: [
      { id: 'steelPlate', count: 6 },
      { id: 'motor', count: 2 },
      { id: 'advancedCircuit', count: 2 },
    ],
    color: '#3c4a3f',
    accent: '#8fe07a',
    inputSlots: 1,
    outputSlots: 0,
    // The hand: four of one item per swing. Faster than a belt can carry, so
    // out of a chest it is the belt, not the arm, that sets the pace.
    slotSize: 4,
    speed: 2.5,
    needsOre: false,
    choosesRecipe: false,
    reach: 1,
    solid: true,
    storage: false,
    fuelSlots: 0,
  },
  lab: {
    id: 'lab',
    family: 'lab',
    tier: 1,
    name: 'Lab',
    description: 'Eats research packs off a belt. Every cycle it finishes levels you up.',
    cost: [
      { id: 'ironPlate', count: 20 },
      { id: 'gear', count: 10 },
      { id: 'circuit', count: 5 },
    ],
    color: '#5c6f8c',
    accent: '#9fe3ff',
    // One slot per kind of pack, so a full belt of one can never crowd out
    // the others the way a shared grid would.
    inputSlots: 4,
    outputSlots: 0,
    slotSize: 50,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  splitter: {
    id: 'splitter',
    family: 'splitter',
    tier: 1,
    name: 'Splitter',
    description: 'Takes one belt in and feeds the tiles either side of it, turn by turn.',
    cost: [
      { id: 'wood', count: 6 },
      { id: 'ironPlate', count: 3 },
    ],
    color: '#4c5a6b',
    accent: '#8fe0b4',
    // A short buffer, so a splitter smooths a line rather than metering it.
    inputSlots: 1,
    outputSlots: 0,
    slotSize: SPLITTER_BUFFER,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    // Its buffer is items in transit, not spent, so an arm may lift them out
    // exactly as it could before the flag existed.
    storage: true,
    fuelSlots: 0,
    solid: false,
  },
  fishTrap: {
    id: 'fishTrap',
    family: 'fishTrap',
    tier: 1,
    name: 'Fish Trap',
    description: 'Set on a shoreline. Hauls up fish, and now and then essence, onto a belt.',
    cost: [
      { id: 'wood', count: 20 },
      { id: 'fiber', count: 10 },
      { id: 'ironPlate', count: 5 },
    ],
    color: '#6b5a44',
    accent: '#5fb8d8',
    inputSlots: 0,
    outputSlots: 2,
    slotSize: 50,
    speed: 1,
    needsOre: false,
    needsShore: true,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    solid: true,
    fuelSlots: 0,
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
  'steelChest',
  'inserter',
  'fastInserter',
  'stackInserter',
  'longInserter',
  'splitter',
  'lab',
  'fishTrap',
];

export const BELT_COST: ItemStack[] = [
  { id: 'wood', count: 1 },
  { id: 'stone', count: 1 },
];

/**
 * Seconds a fish trap takes per catch. What it catches is the fishing spot's
 * own drop table, so a trap is a rod that nobody has to hold.
 */
export const TRAP_TIME = 6;

/** Tiles per second an item travels along a belt. */
export const BELT_SPEED = 1.6;

/** Maximum items on one belt tile before it backs up. */
export const BELT_CAPACITY = 4;

/** Minimum gap between items on a belt, as a fraction of a tile. */
export const BELT_ITEM_GAP = 1 / BELT_CAPACITY;

/** Seconds an inserter takes to swing one item from behind it to in front. */
export const INSERTER_SWING = 0.6;
