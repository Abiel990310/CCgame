import type { ItemId, ItemStack, MachineId } from '../sim/types';

/**
 * What a completed tech makes better. Every one is a multiplier the simulation
 * reads each tick: a tech never unlocks a new system, it makes the factory
 * that already exists worth more per tile, which is what keeps a late-game
 * island rebuilding itself rather than running out of things to want.
 */
export type TechEffectKind =
  | 'mining'
  | 'crafting'
  | 'belt'
  | 'inserter'
  | 'lab'
  | 'xp'
  /** Hand gathering, on top of tools and upgrades. */
  | 'gather'
  /** Every weapon's damage. */
  | 'damage'
  /** Work each item of fuel pays for, in burners and engines alike. */
  | 'fuel'
  /** Output of every generator. */
  | 'power';

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
  /**
   * Added to the multiplier per completed level: 0.25 is +25%. Absent on a
   * tech whose whole reward is what it unlocks.
   */
  effect?: { kind: TechEffectKind; amount: number };
  /**
   * Machines the build palette offers once this is finished. A machine no tech
   * names is there from the start, so a new tier is gated by adding its id
   * here rather than by touching the palette.
   */
  unlocks?: MachineId[];
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
    unlocks: ['minerMk2'],
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
    unlocks: ['splitter', 'merger', 'tunnel', 'longInserter'],
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
    unlocks: ['furnaceMk2', 'assemblerMk2', 'steelChest'],
    xp: 8,
  },
  {
    id: 'toolmaking',
    name: 'Toolmaking',
    description: 'Better grips and truer edges. You gather everything by hand a quarter faster.',
    inputs: [{ id: 'researchPack', count: 1 }],
    cycles: 25,
    time: 4,
    requires: ['automation'],
    effect: { kind: 'gather', amount: 0.25 },
    xp: 6,
  },
  {
    id: 'fireboxDesign',
    name: 'Firebox Design',
    description: 'Tighter doors and a better draught. Every lump of coal does a quarter more work.',
    inputs: [{ id: 'researchPack', count: 2 }],
    cycles: 40,
    time: 5,
    requires: ['metallurgy'],
    effect: { kind: 'fuel', amount: 0.25 },
    xp: 8,
  },
  {
    id: 'weaponsmithing',
    name: 'Weaponsmithing',
    description: 'Steel heads and balanced shafts. Every weapon you carry hits a fifth harder.',
    inputs: [
      { id: 'researchPack', count: 1 },
      { id: 'logicPack', count: 1 },
    ],
    cycles: 40,
    time: 6,
    requires: ['metallurgy'],
    effect: { kind: 'damage', amount: 0.2 },
    xp: 12,
  },
  {
    id: 'electricity',
    name: 'Electricity',
    description:
      'Steam engines on the shore and poles to carry what they make. Every electric machine after this runs on power instead of coal.',
    inputs: [
      { id: 'researchPack', count: 1 },
      { id: 'logicPack', count: 1 },
    ],
    cycles: 30,
    time: 6,
    requires: ['metallurgy'],
    unlocks: ['generator', 'pole'],
    xp: 12,
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
    unlocks: ['fastInserter'],
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
    id: 'angling',
    name: 'Angling',
    description:
      'Nets and floats for a trap that fishes the shoreline by itself, essence and all.',
    inputs: [{ id: 'researchPack', count: 1 }],
    cycles: 15,
    time: 4,
    requires: ['automation'],
    unlocks: ['fishTrap'],
    xp: 6,
  },
  {
    // The top of the tree, and the one tech a pack of essence buys. A peaceful
    // island has no wisps, so the fish trap is its whole road here and has to
    // be reachable from the first tier of research.
    id: 'resonance',
    name: 'Resonance',
    description:
      'Essence tuned into a motor. The electric machines, and an arm that moves a stack at a time.',
    inputs: [
      { id: 'logicPack', count: 1 },
      { id: 'powerPack', count: 1 },
      { id: 'resonancePack', count: 1 },
    ],
    cycles: 40,
    time: 8,
    requires: ['roboticArms', 'labAutomation', 'angling', 'electricity'],
    effect: { kind: 'crafting', amount: 0.1 },
    unlocks: ['minerMk3', 'furnaceMk3', 'assemblerMk3', 'stackInserter'],
    xp: 30,
  },
  {
    id: 'deepDrilling',
    name: 'Deep Drilling',
    description:
      'Never finishes. Each level makes every miner faster again, and costs more. Patches run dry sooner.',
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
  {
    // The engineering pack is four assemblers deep (plate, pipe, engine
    // unit, pack) beside a steel line, so these techs are where a base has
    // to be redesigned rather than extended.
    id: 'steamPressure',
    name: 'High-Pressure Steam',
    description: 'Every generator on the island puts out a quarter more power.',
    inputs: [
      { id: 'logicPack', count: 1 },
      { id: 'engineeringPack', count: 1 },
    ],
    cycles: 50,
    time: 8,
    requires: ['electricity'],
    effect: { kind: 'power', amount: 0.25 },
    xp: 18,
  },
  {
    id: 'solarPower',
    name: 'Solar Power',
    description: 'Panels that make power from daylight alone. Nothing to feed, and nothing at night.',
    inputs: [
      { id: 'logicPack', count: 1 },
      { id: 'engineeringPack', count: 1 },
    ],
    cycles: 60,
    time: 8,
    requires: ['electricity'],
    unlocks: ['solar'],
    xp: 20,
  },
  {
    id: 'skyward',
    name: 'Skyward Beacon',
    description: 'Plans for the island\'s last great build: a beacon raised in five stages from the whole factory\'s output.',
    inputs: [
      { id: 'logicPack', count: 1 },
      { id: 'powerPack', count: 1 },
      { id: 'engineeringPack', count: 1 },
    ],
    cycles: 120,
    time: 10,
    requires: ['solarPower', 'steamPressure'],
    unlocks: ['beacon'],
    xp: 30,
  },
  {
    id: 'ballistics',
    name: 'Ballistics',
    description: 'Never finishes. Each level makes every weapon hit harder again.',
    inputs: [
      { id: 'logicPack', count: 1 },
      { id: 'engineeringPack', count: 1 },
    ],
    cycles: 40,
    time: 8,
    requires: ['weaponsmithing', 'electricity'],
    effect: { kind: 'damage', amount: 0.1 },
    xp: 20,
    repeatable: true,
  },
  {
    id: 'gridCapacity',
    name: 'Grid Capacity',
    description: 'Never finishes. Each level raises every generator\'s output again.',
    inputs: [
      { id: 'engineeringPack', count: 1 },
      { id: 'powerPack', count: 1 },
    ],
    cycles: 60,
    time: 10,
    requires: ['steamPressure'],
    effect: { kind: 'power', amount: 0.1 },
    xp: 28,
    repeatable: true,
  },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

/** The tech that puts each gated machine on the palette. */
export const UNLOCKED_BY = new Map<MachineId, TechDef>(
  TECHS.flatMap((t) => (t.unlocks ?? []).map((id) => [id, t] as const)),
);

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
