export type Vec2 = { x: number; y: number };

export type Terrain = 'deep' | 'water' | 'sand' | 'grass' | 'forest' | 'rock';

export type ResourceKind = 'tree' | 'rock' | 'bush' | 'fish';

export type ItemId =
  | 'wood'
  | 'stone'
  | 'fiber'
  | 'berry'
  | 'fish'
  | 'iron'
  | 'gold'
  | 'essence';

export type ToolKind = 'axe' | 'pick' | 'hand' | 'rod';

export type Phase = 'day' | 'night';

export interface ItemStack {
  id: ItemId;
  count: number;
}

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
}

export type WeaponId = 'sling' | 'bow' | 'spark' | 'thorn';

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
  inventory: ItemStack[];
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
  | { kind: 'mobDied'; pos: Vec2; type: MobTypeId }
  | { kind: 'levelUp'; playerId: number; level: number }
  | { kind: 'gathered'; pos: Vec2; item: ItemId }
  | { kind: 'phase'; phase: Phase; nightIndex: number }
  | { kind: 'playerHit'; playerId: number; amount: number }
  | { kind: 'downed'; playerId: number }
  | { kind: 'built'; pos: Vec2; type: BuildingId };
