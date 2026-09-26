import type { SpellId } from '../sim/types';

/**
 * What a spell does when it goes off. Each shape is one branch of `castSpell`;
 * a new spell is a row here with one of them, not new code.
 */
export type SpellShape = 'bolt' | 'nova' | 'mend';

export interface SpellDef {
  id: SpellId;
  name: string;
  description: string;
  shape: SpellShape;
  /** Seconds between casts at the first level. */
  cooldown: number;
  /** Damage, or health restored for a mend, at the first level. */
  power: number;
  /** A bolt's burst on impact, or a nova's reach from the caster. */
  radius: number;
  /** A bolt's flight speed. */
  speed?: number;
  /** Seconds of frost left on whatever it catches. */
  chill?: number;
  /** How hard a nova throws creatures out of it. */
  knock?: number;
  color: string;
}

export const SPELL_MAX_LEVEL = 5;
/** Each level past the first adds this share of the first level's power... */
export const SPELL_POWER_STEP = 0.3;
/** ...and takes this share off the cooldown. */
export const SPELL_COOLDOWN_STEP = 0.08;

export const SPELLS: Record<SpellId, SpellDef> = {
  fireball: {
    id: 'fireball',
    name: 'Fireball',
    description: 'Q hurls a ball of fire that bursts where it lands.',
    shape: 'bolt',
    cooldown: 2.5,
    power: 26,
    radius: 50,
    speed: 440,
    color: '#ff8a3d',
  },
  frostNova: {
    id: 'frostNova',
    name: 'Frost Nova',
    description: 'Q breaks a ring of frost around you, throwing creatures back and slowing them.',
    shape: 'nova',
    cooldown: 7,
    power: 14,
    radius: 96,
    chill: 2.5,
    knock: 380,
    color: '#9fe3ff',
  },
  mend: {
    id: 'mend',
    name: 'Mend',
    description: 'Q knits your wounds: 30 health back, more with each level.',
    shape: 'mend',
    cooldown: 14,
    power: 30,
    radius: 0,
    color: '#8ef0a8',
  },
};

export const SPELL_IDS = Object.keys(SPELLS) as SpellId[];

export const spellPerk = (id: SpellId): string => `spell:${id}`;

export function spellPower(id: SpellId, level: number): number {
  return SPELLS[id].power * (1 + (level - 1) * SPELL_POWER_STEP);
}

export function spellCooldown(id: SpellId, level: number): number {
  return SPELLS[id].cooldown * (1 - (level - 1) * SPELL_COOLDOWN_STEP);
}
