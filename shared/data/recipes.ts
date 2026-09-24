import { MACHINES } from './machines';
import type { ItemStack, MachineId } from '../sim/types';

export interface Recipe {
  id: string;
  name: string;
  machine: MachineId;
  /** Seconds at machine speed 1. */
  time: number;
  inputs: ItemStack[];
  outputs: ItemStack[];
}

/**
 * The recipe graph. Adding depth to the game means adding rows here, not
 * writing new systems — every machine is driven generically by this table.
 */
export const RECIPES: Recipe[] = [
  {
    id: 'ironPlate',
    name: 'Iron Plate',
    machine: 'furnace',
    time: 2,
    inputs: [{ id: 'ironOre', count: 1 }],
    outputs: [{ id: 'ironPlate', count: 1 }],
  },
  {
    id: 'copperPlate',
    name: 'Copper Plate',
    machine: 'furnace',
    time: 2,
    inputs: [{ id: 'copperOre', count: 1 }],
    outputs: [{ id: 'copperPlate', count: 1 }],
  },
  {
    id: 'gear',
    name: 'Gear',
    machine: 'assembler',
    time: 1.5,
    inputs: [{ id: 'ironPlate', count: 2 }],
    outputs: [{ id: 'gear', count: 1 }],
  },
  {
    id: 'wire',
    name: 'Wire',
    machine: 'assembler',
    time: 1,
    inputs: [{ id: 'copperPlate', count: 1 }],
    outputs: [{ id: 'wire', count: 2 }],
  },
  {
    id: 'circuit',
    name: 'Circuit',
    machine: 'assembler',
    time: 3,
    inputs: [
      { id: 'gear', count: 1 },
      { id: 'wire', count: 3 },
    ],
    outputs: [{ id: 'circuit', count: 1 }],
  },
  {
    id: 'steelPlate',
    name: 'Steel Plate',
    machine: 'furnace',
    time: 4,
    inputs: [
      { id: 'ironPlate', count: 2 },
      { id: 'coal', count: 1 },
    ],
    outputs: [{ id: 'steelPlate', count: 1 }],
  },
  {
    id: 'battery',
    name: 'Battery',
    machine: 'assembler',
    time: 3,
    inputs: [
      { id: 'copperPlate', count: 1 },
      { id: 'coal', count: 1 },
    ],
    outputs: [{ id: 'battery', count: 1 }],
  },
  {
    id: 'motor',
    name: 'Motor',
    machine: 'assembler',
    time: 4,
    inputs: [
      { id: 'steelPlate', count: 1 },
      { id: 'gear', count: 2 },
    ],
    outputs: [{ id: 'motor', count: 1 }],
  },
  {
    id: 'advancedCircuit',
    name: 'Advanced Circuit',
    machine: 'assembler',
    time: 6,
    inputs: [
      { id: 'circuit', count: 2 },
      { id: 'battery', count: 1 },
    ],
    outputs: [{ id: 'advancedCircuit', count: 1 }],
  },
  {
    id: 'pipe',
    name: 'Pipe',
    machine: 'assembler',
    time: 1,
    inputs: [{ id: 'ironPlate', count: 1 }],
    outputs: [{ id: 'pipe', count: 1 }],
  },
  {
    id: 'engineUnit',
    name: 'Engine Unit',
    machine: 'assembler',
    time: 10,
    inputs: [
      { id: 'steelPlate', count: 1 },
      { id: 'pipe', count: 2 },
    ],
    outputs: [{ id: 'engineUnit', count: 1 }],
  },
  {
    id: 'researchPack',
    name: 'Research Pack',
    machine: 'assembler',
    time: 5,
    inputs: [
      { id: 'gear', count: 1 },
      { id: 'copperPlate', count: 1 },
    ],
    outputs: [{ id: 'researchPack', count: 1 }],
  },
  {
    id: 'logicPack',
    name: 'Logic Pack',
    machine: 'assembler',
    time: 7,
    inputs: [
      { id: 'circuit', count: 1 },
      { id: 'steelPlate', count: 1 },
    ],
    outputs: [{ id: 'logicPack', count: 1 }],
  },
  {
    id: 'powerPack',
    name: 'Power Pack',
    machine: 'assembler',
    time: 12,
    inputs: [
      { id: 'motor', count: 1 },
      { id: 'advancedCircuit', count: 1 },
    ],
    outputs: [{ id: 'powerPack', count: 1 }],
  },
  {
    // Essence is the one pack ingredient no machine mines. It comes off a
    // fishing line or out of a wisp, so the top of the tree sends a player
    // back out onto the island rather than retiring the gathering layer.
    id: 'resonancePack',
    name: 'Resonance Pack',
    machine: 'assembler',
    time: 8,
    inputs: [
      { id: 'circuit', count: 1 },
      { id: 'essence', count: 1 },
    ],
    outputs: [{ id: 'resonancePack', count: 1 }],
  },
  {
    id: 'engineeringPack',
    name: 'Engineering Pack',
    machine: 'assembler',
    time: 14,
    inputs: [
      { id: 'engineUnit', count: 1 },
      { id: 'circuit', count: 1 },
    ],
    outputs: [{ id: 'engineeringPack', count: 1 }],
  },
];

export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/**
 * A recipe is written once, against the tier 1 machine of its family. A steel
 * furnace runs the furnace rows, so a new tier costs one machine row and no
 * recipe rows at all.
 */
export function recipesFor(machine: MachineId): Recipe[] {
  const family = MACHINES[machine].family;
  return RECIPES.filter((r) => r.machine === family);
}

/** Seconds per craft after the machine's speed multiplier. */
export function craftTime(recipe: Recipe, speed: number): number {
  return recipe.time / Math.max(0.01, speed);
}
