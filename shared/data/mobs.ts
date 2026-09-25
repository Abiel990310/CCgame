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
  /**
   * Never bought from a night's budget: one walks in at the start of every
   * night that is a multiple of this, once it has reached `minNight`.
   */
  bossEvery?: number;
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
    loot: { orbs: 16, essence: 0.6 },
  },
};

/** Toughest first; bosses are left out because they are never bought. */
export const MOB_ORDER: MobTypeId[] = ['mother', 'brute', 'shellback', 'wisp', 'spitter', 'crawler', 'slime'];
