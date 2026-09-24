import type { Player, UpgradeOffer, WeaponId } from '../sim/types';
import { WEAPONS } from './weapons';

export interface UpgradeDef {
  id: string;
  title: string;
  description: string;
  /** False when the upgrade has nothing left to give this player. */
  available: (player: Player) => boolean;
  apply: (player: Player) => void;
}

const statUpgrade = (
  id: string,
  title: string,
  description: string,
  apply: (player: Player) => void,
): UpgradeDef => ({ id, title, description, available: () => true, apply });

const WEAPON_MAX_LEVEL = 6;
const MAX_WEAPONS = 5;

function weaponUpgrades(): UpgradeDef[] {
  return (Object.keys(WEAPONS) as WeaponId[]).map((id) => {
    const def = WEAPONS[id];
    return {
      id: `weapon:${id}`,
      title: def.name,
      description: def.description,
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

export const UPGRADES: UpgradeDef[] = [
  ...weaponUpgrades(),
  statUpgrade('dmg', 'Sharpened', '+15% damage.', (p) => {
    p.stats.damage *= 1.15;
  }),
  statUpgrade('rate', 'Quickhands', '+12% fire rate.', (p) => {
    p.stats.fireRate *= 1.12;
  }),
  statUpgrade('speed', 'Light Step', '+8% move speed.', (p) => {
    p.stats.moveSpeed *= 1.08;
  }),
  statUpgrade('gather', 'Practised', '+20% gathering speed.', (p) => {
    p.stats.gatherSpeed *= 1.2;
  }),
  statUpgrade('magnet', 'Magnetic', '+40% pickup range.', (p) => {
    p.stats.pickupRadius *= 1.4;
  }),
  statUpgrade('hp', 'Hearty', '+20 max health, and heal for it.', (p) => {
    p.stats.maxHp += 20;
    p.maxHp += 20;
    p.hp = Math.min(p.maxHp, p.hp + 20);
  }),
  statUpgrade('regen', 'Mending', '+0.6 health per second.', (p) => {
    p.stats.regen += 0.6;
  }),
  statUpgrade('multi', 'Split Shot', '+1 projectile per weapon.', (p) => {
    p.stats.multishot += 1;
  }),
  statUpgrade('xp', 'Curious', '+20% experience gained.', (p) => {
    p.stats.xpGain *= 1.2;
  }),
];

export function toOffer(def: UpgradeDef, player: Player): UpgradeOffer {
  const owned = def.id.startsWith('weapon:')
    ? player.weapons.find((w) => `weapon:${w.id}` === def.id)
    : undefined;
  return {
    id: def.id,
    title: owned ? `${def.title} Lv.${owned.level + 1}` : def.title,
    description: owned ? 'Upgrade this weapon.' : def.description,
  };
}
