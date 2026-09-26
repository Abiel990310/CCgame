/**
 * Central tuning table. Everything a designer would want to twist lives here so
 * balance changes never require hunting through simulation code.
 */

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

/** World is a square grid of tiles; all positions are in world units. */
export const TILE = 32;
/**
 * The side of the island in tiles. It depends on the generation that grew the
 * island — older islands keep the size they were built at — so it is set by
 * `createWorld` and read everywhere through these live bindings. One process
 * simulates one island at a time, which is also how a hosted world will run.
 */
export let MAP_TILES = 96;
export let MAP_SIZE = MAP_TILES * TILE;
export let MAP_CENTER = MAP_SIZE / 2;

export function setMapTiles(tiles: number): void {
  MAP_TILES = tiles;
  MAP_SIZE = tiles * TILE;
  MAP_CENTER = MAP_SIZE / 2;
}

export const PLAYER = {
  radius: 11,
  speed: 190,
  /** How sharply velocity chases the input direction (higher = snappier). */
  accel: 14,
  maxHp: 100,
  /** Contact damage is applied at most this often, per mob. */
  invulnAfterHit: 0.5,
  pickupRadius: 46,
  interactRadius: 52,
  reviveSeconds: 4,
} as const;

export const DASH = {
  speed: 620,
  duration: 0.16,
  cooldown: 1.6,
} as const;

export const CYCLE = {
  daySeconds: 180,
  nightSeconds: 60,
  /** Dawn/dusk blend length, purely cosmetic but shared so both sides agree. */
  twilightSeconds: 8,
} as const;

export const CAMP = {
  /** Mobs path toward the camp; it is the anchor of the whole island. */
  defendRadius: 150,
  buildRadius: 260,
  /** Chips a mob has to take out of a wall before it falls. */
  wallHp: 4,
} as const;

export const GATHER = {
  /** Base seconds to harvest one yield from a node, before tool tier. */
  baseSeconds: 1.4,
  /** Node stops giving after this many yields, then regrows. */
  regrowSeconds: 45,
} as const;

/**
 * The player's own swing, on top of the weapons that fire themselves: three
 * hits that chain if pressed in rhythm, the last one heavier and throwing
 * creatures back.
 */
export const MELEE = {
  /** Reach from the player's centre to the edge of what it hits. */
  range: 40,
  /** Width of the swing in radians. */
  arc: 2.1,
  /** Damage of each hit of the combo, before stats and research. */
  damage: [9, 9, 20],
  /** How hard each hit shoves what it catches. */
  knock: [220, 220, 520],
  /** How long each swing shows, in seconds. */
  duration: 0.24,
  /** Seconds between swings, per hit of the combo; the finisher recovers longer. */
  cooldown: [0.3, 0.3, 0.55],
  /** Seconds after a swing in which the next press continues the combo. */
  window: 0.5,
  /** A creature this much further out still turns the player toward it. */
  assist: 30,
  /** Seconds of holding attack after a swing that wind up the heavy slam. */
  chargeTime: 0.55,
  /** The slam: all the way round, hard, and throws everything back. */
  slamRadius: 62,
  slamDamage: 30,
  slamKnock: 620,
  slamCooldown: 0.7,
  /**
   * Seconds after a swing starts in which a blow that lands is parried: no
   * damage, and the attacker is thrown back and left dazed.
   */
  parry: 0.18,
  /** How long a parried creature cannot bite again. */
  daze: 1.6,
  parryKnock: 420,
  parryDamage: 12,
} as const;

export const COMBAT = {
  /** Seconds a projectile lives before expiring. */
  projectileLife: 1.4,
  /** Mobs beyond this range from any player stop being simulated in detail. */
  activeRange: 1400,
} as const;

export const XP = {
  /** XP needed for level n is base * n^exponent. */
  base: 8,
  exponent: 1.35,
  upgradeChoices: 3,
} as const;

/** Night difficulty ramps with the night index and the number of players. */
export const WAVES = {
  baseBudget: 6,
  budgetPerNight: 4,
  budgetPerExtraPlayer: 5,
  /**
   * The quadratic part of the budget. A player's power compounds (levels,
   * perks, weapon tiers), so a straight-line budget made night 9 easier than
   * night 5 and night 20 a stroll.
   */
  budgetPerNightSq: 0.3,
  /** Creatures toughen from this night on, so late nights are fewer, bigger fights rather than only more of them. */
  hardenFrom: 6,
  /** Extra health per night past `hardenFrom`, as a share of the creature's base. */
  hardenPerNight: 0.08,
  /** Extra health a boss carries each time it has come back before. */
  bossReturnHp: 0.6,
  /** Seconds between spawn pulses during a night. */
  pulseInterval: 4,
} as const;

/**
 * Ore patches are finite. A tile holds enough to keep one miner fed for a long
 * session, and a whole patch for hours, so running one dry is an event a player
 * plans around rather than a chore they do every few minutes.
 */
export const ORE = {
  /** Ore in the richest tile of a patch — the ones at its centre. */
  tileAmount: 800,
  /** Share of that a tile on the patch's rim holds instead. */
  edgeShare: 0.35,
  /**
   * How far a miner works out from the tile it stands on. Draining only its own
   * tile would have a miner move every quarter of an hour, which is tedium
   * rather than the expansion depletion is supposed to drive.
   */
  minerReach: 1,
} as const;
