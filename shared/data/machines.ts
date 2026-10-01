import type { BeltId, BeltTier, CraftedMachineId, ItemId, ItemStack, MachineFamily, MachineId, TurretAmmo } from '../sim/types';

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
   * Slots for modules, one each; absent on every machine but tier 3. A module
   * is never used up, so what makes it a steady sink is that every new tier 3
   * machine wants its slots filled.
   */
  moduleSlots?: number;
  /**
   * Power drawn while working, in kW; absent on anything that runs without
   * it. An electric machine slows with its network's supply and stops without one.
   */
  power?: number;
  /** Generators only: the most power it can put into its network, in kW. */
  generates?: number;
  /**
   * Accumulators only: kJ it holds, and the most kW it takes in or gives out.
   * It never makes power, only moves it from a daytime surplus to a night's
   * shortfall, so it is a row in the same table as the panels it pairs with.
   */
  stores?: { capacity: number; rate: number };
  /**
   * Poles only: how far its wires reach to the next pole, and the half-width
   * of the square around it whose machines it powers, both in tiles.
   */
  wire?: number;
  supply?: number;
  /**
   * True when players and mobs bump into it. A splitter is part of a belt
   * line, and belts are walkable so a factory never walls its owner in.
   */
  solid: boolean;
  /**
   * True when the machine is made at a workbench rather than put together on
   * the spot. Its `cost` is then the crafting recipe, and placing it spends
   * one of the crafted item instead. Must be listed in `CraftedMachineId`.
   */
  crafted?: boolean;
  /**
   * Underground belts only: which end of the tunnel this is. The entrance
   * swallows what is fed to it and the exit it pairs with lets it out.
   */
  tunnel?: 'in' | 'out';
  /**
   * Long-haul ports only: which end of the pair this is. The sender takes what
   * it is fed and the receiver puts it out of its front, some way off.
   */
  haul?: 'in' | 'out';
  /** The other end of a pair: what placing this becomes when it closes a tunnel or a long-haul pair. */
  pairsWith?: MachineId;
  /**
   * The crafted item that places this machine, when that is not the machine
   * itself. An underground exit is the same item as its entrance, put down
   * where it pairs with one, so the palette never needs a second entry.
   */
  placedWith?: CraftedMachineId;
}

/**
 * Seconds of recipe work one item of fuel pays for, at speed 1. The burn rate
 * follows the machine's work rate, so a faster tier eats fuel faster but every
 * craft costs the same coal whatever it is made in: one coal smelts four plates.
 */
export const FUEL_VALUE: Partial<Record<ItemId, number>> = {
  coal: 8,
};

/**
 * Seconds of full output one item of fuel keeps a generator going for, as a
 * share of what the same item pays a burner. A steam engine at full load feeds
 * five electric furnaces on a coal every 1.6 s, where burning it in them would
 * take four times the coal: power is the fuel-efficient way to scale.
 */
export const GENERATOR_FUEL_SHARE = 0.2;

export function isFuel(item: ItemId): boolean {
  return (FUEL_VALUE[item] ?? 0) > 0;
}

/**
 * A burner keeps this much fuel in hand before coal that a recipe also uses is
 * let through to the ingredient grid, so one coal belt can feed a steel
 * furnace both its fuel and its ingredient without either starving the other.
 */
export const FUEL_RESERVE = 5;

/**
 * Tiles an underground belt passes beneath between its entrance and its exit.
 * The exit may stand anywhere up to one past that.
 */
export const TUNNEL_REACH = 6;

/**
 * Long-haul transport. A pair of ports moves items between any two tiles of
 * the island without a belt: one item leaves the sender every `1 / rate`
 * seconds and reaches the receiver `base + distance / speed` seconds later.
 * The pipe holds at most `capacity` items, so a receiver that backs up stops
 * the sender taking more instead of swallowing the line behind it, and the
 * longest haul that still keeps up with `rate` is about
 * `(capacity / rate - base) * speed` tiles.
 */
export const HAUL = {
  /** Items per second one sender puts into the pipe. */
  rate: 6,
  /** Tiles per second an item travels in the pipe. */
  speed: 10,
  /** Seconds every trip takes before distance is counted. */
  base: 1,
  /** Most items in flight from one sender. */
  capacity: 96,
  /** Items a sender queues, or a receiver holds, while waiting for room. */
  buffer: 4,
} as const;

/** Seconds a parcel spends between two ports this many tiles apart. */
export function haulDelay(tiles: number): number {
  return HAUL.base + tiles / HAUL.speed;
}

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
    crafted: true,
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
    crafted: true,
    family: 'miner',
    tier: 3,
    name: 'Electric Miner',
    description: 'Four ore for every one the first drill pulled, and a patch that lasts a quarter as long. Runs on power.',
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
    moduleSlots: 2,
    power: 90,
    solid: true,
  },
  furnaceMk2: {
    id: 'furnaceMk2',
    crafted: true,
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
    crafted: true,
    family: 'furnace',
    tier: 3,
    name: 'Electric Furnace',
    description: 'Four stone furnaces in one tile, and not a lump of coal to feed it. Runs on power.',
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
    fuelSlots: 0,
    moduleSlots: 2,
    power: 180,
    solid: true,
  },
  assemblerMk2: {
    id: 'assemblerMk2',
    crafted: true,
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
    crafted: true,
    family: 'assembler',
    tier: 3,
    name: 'Industrial Assembler',
    description: 'The end of the ladder: four times the output of the first one. Runs on power.',
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
    fuelSlots: 0,
    moduleSlots: 2,
    power: 150,
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
    crafted: true,
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
    crafted: true,
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
    crafted: true,
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
    crafted: true,
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
    power: 20,
  },
  lab: {
    id: 'lab',
    crafted: true,
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
    crafted: true,
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
  merger: {
    id: 'merger',
    crafted: true,
    family: 'merger',
    tier: 1,
    name: 'Merger',
    description: 'Joins the belts running into its sides and back onto the one in front, turn by turn.',
    cost: [
      { id: 'wood', count: 6 },
      { id: 'ironPlate', count: 3 },
    ],
    color: '#4c5a6b',
    accent: '#e8c46a',
    inputSlots: 1,
    outputSlots: 0,
    slotSize: SPLITTER_BUFFER,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: true,
    fuelSlots: 0,
    solid: false,
  },
  tunnel: {
    id: 'tunnel',
    crafted: true,
    family: 'tunnel',
    tunnel: 'in',
    pairsWith: 'tunnelExit',
    tier: 1,
    name: 'Underground Belt',
    description: `Takes a line under up to ${TUNNEL_REACH} tiles. Place one, then another further on facing the same way to make its exit.`,
    cost: [
      { id: 'wood', count: 4 },
      { id: 'ironPlate', count: 4 },
    ],
    color: '#4c5a6b',
    accent: '#7ec8e3',
    inputSlots: 1,
    outputSlots: 0,
    slotSize: SPLITTER_BUFFER,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: true,
    fuelSlots: 0,
    // Walkable like the belts it joins, so a tunnel mouth never fences anyone in.
    solid: false,
  },
  tunnelExit: {
    id: 'tunnelExit',
    crafted: true,
    placedWith: 'tunnel',
    family: 'tunnel',
    tunnel: 'out',
    tier: 1,
    name: 'Underground Exit',
    description: 'Where an underground belt comes back up, onto whatever it faces.',
    cost: [],
    color: '#4c5a6b',
    accent: '#7ec8e3',
    inputSlots: 0,
    outputSlots: 1,
    slotSize: SPLITTER_BUFFER,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: true,
    fuelSlots: 0,
    solid: false,
  },
  haul: {
    id: 'haul',
    crafted: true,
    family: 'haul',
    haul: 'in',
    pairsWith: 'haulExit',
    tier: 1,
    name: 'Haul Port',
    description:
      'Place one, then another anywhere on the island: whatever goes into the first comes out of the second after a delay that grows with the distance.',
    cost: [
      { id: 'steelPlate', count: 8 },
      { id: 'circuit', count: 6 },
      { id: 'motor', count: 2 },
    ],
    color: '#3f4f6e',
    accent: '#8fd0ff',
    inputSlots: 1,
    outputSlots: 0,
    slotSize: HAUL.buffer,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    // What a sender holds is its queue for the trip, not a shelf to take from.
    storage: false,
    fuelSlots: 0,
    // A pad on the ground rather than a block, so nobody is fenced in by one.
    solid: false,
  },
  haulExit: {
    id: 'haulExit',
    crafted: true,
    placedWith: 'haul',
    family: 'haul',
    haul: 'out',
    tier: 1,
    name: 'Haul Port (receiving)',
    description: 'The far end of a long-haul pair. Whatever its partner is sent comes out of its front.',
    cost: [],
    color: '#3f4f6e',
    accent: '#8fd0ff',
    inputSlots: 0,
    outputSlots: 1,
    slotSize: HAUL.buffer,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
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
  generator: {
    id: 'generator',
    crafted: true,
    family: 'generator',
    tier: 1,
    name: 'Steam Engine',
    description:
      'Set on a shoreline. Boils lake water over coal and powers every electric machine its poles reach. Burns coal only as fast as the load asks.',
    cost: [
      { id: 'steelPlate', count: 10 },
      { id: 'gear', count: 10 },
      { id: 'circuit', count: 5 },
    ],
    color: '#6a5446',
    accent: '#ffb35c',
    inputSlots: 0,
    outputSlots: 0,
    slotSize: 50,
    speed: 1,
    needsOre: false,
    needsShore: true,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 2,
    generates: 900,
    solid: true,
  },
  solar: {
    id: 'solar',
    crafted: true,
    family: 'solar',
    tier: 1,
    name: 'Solar Panel',
    description:
      'Power without coal, but only while the sun is up. A field of them carries a base through the day and leaves the engines for the night.',
    cost: [
      { id: 'steelPlate', count: 5 },
      { id: 'copperPlate', count: 10 },
      { id: 'advancedCircuit', count: 2 },
    ],
    color: '#3d4a66',
    accent: '#7fb8ff',
    inputSlots: 0,
    outputSlots: 0,
    slotSize: 1,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 0,
    generates: 60,
    solid: true,
  },
  accumulator: {
    id: 'accumulator',
    crafted: true,
    family: 'accumulator',
    tier: 1,
    name: 'Accumulator',
    description:
      'Banks what the panels make beyond what the base uses by day, and gives it back once the sun is down, before any engine burns coal. A night of one assembler fits in one.',
    cost: [
      { id: 'steelPlate', count: 5 },
      { id: 'copperPlate', count: 10 },
      { id: 'circuit', count: 5 },
    ],
    color: '#4a5a52',
    accent: '#8ff0a8',
    inputSlots: 0,
    outputSlots: 0,
    slotSize: 1,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 0,
    stores: { capacity: 9000, rate: 300 },
    solid: true,
  },
  beacon: {
    id: 'beacon',
    crafted: true,
    family: 'beacon',
    tier: 1,
    name: 'Skyward Beacon',
    description:
      'The island\'s last and largest project. Raised in five stages, each fed like any machine, from steel up to processors and essence. Light it and the whole island sees.',
    cost: [
      { id: 'steelPlate', count: 40 },
      { id: 'circuit', count: 20 },
      { id: 'engineUnit', count: 5 },
    ],
    color: '#5a5f78',
    accent: '#ffd46a',
    // One slot per ingredient of the widest stage, each deep enough for a whole stage.
    inputSlots: 4,
    outputSlots: 0,
    slotSize: 999,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  turret: {
    id: 'turret',
    crafted: true,
    family: 'turret',
    tier: 1,
    name: 'Gun Turret',
    description:
      'Fires Iron or Steel Rounds at any creature that comes in range, day or night. Feed it by belt or inserter and the factory starts guarding itself.',
    cost: [
      { id: 'ironPlate', count: 20 },
      { id: 'gear', count: 10 },
      { id: 'circuit', count: 5 },
    ],
    color: '#5c6470',
    accent: '#d8b070',
    // One slot per kind of round, so a belt of one never crowds out the other.
    inputSlots: 2,
    outputSlots: 0,
    slotSize: 100,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 0,
    solid: true,
  },
  pole: {
    id: 'pole',
    family: 'pole',
    tier: 1,
    name: 'Power Pole',
    description: 'Powers machines within four tiles, and strings wire to any pole within eight.',
    cost: [
      { id: 'wood', count: 2 },
      { id: 'wire', count: 2 },
    ],
    color: '#7a5a3a',
    accent: '#ffd66b',
    inputSlots: 0,
    outputSlots: 0,
    slotSize: 1,
    speed: 1,
    needsOre: false,
    choosesRecipe: false,
    reach: 0,
    storage: false,
    fuelSlots: 0,
    wire: 8,
    supply: 4,
    // A pole is a post, not a wall: a line of them must never fence anyone in.
    solid: false,
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
  'merger',
  'tunnel',
  'haul',
  'lab',
  'fishTrap',
  'generator',
  'solar',
  'accumulator',
  'pole',
  'beacon',
  'turret',
];

export interface BeltDef {
  id: BeltId;
  tier: BeltTier;
  name: string;
  description: string;
  /** Tiles per second an item travels, before belt research. */
  speed: number;
  /** Per tile laid; upgrading over a lower tier refunds what that one cost. */
  cost: ItemStack[];
}

/**
 * The belt ladder. Each tier is a row, the same as a machine tier: the belt
 * system reads the speed off the belt it is moving items along and knows
 * nothing about Mk2 or Mk3. Only the first is built from raw materials; the
 * faster two are upgrades laid over it, like a Mk2 furnace over a Mk1.
 */
export const BELTS: Record<BeltId, BeltDef> = {
  belt: {
    id: 'belt',
    tier: 1,
    name: 'Belt',
    description: 'Carries items one tile at a time, in the direction it faces.',
    speed: 1.6,
    cost: [
      { id: 'wood', count: 1 },
      { id: 'stone', count: 1 },
    ],
  },
  beltMk2: {
    id: 'beltMk2',
    tier: 2,
    name: 'Belt Mk2',
    description: 'Twice as fast as a plain belt. Lay it over one to upgrade it in place, items and all.',
    speed: 3.2,
    cost: [
      { id: 'ironPlate', count: 1 },
      { id: 'gear', count: 1 },
    ],
  },
  beltMk3: {
    id: 'beltMk3',
    tier: 3,
    name: 'Belt Mk3',
    description: 'Four times a plain belt: one lane that keeps a bank of electric machines fed.',
    speed: 6.4,
    cost: [
      { id: 'steelPlate', count: 1 },
      { id: 'gear', count: 1 },
      { id: 'circuit', count: 1 },
    ],
  },
};

export const BELT_ORDER: BeltId[] = ['belt', 'beltMk2', 'beltMk3'];

export function isBeltId(what: unknown): what is BeltId {
  return typeof what === 'string' && Object.hasOwn(BELTS, what);
}

/** The kind of belt that has this tier. */
export function beltIdOf(tier: BeltTier): BeltId {
  return BELT_ORDER[tier - 1];
}

/** A belt's tier: Mk1 unless it says otherwise, which is every belt in an old save. */
export function beltTier(belt: { tier?: BeltTier }): BeltTier {
  return belt.tier ?? 1;
}

export const BELT_COST: ItemStack[] = BELTS.belt.cost;

/** The name of anything the build palette can offer, belts included. */
export function pieceName(id: MachineId | BeltId): string {
  return isBeltId(id) ? BELTS[id].name : MACHINES[id].name;
}

/**
 * Seconds a fish trap takes per catch. What it catches is the fishing spot's
 * own drop table, so a trap is a rod that nobody has to hold.
 */
export const TRAP_TIME = 6;

/**
 * A gun turret, per round: what it hits for before research, how often and how
 * far it shoots, and how fast the round flies. A round is one plate of each
 * metal for four shots, so a line of turrets is a steady draw on the smelters
 * rather than a one-off build.
 */
export const TURRET = {
  rate: 2,
  range: 260,
  speed: 560,
  /**
   * Bites a turret takes before it is wrecked. A brute's 14 a bite takes a
   * dozen, so one creature at an unguarded gun is a loss and a wall in front
   * of it is the answer.
   */
  armour: 160,
  /**
   * A raider that passes this close to a working turret turns on it instead
   * of the player, so the guns draw the fight the way a wall line would.
   */
  aggro: 110,
  /**
   * Iron plates to mend a turret from wrecked to whole by hand; a lighter
   * dent costs its share. Cheap next to a new turret, so holding a breaking
   * line in the middle of a raid is worth a run to the gun.
   */
  mendPlates: 6,
} as const;

/**
 * What each round does. Steel costs a steel plate where iron costs an iron
 * one, so it is the late-game upgrade to a turret line that needs no new
 * turret: swap what the belt carries and every gun hits twice as hard and
 * punches through the first creature into the one behind it.
 */
export const TURRET_AMMO: Record<TurretAmmo, { damage: number; pierce: number }> = {
  rounds: { damage: 9, pierce: 0 },
  steelRounds: { damage: 20, pierce: 1 },
};

/** Ammo in the order a turret reaches for it: the best it holds first. */
export const TURRET_AMMO_ORDER: TurretAmmo[] = ['steelRounds', 'rounds'];

/** Tiles per second an item travels along a plain belt. */
export const BELT_SPEED = BELTS.belt.speed;

/** Maximum items on one belt tile before it backs up. */
export const BELT_CAPACITY = 4;

/** Minimum gap between items on a belt, as a fraction of a tile. */
export const BELT_ITEM_GAP = 1 / BELT_CAPACITY;

/** Seconds an inserter takes to swing one item from behind it to in front. */
export const INSERTER_SWING = 0.6;

/** Machines made at the workbench, in palette order. */
export const CRAFTED_MACHINES = MACHINE_ORDER.filter((id) => MACHINES[id].crafted) as CraftedMachineId[];

/**
 * What placing a machine takes from the bag: its materials, or for a crafted
 * machine the one item the workbench made. Removing it hands the same back.
 */
export function placementCost(id: MachineId): ItemStack[] {
  const def = MACHINES[id];
  if (!def.crafted) return def.cost;
  return [{ id: def.placedWith ?? (id as CraftedMachineId), count: 1 }];
}
