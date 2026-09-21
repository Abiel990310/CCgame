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
};

export const MOB_ORDER: MobTypeId[] = ['brute', 'wisp', 'crawler', 'slime'];
