import type { MobTypeId } from '../sim/types';

export interface MobDef {
  id: MobTypeId;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
  /** Wave-budget cost, so harder nights field tougher mixes. */
  cost: number;
  /** Earliest night this type can appear. */
  minNight: number;
  color: string;
  accent: string;
  /** Taken off every hit before it lands, never below one: chip damage stops mattering. */
  armor?: number;
  /** Keeps its distance and spits instead of closing in. */
  spit?: { range: number; interval: number; speed: number; damage: number };
  /** Bursts into smaller mobs when it dies. */
  splits?: { into: MobTypeId; count: number };
  /** Calls a few of these in around itself every `interval` seconds while it lives. */
  summons?: { into: MobTypeId; count: number; interval: number };
  /**
   * Never bought from a night's budget: one walks in at the start of every
   * night that is a multiple of this, once it has reached `minNight`.
   */
  bossEvery?: number;
  /** Shifts which nights a boss walks in on: those where (night - phase) is a multiple of `bossEvery`. */
  bossPhase?: number;
  /**
   * Wards every other creature within `radius`: while it lives they take only
   * `take` of each hit. The fight is reaching it through what it covers.
   */
  shields?: { radius: number; take: number };
  /** A boss's line under its name when it walks in. */
  epithet?: string;
  /** Orbs it drops, and the share of them that are essence. Default 1–2 at a quarter. */
  loot?: { orbs: number; essence: number };
}

export const MOBS: Record<MobTypeId, MobDef> = {
  slime: {
    id: 'slime',
    name: 'Slime',
    hp: 14,
    speed: 42,
    damage: 6,
    radius: 13,
    xp: 3,
    cost: 1,
    minNight: 1,
    color: '#6fc98a',
    accent: '#4ea36a',
  },
  crawler: {
    id: 'crawler',
    name: 'Crawler',
    hp: 22,
    speed: 72,
    damage: 8,
    radius: 12,
    xp: 5,
    cost: 2,
    minNight: 2,
    color: '#d8925a',
    accent: '#a96a3c',
  },
  wisp: {
    id: 'wisp',
    name: 'Wisp',
    hp: 16,
    speed: 88,
    damage: 5,
    radius: 11,
    xp: 7,
    cost: 3,
    minNight: 3,
    color: '#9c8cf0',
    accent: '#6f5fc4',
  },
  brute: {
    id: 'brute',
    name: 'Brute',
    hp: 70,
    speed: 34,
    damage: 14,
    radius: 20,
    xp: 16,
    cost: 5,
    minNight: 4,
    color: '#c45c6a',
    accent: '#8e3c4a',
  },
  spitter: {
    id: 'spitter',
    name: 'Spitter',
    hp: 20,
    speed: 58,
    damage: 4,
    radius: 12,
    xp: 8,
    cost: 3,
    minNight: 4,
    color: '#b7d45a',
    accent: '#7d9a2e',
    spit: { range: 210, interval: 1.8, speed: 230, damage: 7 },
  },
  shellback: {
    id: 'shellback',
    name: 'Shellback',
    hp: 46,
    speed: 44,
    damage: 11,
    radius: 16,
    xp: 12,
    cost: 4,
    minNight: 5,
    color: '#6f8fb8',
    accent: '#3f5a82',
    armor: 3,
  },
  mother: {
    id: 'mother',
    name: 'Mother Slime',
    hp: 95,
    speed: 30,
    damage: 12,
    radius: 22,
    xp: 15,
    cost: 6,
    minNight: 6,
    color: '#5fbf9a',
    accent: '#3e8f70',
    splits: { into: 'slime', count: 4 },
  },
  warden: {
    id: 'warden',
    name: 'Stone Warden',
    // Nights are a minute long: a warden nobody can kill by dawn just leaves.
    hp: 520,
    speed: 30,
    damage: 24,
    radius: 30,
    xp: 150,
    cost: 0,
    minNight: 5,
    color: '#8d8474',
    accent: '#e0a040',
    armor: 3,
    bossEvery: 5,
    epithet: 'The hill has got up and is walking',
    loot: { orbs: 16, essence: 0.6 },
  },
  queen: {
    id: 'queen',
    name: 'Swarm Queen',
    // Off the Warden's nights, so a late run gets a boss every few nights
    // instead of two at once. She hangs back and lets her brood do the biting:
    // the fight is getting to her through them.
    hp: 640,
    speed: 46,
    damage: 16,
    radius: 24,
    xp: 120,
    cost: 0,
    minNight: 13,
    color: '#6d4f8f',
    accent: '#f0c850',
    armor: 1,
    spit: { range: 290, interval: 2.4, speed: 250, damage: 12 },
    summons: { into: 'crawler', count: 3, interval: 9 },
    bossEvery: 5,
    bossPhase: 3,
    epithet: 'Mother of the swarm',
    loot: { orbs: 20, essence: 0.6 },
  },
  bulwark: {
    id: 'bulwark',
    name: 'Crystal Bulwark',
    // The third boss, for the late twenties on: a slow shelled walker with a
    // crystal on its back that wards the raid around it. It bites hard but
    // barely hunts; what makes it a boss is that everything near it shrugs
    // off two hits in three, so a night with one in it is won by getting to it.
    hp: 900,
    speed: 24,
    damage: 22,
    radius: 30,
    xp: 160,
    cost: 0,
    minNight: 26,
    color: '#56707e',
    accent: '#8fe6ff',
    armor: 4,
    shields: { radius: 210, take: 0.35 },
    bossEvery: 5,
    bossPhase: 1,
    epithet: 'Its crystal wards the raid. Reach it first',
    loot: { orbs: 24, essence: 0.65 },
  },
};

/** Toughest first; bosses are left out because they are never bought. */
export const MOB_ORDER: MobTypeId[] = ['mother', 'brute', 'shellback', 'wisp', 'spitter', 'crawler', 'slime'];
