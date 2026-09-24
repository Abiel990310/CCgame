import { createWorld } from '@shared/sim/world';
import { ITEMS } from '@shared/data/items';
import { MACHINES } from '@shared/data/machines';
import { tileKey } from '@shared/sim/grid';
import { clearBuriedNodes } from '@shared/sim/nodes';
import { INVENTORY_SLOTS } from '@shared/sim/inventory';
import { asStack, normalizeSlots } from '@shared/sim/slots';
import type {
  Belt,
  Building,
  Direction,
  ItemId,
  Machine,
  MachineId,
  OreKind,
  Player,
  ResourceNode,
  Slot,
  World,
} from '@shared/sim/types';
import { FACTORY_SUFFIX, ORE_SUFFIX, SCENERY_SUFFIX, SLOT_SUFFIXES, slotKey } from './saves';

const VERSION = 5;

/**
 * The header: everything that moves on every single save. Small enough that
 * rewriting it eight seconds apart costs nothing.
 *
 * Versions up to 3 also carried the whole island inline, which is why the
 * world fields below are still read — they are how an older save is loaded,
 * never how a new one is written.
 */
interface SaveFile {
  version: number;
  savedAt: number;
  seed: number;
  tick: number;
  time: number;
  phase: World['phase'];
  phaseTime: number;
  nightIndex: number;
  nextId: number;
  rngState: number;
  players: Player[];
  peaceful: boolean;
  /** Version 3 and older only. */
  nodes?: ResourceNode[];
  buildings?: Building[];
  belts?: Belt[];
  machines?: Machine[];
}

/**
 * The slow half of the island: what you built and how far the scenery has been
 * worked. Written only when one of them actually moved, which on a quiet
 * minute of play is never.
 */
interface ScenerySection {
  buildings: Building[];
  /** Nodes the seed grows that are no longer standing. */
  gone: number[];
  /** `[id, charges, regrow]` for a node that has been chopped but not cleared. */
  worn: [number, number, number][];
  /** Nodes the seed does not account for, so a delta cannot describe them. */
  extra: ResourceNode[];
}

/** `[itemId, count]`, or null for an empty cell. */
type PackedSlot = [ItemId, number] | null;
/** `[id, tx, ty, dir, item, offset, item, offset, ...]`. */
type PackedBelt = (number | ItemId)[];
type PackedMachine = [
  number,
  MachineId,
  number,
  number,
  Direction,
  string | null,
  number,
  PackedSlot[],
  PackedSlot[],
  /** An inserter's filter. Absent on a row packed before filters existed. */
  (ItemId | null)?,
  /**
   * What a miner is pulling up. Absent in version 4, where ore was endless.
   * It sits after the filter because islands already carry rows packed with
   * the filter at that position.
   */
  (OreKind | null)?,
  /** A splitter's two sides and whose turn it is; only a splitter has them. */
  ((ItemId | null)[])?,
  number?,
];

interface FactorySection {
  belts: PackedBelt[];
  machines: PackedMachine[];
}

/**
 * The ground miners have eaten into, as tile key to ore left. Only tiles that
 * differ from what the seed generates are in it, so a young island costs a
 * handful of entries and a long-running one still costs far less than the
 * whole grid. A save with no section at all is one whose patches are full,
 * which is exactly what every island made before version 5 is.
 */
type OreSection = Record<number, number>;

/**
 * Phase 2 persistence: one island split across three localStorage entries,
 * grouped by how often each part changes.
 *
 * The whole island used to go into one entry every eight seconds, about 110 kB
 * of JSON — and 109 kB of that was the resource nodes, which `createWorld`
 * derives from the seed and so never had to be stored at all. Nodes are now
 * regenerated on load and only their differences are kept, the factory is
 * packed into arrays instead of objects, and a section whose text has not
 * changed since the last save is not written again.
 *
 * Mobs, projectiles and loose pickups are still left out entirely: they are
 * transient, and regenerating them stops a save from resurrecting a night.
 */
export function saveWorld(world: World, slot: string): boolean {
  const file: SaveFile = {
    version: VERSION,
    savedAt: Date.now(),
    seed: world.seed,
    tick: world.tick,
    time: world.time,
    phase: world.phase,
    phaseTime: world.phaseTime,
    nightIndex: world.nightIndex,
    nextId: world.nextId,
    rngState: world.rngState,
    players: [...world.players.values()],
    peaceful: world.peaceful,
  };

  // Sections go down before the header. Neither order is atomic, but this one
  // fails towards a header that is a few seconds behind an island that is
  // fully written, rather than a header promising a factory that is not there.
  if (!writeSection(slot, SCENERY_SUFFIX, packScenery(world))) return false;
  if (!writeSection(slot, FACTORY_SUFFIX, packFactory(world))) return false;
  if (!writeSection(slot, ORE_SUFFIX, minedTiles(world))) return false;
  return writeSection(slot, '', file);
}

/** The tiles miners have taken from, diffed against what the seed generated. */
function minedTiles(world: World): OreSection {
  const out: OreSection = {};
  for (let i = 0; i < world.oreLeft.length; i++) {
    if (world.oreLeft[i] !== world.oreMax[i]) out[i] = world.oreLeft[i];
  }
  return out;
}

export function loadWorld(slot: string): World | null {
  const file = readSection<SaveFile>(slot, '');
  if (!file) return null;

  try {
    // A save from a future version is the only one we refuse, since we cannot
    // know what it means.
    if (!(file.version >= 1 && file.version <= VERSION)) return null;

    // Terrain, ore and scenery are all regenerated from the seed rather than
    // stored — they are large, and they are a pure function of the seed.
    const world = createWorld(file.seed, file.peaceful ?? false);
    const pristine = world.nodes;

    world.tick = file.tick;
    world.time = file.time;
    // Always wake up in daylight, however the session ended.
    world.phase = 'day';
    world.phaseTime = file.phase === 'day' ? file.phaseTime : 60;
    world.nightIndex = file.nightIndex;
    world.nextId = file.nextId;
    world.rngState = file.rngState;

    const scenery = readSection<ScenerySection>(slot, SCENERY_SUFFIX);
    // An older island carried its scenery in the header; a version 4 one has
    // only the differences from what the seed grows.
    world.nodes = file.nodes ?? applyScenery(pristine, scenery);
    world.buildings = file.buildings ?? scenery?.buildings ?? world.buildings;

    const factory = readSection<FactorySection>(slot, FACTORY_SUFFIX);
    world.belts = file.belts ?? (factory?.belts ?? []).map(unpackBelt);
    // A machine whose type no longer exists is dropped rather than taken as a
    // reason to refuse the whole island.
    world.machines = (file.machines ?? (factory?.machines ?? []).map(unpackMachine))
      .filter((m) => m.type in MACHINES)
      .map(loadMachine);

    applyMinedTiles(world, readSection<OreSection>(slot, ORE_SUFFIX));
    // The tile index is derived state, so rebuild it rather than storing it.
    rebuildGrid(world);
    // Older islands were built before scenery blocked placement, so they can
    // hold a tree standing inside a belt. The grid has to exist to spot them.
    clearBuriedNodes(world);
    world.players = new Map(file.players.map((p) => [p.id, p]));
    for (const player of world.players.values()) {
      player.downed = 0;
      player.hp = Math.max(player.hp, player.maxHp * 0.5);
      player.gatherNodeId = null;
      player.gatherProgress = 0;
      // Version 3 turned the bag into a fixed grid. Saves before it stored a
      // compacted list, which reads back as the first N slots of the grid.
      player.inventory = normalizeSlots(player.inventory, INVENTORY_SLOTS);
      player.cursor = asStack(player.cursor);
    }

    // The freshly generated nodes are what the next save diffs against, and we
    // have just built them, so hand them straight to the cache.
    rememberPristine(file.seed, pristine);
    return world;
  } catch {
    return null;
  }
}

/** Forget everything remembered about a slot, so its next save writes in full. */
export function forgetSlot(slot: string): void {
  for (const suffix of SLOT_SUFFIXES) written.delete(slotKey(slot) + suffix);
}

// --- Scenery -----------------------------------------------------------------

interface PristineNode {
  charges: number;
  regrow: number;
}

let pristineSeed: number | null = null;
let pristineNodes = new Map<number, PristineNode>();

function rememberPristine(seed: number, nodes: ResourceNode[]): void {
  pristineSeed = seed;
  pristineNodes = new Map(nodes.map((n) => [n.id, { charges: n.charges, regrow: n.regrow }]));
}

/**
 * What the seed grows on a fresh island, keyed by node id. Generating it means
 * building a whole world, so it is kept until the seed changes — which in
 * practice means once per island, and usually not even that, since a load has
 * already produced it.
 */
function pristine(seed: number): Map<number, PristineNode> {
  if (pristineSeed !== seed) rememberPristine(seed, createWorld(seed, true).nodes);
  return pristineNodes;
}

function packScenery(world: World): ScenerySection {
  const fresh = pristine(world.seed);
  const section: ScenerySection = {
    buildings: world.buildings,
    gone: [],
    worn: [],
    extra: [],
  };

  const standing = new Set<number>();
  for (const node of world.nodes) {
    const base = fresh.get(node.id);
    // A node the seed does not produce cannot be described as a difference
    // from it, so it is written out whole. This only happens when worldgen has
    // changed under an existing island.
    if (!base) {
      section.extra.push(node);
      continue;
    }
    standing.add(node.id);
    if (node.charges !== base.charges || node.regrow !== base.regrow) {
      section.worn.push([node.id, node.charges, round(node.regrow, 2)]);
    }
  }
  for (const id of fresh.keys()) if (!standing.has(id)) section.gone.push(id);

  return section;
}

function applyScenery(nodes: ResourceNode[], section: ScenerySection | null): ResourceNode[] {
  if (!section) return nodes;

  const gone = new Set(section.gone);
  const kept = nodes.filter((n) => !gone.has(n.id));
  const byId = new Map(kept.map((n) => [n.id, n]));
  for (const [id, charges, regrow] of section.worn ?? []) {
    const node = byId.get(id);
    if (!node) continue;
    node.charges = charges;
    node.regrow = regrow;
  }
  return [...kept, ...(section.extra ?? [])];
}

// --- Factory -----------------------------------------------------------------

function packBelt(belt: Belt): PackedBelt {
  const packed: PackedBelt = [belt.id, belt.tx, belt.ty, belt.dir];
  // Offsets are a position along one tile, so three decimals is finer than any
  // pixel the renderer can draw them at, and a good deal shorter than a float.
  for (const item of belt.items) packed.push(item.item, round(item.offset, 3));
  return packed;
}

function unpackBelt(packed: PackedBelt): Belt {
  const belt: Belt = {
    id: packed[0] as number,
    tx: packed[1] as number,
    ty: packed[2] as number,
    dir: packed[3] as Direction,
    items: [],
  };
  for (let i = 4; i + 1 < packed.length; i += 2) {
    belt.items.push({ item: packed[i] as ItemId, offset: packed[i + 1] as number });
  }
  return belt;
}

function packSlots(slots: Slot[]): PackedSlot[] {
  return slots.map((slot) => (slot ? [slot.id, slot.count] : null));
}

function unpackSlots(packed: PackedSlot[]): Slot[] {
  return (packed ?? []).map((slot) => (slot ? { id: slot[0], count: slot[1] } : null));
}

function packMachine(machine: Machine): PackedMachine {
  const packed: PackedMachine = [
    machine.id,
    machine.type,
    machine.tx,
    machine.ty,
    machine.dir,
    machine.recipe,
    round(machine.progress, 3),
    packSlots(machine.input),
    packSlots(machine.output),
    machine.filter,
    machine.ore,
  ];

  // Only a splitter has sides, so only a splitter pays for them in the file.
  if (MACHINES[machine.type].family === 'splitter') {
    packed[11] = machine.filters ?? [null, null];
    packed[12] = machine.turn ?? 0;
  }
  return packed;
}

function unpackMachine(packed: PackedMachine): Machine {
  const machine: Machine = {
    id: packed[0],
    type: packed[1],
    tx: packed[2],
    ty: packed[3],
    dir: packed[4],
    recipe: packed[5],
    progress: packed[6],
    input: unpackSlots(packed[7]),
    output: unpackSlots(packed[8]),
    filter: packed[9] ?? null,
    // A miner packed before ore ran out never recorded a kind; the simulation
    // reads it back off its own tile on the next tick.
    ore: packed[10] ?? null,
    // Recomputed by the factory system on the first tick after a load.
    stalled: false,
  };

  if (MACHINES[machine.type]?.family === 'splitter') {
    machine.filters = packed[11] ?? [null, null];
    machine.turn = packed[12] ?? 0;
  }
  return machine;
}

function packFactory(world: World): FactorySection {
  return { belts: world.belts.map(packBelt), machines: world.machines.map(packMachine) };
}

function applyMinedTiles(world: World, mined: OreSection | null): void {
  if (!mined) return;
  for (const [key, left] of Object.entries(mined)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= world.oreLeft.length) continue;
    // Clamp against what the seed generates: a hand-edited save cannot mint ore,
    // and a tile the generator no longer fills cannot come back holding some.
    const amount = Math.max(0, Math.min(world.oreMax[i], Math.floor(left) || 0));
    world.oreLeft[i] = amount;
    if (amount === 0) world.ore[i] = 0;
  }
}

/** Machine storage is a fixed grid too, sized by the machine's own definition. */
function loadMachine(machine: Machine): Machine {
  const def = MACHINES[machine.type];
  const loaded: Machine = {
    ...machine,
    // An island saved before filters existed simply has none.
    filter: loadFilter(machine),
    // Version 3 and older stored machines whole, and none of them had this.
    ore: machine.ore ?? null,
    input: normalizeSlots(machine.input, def.inputSlots, def.slotSize),
    output: normalizeSlots(machine.output, def.outputSlots, def.slotSize),
  };

  // A splitter always has exactly two sides. A filter naming an item that no
  // longer exists opens back up rather than refusing everything forever.
  if (def.family === 'splitter') {
    const saved = machine.filters ?? [];
    loaded.filters = [0, 1].map((i) => {
      const item = saved[i];
      return item && item in ITEMS ? item : null;
    });
    loaded.turn = machine.turn === 1 ? 1 : 0;
  }
  return loaded;
}

/** A filter naming an item this build no longer has is dropped, not honoured. */
function loadFilter(machine: Machine): ItemId | null {
  const filter = machine.filter as ItemId | null | undefined;
  if (!filter || MACHINES[machine.type].family !== 'inserter' || !(filter in ITEMS)) return null;
  return filter;
}

function rebuildGrid(world: World): void {
  world.grid.clear();
  for (const belt of world.belts) world.grid.set(tileKey(belt.tx, belt.ty), belt);
  for (const machine of world.machines) world.grid.set(tileKey(machine.tx, machine.ty), machine);
}

// --- Storage -----------------------------------------------------------------

/**
 * The text last put in each key, so a section that has not moved is not
 * serialised into storage again. It records what this tab believes storage
 * holds, which is why a load seeds it and a failed write clears it.
 */
const written = new Map<string, string>();

function writeSection(slot: string, suffix: string, value: unknown): boolean {
  const key = slotKey(slot) + suffix;
  const text = JSON.stringify(value);
  if (written.get(key) === text) return true;
  try {
    localStorage.setItem(key, text);
    written.set(key, text);
    return true;
  } catch {
    // A full or blocked storage quota must never take the game down. Forget
    // the key so the next save tries it again rather than assuming it landed.
    written.delete(key);
    return false;
  }
}

function readSection<T>(slot: string, suffix: string): T | null {
  const key = slotKey(slot) + suffix;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) {
    written.delete(key);
    return null;
  }
  try {
    const value = JSON.parse(raw) as T;
    written.set(key, raw);
    return value;
  } catch {
    written.delete(key);
    return null;
  }
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
