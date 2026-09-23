import type { ItemId, ItemStack } from '../sim/types';

/**
 * What a completed tech makes better. Every one is a multiplier the simulation
 * reads each tick, so a tech never unlocks a new system — it makes the factory
 * that already exists worth more per tile, which is what keeps a late-game
 * island rebuilding itself rather than running out of things to want.
 */
export type TechEffectKind = 'mining' | 'crafting' | 'belt' | 'inserter' | 'lab' | 'xp';

export interface TechDef {
  id: string;
  name: string;
  description: string;
  /** Packs a lab consumes per research cycle. */
  inputs: ItemStack[];
  /** Cycles one level takes. A repeatable tech multiplies this by its level. */
  cycles: number;
  /** Seconds per cycle at lab speed 1. */
  time: number;
  /** Techs that must be finished first. */
  requires: string[];
  /** Added to the multiplier per completed level: 0.25 is +25%. */
  effect: { kind: TechEffectKind; amount: number };
  /** XP every player on the island earns per cycle. */
  xp: number;
  /** Researchable forever, each level dearer than the last. */
  repeatable?: boolean;
}

/**
 * The tech tree. Research is a belt problem, not a shop: a tech costs packs
 * delivered into a lab over time, so wanting the next one means building more
 * factory. Adding depth here is adding rows, the same as recipes.
 */
export const TECHS: TechDef[] = [
  {
    id: 'automation',
    name: 'Automation',
    description: 'Sharper drill heads. Every miner on the island pulls ore faster.',
    inputs: [{ id: 'researchPack', count: 1 }],
    cycles: 20,
    time: 4,
    requires: [],
    effect: { kind: 'mining', amount: 0.25 },
    xp: 5,
  },
  {
    id: 'beltLogistics',
    name: 'Belt Logistics',
    description: 'Tighter bearings. Every belt runs faster, so every line carries more.',
    inputs: [{ id: 'researchPack', count: 1 }],
    cycles: 30,
    time: 4,
    requires: ['automation'],
    effect: { kind: 'belt', amount: 0.25 },
    xp: 6,
  },
  {
    id: 'metallurgy',
    name: 'Metallurgy',
    description: 'Hotter furnaces and better jigs. Furnaces and assemblers craft faster.',
    inputs: [{ id: 'researchPack', count: 2 }],
    cycles: 40,
    time: 5,
    requires: ['automation'],
    effect: { kind: 'crafting', amount: 0.25 },
    xp: 8,
  },
  {
    id: 'roboticArms',
    name: 'Robotic Arms',
    description: 'Inserters swing half again as fast, so one arm keeps up with a full belt.',
    inputs: [
      { id: 'researchPack', count: 1 },
      { id: 'logicPack', count: 1 },
    ],
    cycles: 40,
    time: 6,
    requires: ['beltLogistics'],
    effect: { kind: 'inserter', amount: 0.5 },
    xp: 12,
  },
  {
    id: 'labAutomation',
    name: 'Lab Automation',
    description: 'Labs run their cycles faster, so research keeps up with what you can feed it.',
    inputs: [{ id: 'logicPack', count: 1 }],
    cycles: 50,
    time: 6,
    requires: ['metallurgy'],
    effect: { kind: 'lab', amount: 0.5 },
    xp: 12,
  },
  {
    id: 'fieldStudy',
    name: 'Field Study',
    description: 'You learn from what the labs learn. Research grants half again as much XP.',
    inputs: [
      { id: 'researchPack', count: 1 },
      { id: 'logicPack', count: 1 },
    ],
    cycles: 50,
    time: 6,
    requires: ['metallurgy'],
    effect: { kind: 'xp', amount: 0.5 },
    xp: 14,
  },
  {
    id: 'miningProductivity',
    name: 'Mining Productivity',
    description: 'Never finishes. Each level makes every miner faster again, and costs more.',
    inputs: [
      { id: 'researchPack', count: 1 },
      { id: 'logicPack', count: 1 },
      { id: 'powerPack', count: 1 },
    ],
    cycles: 60,
    time: 8,
    requires: ['roboticArms', 'labAutomation'],
    effect: { kind: 'mining', amount: 0.15 },
    xp: 25,
    repeatable: true,
  },
  {
    id: 'industrialEfficiency',
    name: 'Industrial Efficiency',
    description: 'Never finishes. Each level speeds up every furnace and assembler again.',
    inputs: [
      { id: 'logicPack', count: 1 },
      { id: 'powerPack', count: 1 },
    ],
    cycles: 60,
    time: 8,
    requires: ['fieldStudy', 'labAutomation'],
    effect: { kind: 'crafting', amount: 0.1 },
    xp: 25,
    repeatable: true,
  },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

/**
 * Every item any tech consumes. A lab accepts these and nothing else, whatever
 * is being researched right now, so a line can stockpile packs for the tech
 * after this one instead of backing up the moment one finishes.
 */
export const RESEARCH_PACKS: ItemId[] = [
  ...new Set(TECHS.flatMap((t) => t.inputs.map((i) => i.id))),
];

export function isResearchPack(id: ItemId): boolean {
  return RESEARCH_PACKS.includes(id);
}

/** Cycles one more level of a tech takes. A repeatable tech grows with level. */
export function techCycles(def: TechDef, level: number): number {
  return def.repeatable ? def.cycles * (level + 1) : def.cycles;
}
