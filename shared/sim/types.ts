export type Vec2 = { x: number; y: number };

export type Terrain = 'deep' | 'water' | 'sand' | 'grass' | 'forest' | 'rock';

export type ResourceKind = 'tree' | 'rock' | 'bush' | 'fish';

export type ItemId =
  // Hand-gathered
  | 'wood'
  | 'stone'
  | 'fiber'
  | 'berry'
  | 'fish'
  | 'iron'
  | 'gold'
  | 'essence'
  // Mined by machines
  | 'ironOre'
  | 'copperOre'
  | 'coal'
  // Smelted
  | 'ironPlate'
  | 'copperPlate'
  | 'steelPlate'
  // Assembled
  | 'gear'
  | 'wire'
  | 'circuit'
  | 'battery'
  | 'motor'
  | 'advancedCircuit'
  // Consumed by labs
  | 'researchPack'
  | 'logicPack'
  | 'powerPack'
  | 'resonancePack';

export type ToolKind = 'axe' | 'pick' | 'hand' | 'rod';

export type Phase = 'day' | 'night';

export interface ItemStack {
  id: ItemId;
  count: number;
}

/** One cell of a bag, chest or machine grid. Empty cells stay put as `null`. */
export type Slot = ItemStack | null;

export interface ResourceNode {
  id: number;
  kind: ResourceKind;
  pos: Vec2;
  /** Cosmetic variation, kept in the sim so every client draws it identically. */
  seed: number;
  /** Yields remaining before the node depletes. */
  charges: number;
  maxCharges: number;
  /** Seconds until a depleted node regrows. */
  regrow: number;
}

export interface Mob {
  id: number;
  type: MobTypeId;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  /** Seconds until this mob can deal contact damage again. */
  attackCd: number;
  /** Cosmetic wobble seed. */
  seed: number;
  hitFlash: number;
}

export type MobTypeId = 'slime' | 'crawler' | 'brute' | 'wisp';

export interface Projectile {
  id: number;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  life: number;
  ownerId: number;
  /** Weapon that fired it, so the renderer can style it. */
  weapon: WeaponId;
  pierce: number;
  /**
   * Mob this was aimed at, until it hits anything. Lets later volleys see the
   * damage already on its way and pick someone else instead of overkilling.
   */
  targetId?: number;
}

export type WeaponId = 'sling' | 'bow' | 'spark' | 'thorn';

/** How a weapon chooses among the mobs in range. */
export type TargetRule = 'nearest' | 'toughest' | 'scatter' | 'line';

export interface WeaponState {
  id: WeaponId;
  level: number;
  cooldown: number;
}

export interface Pickup {
  id: number;
  pos: Vec2;
  vel: Vec2;
  item: ItemId | null;
  count: number;
  xp: number;
  /** Seconds before it can be vacuumed, so drops visibly scatter first. */
  settle: number;
}

export type BuildingId = 'campfire' | 'chest' | 'workbench' | 'wall' | 'lamp' | 'dryer';

export interface Building {
  id: number;
  type: BuildingId;
  pos: Vec2;
  level: number;
}

export interface UpgradeOffer {
  id: string;
  title: string;
  description: string;
}

export interface Player {
  id: number;
  name: string;
  pos: Vec2;
  vel: Vec2;
  /** Last non-zero facing, used for aiming and drawing. */
  facing: Vec2;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** Queued level-ups waiting for the player to pick an upgrade. */
  pendingUpgrades: number;
  offers: UpgradeOffer[];
  /** Fixed grid of `INVENTORY_SLOTS` cells, arranged by the player. */
  inventory: Slot[];
  /** The stack held on the pointer while rearranging. Saved, so it is never lost. */
  cursor: Slot;
  weapons: WeaponState[];
  stats: PlayerStats;
  dashCd: number;
  dashTime: number;
  invuln: number;
  downed: number;
  /** Node currently being harvested, with accumulated progress. */
  gatherNodeId: number | null;
  gatherProgress: number;
  hitFlash: number;
}

export interface PlayerStats {
  damage: number;
  fireRate: number;
  moveSpeed: number;
  gatherSpeed: number;
  pickupRadius: number;
  maxHp: number;
  /** Extra projectiles per shot. */
  multishot: number;
  /** Flat HP regenerated per second. */
  regen: number;
  xpGain: number;
}

export interface PlayerInput {
  /** Normalised movement axis, -1..1 on each component. */
  move: Vec2;
  dash: boolean;
  /** Held to harvest the nearest resource node. */
  interact: boolean;
}

/** Grid-aligned facing. Belts flow this way; machines output this way. */
export type Direction = 0 | 1 | 2 | 3;

export type OreKind = 'ironOre' | 'copperOre' | 'coal';

/**
 * What a machine fundamentally is. Every tier of a machine shares its family's
 * recipes, its tick and its silhouette, so anything that switches on the kind
 * of machine switches on this rather than on the type.
 */
export type MachineFamily =
  | 'miner'
  | 'furnace'
  | 'assembler'
  | 'chest'
  | 'inserter'
  | 'splitter'
  | 'lab'
  | 'fishTrap';

export type MachineId =
  | MachineFamily
  | 'minerMk2'
  | 'minerMk3'
  | 'furnaceMk2'
  | 'furnaceMk3'
  | 'assemblerMk2'
  | 'assemblerMk3'
  | 'longInserter'
  | 'fastInserter'
  | 'stackInserter'
  | 'steelChest';

/** One item riding a belt tile, positioned 0..1 along its length. */
export interface BeltItem {
  item: ItemId;
  /** Distance travelled along this tile, 0 at the back, 1 at the front. */
  offset: number;
}

export interface Belt {
  id: number;
  tx: number;
  ty: number;
  dir: Direction;
  /** Ordered front-to-back; index 0 is closest to the output end. */
  items: BeltItem[];
}

export interface Machine {
  id: number;
  type: MachineId;
  tx: number;
  ty: number;
  dir: Direction;
  /** Chosen recipe, or null for machines that have no choice to make. */
  recipe: string | null;
  /** Inserters only: the one item this arm will move, or null for anything. */
  filter: ItemId | null;
  /**
   * What a miner is pulling up, remembered rather than read off its own tile:
   * once that tile runs dry the miner keeps working the ring around it, and it
   * must not start mixing a neighbouring patch's ore into the same output.
   */
  ore: OreKind | null;
  /** Seconds of crafting accumulated toward the current recipe. */
  progress: number;
  /** Fixed grids, sized by the machine's `inputSlots` and `outputSlots`. */
  input: Slot[];
  output: Slot[];
  /** True when the machine could not run last tick, for the renderer. */
  stalled: boolean;
  /**
   * A splitter's two output sides, left first, or a chest's slots one for one:
   * the item each takes, where null takes anything. Absent on every other
   * machine, so saves stay small.
   */
  filters?: (ItemId | null)[];
  /** Splitter only: which of the two sides the next item is offered to. */
  turn?: number;
  /** Burners only: the fuel grid, sized by the machine's `fuelSlots`. */
  fuel?: Slot[];
  /**
   * Burners only: seconds of recipe work left from the fuel already burned.
   * Kept apart from the grid so a craft paid for by one coal does not need a
   * second one the moment the grid is empty.
   */
  heat?: number;
}

/**
 * What the island has learned. Research belongs to the world rather than to a
 * player: a lab is a building, and once multiplayer lands everyone standing on
 * the island is feeding the same tree.
 */
export interface Research {
  /** The tech labs are working on, or null when nothing is queued. */
  current: string | null;
  /** Cycles banked toward each tech. Kept per tech, so switching loses nothing. */
  progress: Record<string, number>;
  /** Times each tech has been completed. A repeatable tech counts up. */
  levels: Record<string, number>;
  /**
   * True on an island that was built before the palette was gated, so every
   * machine stays buildable there whatever it has researched. Taking away a
   * piece someone already built a factory out of breaks the promise that
   * nothing on an island is ever lost.
   */
  unlockedAll: boolean;
}

export interface World {
  tick: number;
  time: number;
  seed: number;
  /** Row-major terrain grid, MAP_TILES * MAP_TILES entries. */
  terrain: Uint8Array;
  phase: Phase;
  /** Seconds remaining in the current phase. */
  phaseTime: number;
  nightIndex: number;
  players: Map<number, Player>;
  mobs: Mob[];
  projectiles: Projectile[];
  pickups: Pickup[];
  nodes: ResourceNode[];
  buildings: Building[];
  camp: Vec2;
  /** Row-major ore grid; 0 means no ore. Parallel to `terrain`. */
  ore: Uint8Array;
  /**
   * Ore left in each tile, parallel to `ore`. Patches are finite: a tile that
   * reaches zero has its entry in `ore` cleared too, so everything that only
   * asks what a tile holds keeps working without knowing about amounts.
   */
  oreLeft: Uint16Array;
  /** What each tile held when the island was made, so a save can store a diff. */
  oreMax: Uint16Array;
  belts: Belt[];
  machines: Machine[];
  /**
   * Tile lookup for belts and machines, keyed by tileKey(tx, ty). Holds the
   * entity itself: belts hand off every tick, so this has to be O(1) rather
   * than a scan of every belt and machine on the island. Rebuilt on load
   * rather than saved, since it is derived state.
   */
  grid: Map<number, Belt | Machine>;
  /** Techs finished and the one being researched now. */
  research: Research;
  /** When true this world has no night raids; the factory is the whole game. */
  peaceful: boolean;
  /** Spawn budget left to release during the current night. */
  waveBudget: number;
  wavePulse: number;
  nextId: number;
  rngState: number;
  /** Transient, renderer-facing events produced by the last step. */
  events: SimEvent[];
}

export type SimEvent =
  | { kind: 'hit'; pos: Vec2; amount: number }
  | { kind: 'shot'; pos: Vec2; weapon: WeaponId }
  | { kind: 'collected'; pos: Vec2; item: ItemId | null }
  | { kind: 'produced'; pos: Vec2; machine: MachineId; item: ItemId }
  | { kind: 'placed'; pos: Vec2; what: MachineId | 'belt' }
  | { kind: 'removed'; pos: Vec2 }
  | { kind: 'mobDied'; pos: Vec2; type: MobTypeId }
  | { kind: 'levelUp'; playerId: number; level: number }
  | { kind: 'gathered'; pos: Vec2; item: ItemId }
  | { kind: 'phase'; phase: Phase; nightIndex: number }
  | { kind: 'playerHit'; playerId: number; amount: number }
  | { kind: 'downed'; playerId: number }
  | { kind: 'built'; pos: Vec2; type: BuildingId }
  | { kind: 'research'; tech: string; level: number; next: string | null }
  | { kind: 'oreChanged'; tx: number; ty: number };
