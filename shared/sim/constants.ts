/**
 * Central tuning table. Everything a designer would want to twist lives here so
 * balance changes never require hunting through simulation code.
 */

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

/** World is a square grid of tiles; all positions are in world units. */
export const TILE = 32;
export const MAP_TILES = 96;
export const MAP_SIZE = MAP_TILES * TILE;
export const MAP_CENTER = MAP_SIZE / 2;

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
} as const;

export const GATHER = {
  /** Base seconds to harvest one yield from a node, before tool tier. */
  baseSeconds: 1.4,
  /** Node stops giving after this many yields, then regrows. */
  regrowSeconds: 45,
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
  /** Seconds between spawn pulses during a night. */
  pulseInterval: 4,
} as const;
