import type { TargetRule, WeaponId } from '../sim/types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  damage: number;
  /** Shots per second at level 1. */
  rate: number;
  range: number;
  speed: number;
  pierce: number;
  /** Different rules per weapon are what spread a loadout across a crowd. */
  targeting: TargetRule;
  color: string;
  /** Per-level multipliers, applied as (1 + (level-1) * step). */
  damageStep: number;
  rateStep: number;
  /** Bursts on impact, hurting everything this close for half the damage. */
  splash?: number;
  /** Seconds of frost each hit leaves, slowing the mob. */
  chill?: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  sling: {
    id: 'sling',
    name: 'Sling',
    description: 'Reliable little stone. Always hits something.',
    damage: 6,
    rate: 1.5,
    range: 230,
    speed: 400,
    pierce: 0,
    targeting: 'nearest',
    color: '#d9c9a8',
    damageStep: 0.3,
    rateStep: 0.12,
  },
  bow: {
    id: 'bow',
    name: 'Short Bow',
    description: 'Longer reach, punches through one extra target. Hunts the toughest mob in range.',
    damage: 9,
    rate: 1.0,
    range: 330,
    speed: 520,
    pierce: 1,
    targeting: 'toughest',
    color: '#c8e08a',
    damageStep: 0.32,
    rateStep: 0.1,
  },
  spark: {
    id: 'spark',
    name: 'Spark',
    description: 'Fast, short-range crackle of light that jumps between targets.',
    damage: 4,
    rate: 3.0,
    range: 170,
    speed: 620,
    pierce: 0,
    targeting: 'scatter',
    color: '#8fd8f0',
    damageStep: 0.28,
    rateStep: 0.16,
  },
  thorn: {
    id: 'thorn',
    name: 'Thornburst',
    description: 'Heavy spine that aims down the most crowded line.',
    damage: 16,
    rate: 0.55,
    range: 260,
    speed: 360,
    pierce: 3,
    targeting: 'line',
    color: '#a9e3a0',
    damageStep: 0.35,
    rateStep: 0.08,
  },
  harpoon: {
    id: 'harpoon',
    name: 'Harpoon',
    description: 'Slow, very long reach, and runs through five in a row. Made for big things.',
    damage: 24,
    rate: 0.45,
    range: 420,
    speed: 720,
    pierce: 5,
    targeting: 'toughest',
    color: '#e6eef5',
    damageStep: 0.34,
    rateStep: 0.08,
  },
  ember: {
    id: 'ember',
    name: 'Ember Pot',
    description: 'Lobs a pot of coals that bursts over a crowd.',
    damage: 11,
    rate: 0.7,
    range: 260,
    speed: 300,
    pierce: 0,
    targeting: 'line',
    color: '#ff9a4a',
    damageStep: 0.3,
    rateStep: 0.1,
    splash: 64,
  },
  frost: {
    id: 'frost',
    name: 'Frost Shard',
    description: 'Cold splinters that slow whatever they hit to a crawl.',
    damage: 5,
    rate: 1.6,
    range: 250,
    speed: 480,
    pierce: 1,
    targeting: 'nearest',
    color: '#a8e4ff',
    damageStep: 0.28,
    rateStep: 0.12,
    chill: 1.6,
  },
};

export function weaponDamage(id: WeaponId, level: number): number {
  const def = WEAPONS[id];
  return def.damage * (1 + (level - 1) * def.damageStep);
}

export function weaponRate(id: WeaponId, level: number): number {
  const def = WEAPONS[id];
  return def.rate * (1 + (level - 1) * def.rateStep);
}
