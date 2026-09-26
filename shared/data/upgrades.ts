import { addPerk, masteryId, perk } from '../sim/perks';
import type { Player, UpgradeOffer, WeaponId } from '../sim/types';
import { SPELL_IDS, SPELL_MAX_LEVEL, SPELLS, spellPerk } from './spells';
import { WEAPONS } from './weapons';

/** What an upgrade is for, which is how the level-up screen colours and groups it. */
export type UpgradeKind = 'weapon' | 'mastery' | 'spell' | 'attack' | 'survival' | 'gathering' | 'growth';

export interface UpgradeDef {
  id: string;
  title: string;
  description: string;
  kind: UpgradeKind;
  /** How many times it can be taken; absent for boosts that stack without end. */
  max?: number;
  /** False when the upgrade has nothing left to give this player. */
  available: (player: Player) => boolean;
  apply: (player: Player) => void;
  /** How often it turns up among the offers, against 1 for most. */
  weight?: number;
}

const statUpgrade = (
  id: string,
  title: string,
  kind: UpgradeKind,
  description: string,
  apply: (player: Player) => void,
): UpgradeDef => ({ id, title, description, kind, available: () => true, apply });

export const WEAPON_MAX_LEVEL = 6;
const MAX_WEAPONS = 5;

function weaponUpgrades(): UpgradeDef[] {
  return (Object.keys(WEAPONS) as WeaponId[]).map((id) => {
    const def = WEAPONS[id];
    return {
      id: `weapon:${id}`,
      title: def.name,
      description: def.description,
      kind: 'weapon' as const,
      max: WEAPON_MAX_LEVEL,
      available: (player: Player) => {
        const owned = player.weapons.find((w) => w.id === id);
        if (owned) return owned.level < WEAPON_MAX_LEVEL;
        return player.weapons.length < MAX_WEAPONS;
      },
      apply: (player: Player) => {
        const owned = player.weapons.find((w) => w.id === id);
        if (owned) owned.level += 1;
        else player.weapons.push({ id, level: 1, cooldown: 0 });
      },
    };
  });
}

/**
 * A perk the systems read by id through `perk()`, taken up to `max` times.
 * Its title gains a numeral from the second pick on.
 */
function perkUpgrade(
  id: string,
  title: string,
  kind: UpgradeKind,
  description: string,
  max: number,
  opts: { weight?: number; requires?: (p: Player) => boolean; apply?: (p: Player) => void } = {},
): UpgradeDef {
  return {
    id,
    title,
    description,
    kind,
    max,
    weight: opts.weight,
    available: (p) => perk(p, id) < max && (opts.requires?.(p) ?? true),
    apply: (p) => {
      addPerk(p, id);
      opts.apply?.(p);
    },
  };
}

const owns = (id: WeaponId) => (p: Player): boolean => p.weapons.some((w) => w.id === id);

/** Once a weapon is at its last level, it can be mastered: one last, big step. */
function masteries(): UpgradeDef[] {
  return (Object.keys(WEAPONS) as WeaponId[]).map((id) =>
    perkUpgrade(masteryId(id), `${WEAPONS[id].name} Mastery`, 'mastery', 'Half again the damage, and a quarter faster.', 1, {
      weight: 2,
      requires: (p) => p.weapons.some((w) => w.id === id && w.level >= WEAPON_MAX_LEVEL),
    }),
  );
}

/**
 * Spells are perks whose count is their level, so the level-up screen draws
 * their pips like any other. The first one learned is readied for Q.
 */
function spells(): UpgradeDef[] {
  return SPELL_IDS.map((id) =>
    perkUpgrade(spellPerk(id), SPELLS[id].name, 'spell', SPELLS[id].description, SPELL_MAX_LEVEL, {
      apply: (p) => {
        p.spell ??= id;
      },
    }),
  );
}

/** Perks: what a level buys once the plain stat boosts stop being interesting. */
const PERKS: UpgradeDef[] = [
  // Aim and weapons.
  perkUpgrade('keenEye', 'Keen Eye', 'attack', '+10% weapon range.', 5),
  perkUpgrade('lucky', 'Lucky Strike', 'attack', '+8% chance for a hit to crit for double.', 5),
  perkUpgrade('brutal', 'Brutal', 'attack', 'Critical hits deal another half again.', 3, { requires: (p) => perk(p, 'lucky') > 0 }),
  perkUpgrade('piercing', 'Piercing', 'attack', 'Every shot passes through one more.', 3, { weight: 0.6 }),
  perkUpgrade('swift', 'Swift Shot', 'attack', '+15% projectile speed.', 3),
  perkUpgrade('heavy', 'Heavy Hand', 'attack', 'Hits knock creatures back.', 3),
  perkUpgrade('volatile', 'Volatile', 'attack', 'Ember Pot bursts a quarter wider.', 3, { requires: owns('ember') }),
  perkUpgrade('frostbite', 'Frostbite', 'attack', 'Every hit from every weapon chills a little.', 1, { weight: 0.5 }),
  perkUpgrade('executioner', 'Executioner', 'attack', 'Finishes off anything but a boss below 8% health.', 1, { weight: 0.5 }),
  perkUpgrade('nightOwl', 'Night Owl', 'attack', '+15% damage at night.', 3),
  perkUpgrade('campGuard', 'Camp Guard', 'attack', '+25% damage near the campfire.', 2),
  perkUpgrade('glassCannon', 'Glass Cannon', 'attack', '+40% damage, but 25 less max health.', 1, {
    weight: 0.4,
    requires: (p) => p.maxHp > 60,
    apply: (p) => {
      p.stats.damage *= 1.4;
      p.stats.maxHp -= 25;
      p.maxHp -= 25;
      p.hp = Math.min(p.hp, p.maxHp);
    },
  }),
  // The blade.
  perkUpgrade('longBlade', 'Long Blade', 'attack', 'Your swing and slam reach 15% further.', 3),
  perkUpgrade('quickBlade', 'Quick Blade', 'attack', 'Swings recover 12% faster.', 3),
  perkUpgrade('stagger', 'Staggering Blows', 'attack', 'The third hit of a combo leaves what it hits unable to bite for a moment.', 1, { weight: 0.6 }),
  perkUpgrade('thirst', 'Thirsting Blade', 'survival', 'Heal 1 for every creature a swing or slam lands on.', 3),
  // Staying alive.
  perkUpgrade('padded', 'Padded Coat', 'survival', 'Take 1 less damage from every hit.', 5),
  perkUpgrade('bramble', 'Bramble Coat', 'survival', 'Whatever bites you takes 8 damage back.', 4),
  perkUpgrade('vampiric', 'Vampiric', 'survival', 'Heal 1 for every kill.', 5),
  perkUpgrade('reinforced', 'Reinforced', 'survival', 'Half again as long unhittable after a hit.', 2),
  perkUpgrade('secondWind', 'Second Wind', 'survival', 'Get back up 30% sooner when downed.', 2),
  perkUpgrade('recovery', 'Quick Recovery', 'survival', 'Dash comes back 15% sooner.', 4),
  // Getting about and gathering.
  perkUpgrade('pathfinder', 'Pathfinder', 'gathering', '+12% move speed by day.', 2),
  perkUpgrade('explorer', 'Explorer', 'growth', 'See three tiles further on the map.', 3),
  perkUpgrade('forager', 'Forager', 'gathering', '15% chance a harvest drops double.', 4),
  perkUpgrade('lumberjack', 'Lumberjack', 'gathering', '+40% speed chopping trees.', 3),
  perkUpgrade('prospector', 'Prospector', 'gathering', '+40% speed breaking rocks.', 3),
  perkUpgrade('angler', 'Angler', 'gathering', '+40% speed fishing.', 3),
  perkUpgrade('essenceSense', 'Essence Sense', 'growth', 'Creatures drop essence 30% more often.', 4),
  perkUpgrade('insight', 'Insight', 'growth', 'See one more choice at every level-up.', 1, { weight: 0.5 }),
];

export const UPGRADES: UpgradeDef[] = [
  ...weaponUpgrades(),
  ...masteries(),
  ...spells(),
  ...PERKS,
  statUpgrade('dmg', 'Sharpened', 'attack', '+15% damage.', (p) => {
    p.stats.damage *= 1.15;
  }),
  statUpgrade('rate', 'Quickhands', 'attack', '+12% fire rate.', (p) => {
    p.stats.fireRate *= 1.12;
  }),
  statUpgrade('speed', 'Light Step', 'gathering', '+8% move speed.', (p) => {
    p.stats.moveSpeed *= 1.08;
  }),
  statUpgrade('gather', 'Practised', 'gathering', '+20% gathering speed.', (p) => {
    p.stats.gatherSpeed *= 1.2;
  }),
  statUpgrade('magnet', 'Magnetic', 'growth', '+40% pickup range.', (p) => {
    p.stats.pickupRadius *= 1.4;
  }),
  statUpgrade('hp', 'Hearty', 'survival', '+20 max health, and heal for it.', (p) => {
    p.stats.maxHp += 20;
    p.maxHp += 20;
    p.hp = Math.min(p.maxHp, p.hp + 20);
  }),
  statUpgrade('regen', 'Mending', 'survival', '+0.6 health per second.', (p) => {
    p.stats.regen += 0.6;
  }),
  statUpgrade('multi', 'Split Shot', 'attack', '+1 projectile per weapon.', (p) => {
    p.stats.multishot += 1;
  }),
  statUpgrade('xp', 'Curious', 'growth', '+20% experience gained.', (p) => {
    p.stats.xpGain *= 1.2;
  }),
];

const NUMERALS = ['', '', ' II', ' III', ' IV', ' V'];

export function toOffer(def: UpgradeDef, player: Player): UpgradeOffer {
  const owned = def.id.startsWith('weapon:')
    ? player.weapons.find((w) => `weapon:${w.id}` === def.id)
    : undefined;
  const next = perk(player, def.id) + 1;
  return {
    id: def.id,
    title: owned ? `${def.title} Lv.${owned.level + 1}` : `${def.title}${NUMERALS[next] ?? ''}`,
    description: owned ? 'Upgrade this weapon.' : def.description,
  };
}
