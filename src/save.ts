import { WORLDGEN, createWorld } from '@shared/sim/world';
import { ITEMS } from '@shared/data/items';
import { HAUL, MACHINES } from '@shared/data/machines';
import { repairHaulLinks } from '@shared/sim/factory';
import { TECH_BY_ID } from '@shared/data/techs';
import { backfillPrerequisites, newResearch, pruneResearchQueue } from '@shared/sim/research';
import { goalMarker, restoreGoal } from '@shared/sim/goals';
import { tileKey } from '@shared/sim/grid';
import { clearBuriedNodes } from '@shared/sim/nodes';
import { carrySlots } from '@shared/sim/inventory';
import { BAG_MAX } from '@shared/data/items';
import { asStack, normalizeSlots } from '@shared/sim/slots';
import { normalizeModules } from '@shared/sim/modules';
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
import { EXPLORED_SUFFIX, FACTORY_SUFFIX, ORE_SUFFIX, SCENERY_SUFFIX, SLOT_SUFFIXES, slotKey } from './saves';
import { packExplored, reveal, unpackExplored } from '@shared/sim/explore';
import { sanitizePins } from '@shared/sim/pins';

const VERSION = 7;

/**
 * The first version whose islands earn their machines through research. Every
 * island saved before it was built with the whole palette on offer, and keeps
 * it.
 */
const GATED_SINCE = 7;

/** A player as a save holds them; see `SaveFile.players`. */
type SavedPlayer = Omit<Player, 'goal'> & { goal?: string | number };

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
  /** A player as saved: the goal is its id, or on an older island its place in the chain. */
  players: SavedPlayer[];
  peaceful: boolean;
  /**
   * The worldgen that grew this island's terrain, ore and scenery. Version 6
   * and newer; every island saved before it was grown by generation 1.
   */
  worldgen?: number;
  /**
   * Version 5 and newer. An older island has researched nothing. From version
   * 7 it also says whether the island predates the gated palette.
   */
  research?: World['research'];
  /** Map pins. Absent on an island saved before they existed, which has none. */
  pins?: World['pins'];
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
  /**
   * A splitter's two sides, or a chest's slot filters. Absent on a chest packed
   * before chests had filters, and on a chest with none set.
   */
  ((ItemId | null)[])?,
  /** Whose turn it is on a splitter or a merger; nothing else has one. */
  number?,
  /**
   * A burner's fuel grid and the heat left in it. Only a burner has them, and
   * any other row stops before this point, so older islands read as unfuelled.
   */
  PackedSlot[]?,
  number?,
  /**
   * A tier 3 machine's module grid and the free craft it has banked. Rows
   * packed before modules existed stop earlier, and read as empty slots.
   */
  PackedSlot[]?,
  number?,
  /** A long-haul port's partner. Absent on a sender still waiting for one. */
  number?,
  /** A long-haul sender's parcels in flight, as item and seconds left pairs. */
  (ItemId | number)[]?,
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
    worldgen: world.worldgen,
    tick: world.tick,
    time: world.time,
    phase: world.phase,
    phaseTime: world.phaseTime,
    nightIndex: world.nightIndex,
    nextId: world.nextId,
    rngState: world.rngState,
    // The goal goes down as an id, so the chain can grow in the middle.
    players: [...world.players.values()].map((p) => ({ ...p, goal: goalMarker(p) })),
    peaceful: world.peaceful,
    research: world.research,
    pins: world.pins,
  };

  // Sections go down before the header. Neither order is atomic, but this one
  // fails towards a header that is a few seconds behind an island that is
  // fully written, rather than a header promising a factory that is not there.
  if (!writeSection(slot, SCENERY_SUFFIX, packScenery(world))) return false;
  if (!writeSection(slot, FACTORY_SUFFIX, packFactory(world))) return false;
  if (!writeSection(slot, ORE_SUFFIX, minedTiles(world))) return false;
  if (!writeSection(slot, EXPLORED_SUFFIX, packExplored(world.explored))) return false;
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

/** What a load had to do beyond reading the island back. */
export interface LoadNotes {
  /**
   * The island was grown by an older worldgen, so its scenery and ore are
   * today's generator's rather than the ones it was saved with.
   */
  regenerated?: boolean;
}

export function loadWorld(slot: string, notes: LoadNotes = {}): World | null {
  const file = readSection<SaveFile>(slot, '');
  if (!file) return null;

  try {
    // A save from a future version is the only one we refuse, since we cannot
    // know what it means.
    if (!(file.version >= 1 && file.version <= VERSION)) return null;
    const generation = file.worldgen ?? 1;
    if (!(generation >= 1 && generation <= WORLDGEN)) return null;
    // Every generation the game has shipped is still here, so an island is
    // regrown by the generator that made it: same size, same ground, and its
    // scenery and ore deltas land on the tiles they were written against.
    const sameGround = true;
    notes.regenerated = false;

    // Terrain, ore and scenery are all regenerated from the seed rather than
    // stored — they are large, and they are a pure function of the seed.
    const world = createWorld(file.seed, file.peaceful ?? false, generation);
    const pristine = world.nodes;

    world.tick = file.tick;
    world.time = file.time;
    // Always wake up in daylight, however the session ended.
    world.phase = 'day';
    world.phaseTime = file.phase === 'day' ? file.phaseTime : 60;
    world.nightIndex = file.nightIndex;
    world.nextId = file.nextId;
    world.rngState = file.rngState;
    world.research = loadResearch(file.research, file.version);
    world.pins = sanitizePins(file.pins, file.nextId);

    const scenery = readSection<ScenerySection>(slot, SCENERY_SUFFIX);
    // An older island carried its scenery in the header; a version 4 one has
    // only the differences from what the seed grows.
    world.nodes = file.nodes ?? (sameGround ? applyScenery(pristine, scenery) : pristine);
    world.buildings = file.buildings ?? scenery?.buildings ?? world.buildings;

    const factory = readSection<FactorySection>(slot, FACTORY_SUFFIX);
    world.belts = (file.belts ?? (factory?.belts ?? []).map(unpackBelt)).map(loadBelt);
    // A machine whose type no longer exists is dropped rather than taken as a
    // reason to refuse the whole island.
    world.machines = (file.machines ?? (factory?.machines ?? []).map(unpackMachine))
      .filter((m) => m.type in MACHINES)
      .map(loadMachine);
    repairHaulLinks(world);

    const mined = readSection<OreSection>(slot, ORE_SUFFIX);
    if (sameGround) applyMinedTiles(world, mined);
    // The tile index is derived state, so rebuild it rather than storing it.
    rebuildGrid(world);
    // Older islands were built before scenery blocked placement, so they can
    // hold a tree standing inside a belt. The grid has to exist to spot them.
    clearBuriedNodes(world);
    const savedGoals = new Map(file.players.map((p) => [p.id, p.goal]));
    world.players = new Map(file.players.map((p) => [p.id, { ...p, goal: 0 }]));

    const explored = readSection<string>(slot, EXPLORED_SUFFIX);
    if (typeof explored === 'string') world.explored = unpackExplored(explored, world.terrain.length);
    else {
      // An island from before the map was drawn: show what its owner built and
      // where they stand, and leave the rest to be found.
      for (const piece of [...world.belts, ...world.machines]) reveal(world, (piece.tx + 0.5) * 32, (piece.ty + 0.5) * 32, 6);
      for (const building of world.buildings) reveal(world, building.pos.x, building.pos.y, 6);
      for (const player of world.players.values()) reveal(world, player.pos.x, player.pos.y);
    }

    for (const player of world.players.values()) {
      player.downed = 0;
      player.hp = Math.max(player.hp, player.maxHp * 0.5);
      player.gatherNodeId = null;
      player.gatherProgress = 0;
      // Version 3 turned the bag into a fixed grid. Saves before it stored a
      // compacted list, which reads back as the first N slots of the grid.
      // A bag count that is not a whole number in range reads as none sewn on.
      const bag = player.bag;
      if (typeof bag !== 'number' || !Number.isInteger(bag) || bag < 0 || bag > BAG_MAX) player.bag = 0;
      player.inventory = normalizeSlots(player.inventory, carrySlots(world, player));
      player.cursor = asStack(player.cursor);
      // A goal is saved as its id, or on an older island as its place in the
      // chain as it was then; missing, it is the first goal not yet met.
      restoreGoal(world, player, savedGoals.get(player.id));
    }

    // The freshly generated nodes are what the next save diffs against, and we
    // have just built them, so hand them straight to the cache.
    rememberPristine(file.seed, generation, pristine);
    return world;
  } catch {
    return null;
  }
}

/**
 * Research read back defensively: a tech that no longer exists is dropped
 * rather than left pointing the island's labs at nothing, and a level or a
 * cycle count that is not a number is read as none. An island from before the
 * palette was gated keeps every machine it could already build.
 */
function loadResearch(
  raw: World['research'] | undefined,
  version: number,
): World['research'] {
  const research = newResearch();
  research.unlockedAll = version < GATED_SINCE || raw?.unlockedAll === true;
  if (!raw || typeof raw !== 'object') return research;

  for (const [id, level] of Object.entries(raw.levels ?? {})) {
    if (TECH_BY_ID.has(id) && typeof level === 'number' && level > 0) {
      research.levels[id] = Math.floor(level);
    }
  }
  for (const [id, done] of Object.entries(raw.progress ?? {})) {
    if (TECH_BY_ID.has(id) && typeof done === 'number' && done > 0) {
      research.progress[id] = Math.floor(done);
    }
  }
  if (typeof raw.current === 'string' && TECH_BY_ID.has(raw.current)) {
    research.current = raw.current;
  }
  if (Array.isArray(raw.queue)) {
    research.queue = raw.queue.filter((id): id is string => typeof id === 'string' && TECH_BY_ID.has(id));
  }
  backfillPrerequisites(research);
  // Pointing the labs at a tech that has just been granted would waste them.
  if (research.current && (research.levels[research.current] ?? 0) > 0 && !TECH_BY_ID.get(research.current)?.repeatable) {
    research.current = null;
  }
  // Islands saved before the queue load with an empty one, and a queue edited
  // by hand is cut back to what the labs can actually reach in that order.
  pruneResearchQueue(research);
  return research;
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
let pristineGen = 0;
let pristineNodes = new Map<number, PristineNode>();

/**
 * A world just made from its seed is exactly what the seed grows, so the
 * first save can diff against it instead of growing the island a second time.
 * On a big island that regeneration was a visible hitch a few seconds in, when
 * the first autosave landed: about 45 ms on a desktop, several times that on
 * a phone.
 */
export function rememberNewIsland(world: World): void {
  rememberPristine(world.seed, world.worldgen, world.nodes);
}

function rememberPristine(seed: number, worldgen: number, nodes: ResourceNode[]): void {
  pristineSeed = seed;
  pristineGen = worldgen;
  pristineNodes = new Map(nodes.map((n) => [n.id, { charges: n.charges, regrow: n.regrow }]));
}

/**
 * What the seed grows on a fresh island, keyed by node id. Generating it means
 * building a whole world, so it is kept until the seed changes — which in
 * practice means once per island, and usually not even that, since a load has
 * already produced it.
 */
function pristine(seed: number, worldgen: number): Map<number, PristineNode> {
  if (pristineSeed !== seed || pristineGen !== worldgen) {
    rememberPristine(seed, worldgen, createWorld(seed, true, worldgen).nodes);
  }
  return pristineNodes;
}

function packScenery(world: World): ScenerySection {
  const fresh = pristine(world.seed, world.worldgen);
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

/**
 * A belt's tier rides in its facing slot: the facing is 0 to 3 and each tier
 * above the first adds 4. A row packed before tiers has a plain facing, so it
 * reads as a Mk1 with nothing to migrate, and the items after it keep their
 * place in the row.
 */
function packBelt(belt: Belt): PackedBelt {
  const packed: PackedBelt = [belt.id, belt.tx, belt.ty, belt.dir + 4 * ((belt.tier ?? 1) - 1)];
  // Offsets are a position along one tile, so three decimals is finer than any
  // pixel the renderer can draw them at, and a good deal shorter than a float.
  for (const item of belt.items) packed.push(item.item, round(item.offset, 3));
  return packed;
}

/** Only a tier this build has survives a load; anything else is a plain belt. */
function loadBelt(belt: Belt): Belt {
  if (belt.tier === 2 || belt.tier === 3) return belt;
  const { tier: _unknown, ...plain } = belt;
  return plain;
}

function unpackBelt(packed: PackedBelt): Belt {
  const belt: Belt = {
    id: packed[0] as number,
    tx: packed[1] as number,
    ty: packed[2] as number,
    dir: ((packed[3] as number) % 4) as Direction,
    items: [],
  };
  const tier = Math.floor((packed[3] as number) / 4) + 1;
  if (tier === 2 || tier === 3) belt.tier = tier;
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
  // A merger has no sides to filter, so its turn sits after an empty gap.
  if (MACHINES[machine.type].family === 'merger') packed[12] = machine.turn ?? 0;
  // A chest nobody has filtered writes nothing extra, which is most chests.
  if (MACHINES[machine.type].family === 'chest' && machine.filters?.some((f) => f !== null)) {
    packed[11] = machine.filters;
  }
  if (machine.fuel) {
    packed[13] = packSlots(machine.fuel);
    packed[14] = round(machine.heat ?? 0, 3);
  }
  if (machine.modules) {
    packed[15] = packSlots(machine.modules);
    packed[16] = round(machine.bonus ?? 0, 4);
  }
  if (machine.link !== undefined) packed[17] = machine.link;
  if (machine.transit && machine.transit.length > 0) {
    const flat: (ItemId | number)[] = [];
    for (const parcel of machine.transit) flat.push(parcel.item, round(parcel.left, 2));
    packed[18] = flat;
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
  if (MACHINES[machine.type]?.family === 'merger') machine.turn = packed[12] ?? 0;
  if (MACHINES[machine.type]?.family === 'chest' && packed[11]) machine.filters = packed[11];
  if (packed[13]) {
    machine.fuel = unpackSlots(packed[13]);
    machine.heat = packed[14] ?? 0;
  }
  if (packed[15]) {
    machine.modules = unpackSlots(packed[15]);
    machine.bonus = packed[16] ?? 0;
  }
  if (packed[17] !== undefined && packed[17] !== null) machine.link = packed[17];
  if (packed[18]) {
    machine.transit = [];
    for (let i = 0; i + 1 < packed[18].length; i += 2) {
      machine.transit.push({ item: packed[18][i] as ItemId, left: packed[18][i + 1] as number });
    }
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
  if (def.family === 'merger') {
    const turn = machine.turn ?? 0;
    loaded.turn = turn === 1 || turn === 2 ? turn : 0;
  }
  // A chest has one filter per slot, whatever its grid was when it was saved.
  if (def.family === 'chest') {
    const saved = machine.filters ?? [];
    loaded.filters = loaded.input.map((_, i) => {
      const item = saved[i];
      return item && item in ITEMS ? item : null;
    });
  }

  // Long-haul links and parcels belong to ports alone, and a parcel naming an
  // item this build no longer has is dropped rather than delivered.
  if (def.haul) {
    const link = machine.link;
    if (Number.isInteger(link)) loaded.link = link;
    else delete loaded.link;
    if (def.haul === 'in') {
      loaded.transit = (machine.transit ?? [])
        .filter((p) => p && p.item in ITEMS && typeof p.left === 'number' && p.left >= 0)
        .slice(0, HAUL.capacity);
    } else delete loaded.transit;
  } else {
    delete loaded.link;
    delete loaded.transit;
  }

  // A machine that became a burner after it was built starts with an empty
  // grid and no heat, and one that stopped being one hands nothing back: the
  // table decides, never the save.
  if (def.fuelSlots > 0) {
    loaded.fuel = normalizeSlots(machine.fuel ?? [], def.fuelSlots, def.slotSize);
    loaded.heat = typeof machine.heat === 'number' && machine.heat > 0 ? machine.heat : 0;
  } else {
    delete loaded.fuel;
    delete loaded.heat;
  }
  // Module slots come from the table too, so an island built before modules
  // finds its tier 3 machines with empty slots waiting.
  if (def.moduleSlots) {
    loaded.modules = normalizeModules(machine.modules ?? [], def.moduleSlots);
    const bonus = machine.bonus;
    loaded.bonus = typeof bonus === 'number' && bonus > 0 && bonus < 1 ? bonus : 0;
  } else {
    delete loaded.modules;
    delete loaded.bonus;
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
