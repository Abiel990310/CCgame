import { UPGRADES, type UpgradeKind } from '@shared/data/upgrades';
import { WEAPONS } from '@shared/data/weapons';
import { perk } from '@shared/sim/perks';
import type { Player, UpgradeOffer, WeaponId } from '@shared/sim/types';
import { icon, type IconName } from './icons';
import './upgrades.css';

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

const KIND: Record<UpgradeKind, { label: string; icon: IconName }> = {
  weapon: { label: 'Weapon', icon: 'sword' },
  mastery: { label: 'Mastery', icon: 'star' },
  attack: { label: 'Attack', icon: 'bolt' },
  survival: { label: 'Survival', icon: 'shield' },
  gathering: { label: 'Explore', icon: 'compass' },
  growth: { label: 'Growth', icon: 'sprout' },
};

/** Offered less than half as often as most, so worth flagging when it turns up. */
const RARE_WEIGHT = 0.5;

/**
 * One level-up choice as a card: what kind of upgrade it is, what it does, and
 * how far along it is. The pips are what make a pick feel like progress rather
 * than a line of text, so a stacking perk shows its taken levels and the one
 * this pick adds.
 */
export function upgradeCard(offer: UpgradeOffer, player: Player, index: number): HTMLButtonElement {
  const def = BY_ID.get(offer.id);
  const kind = def?.kind ?? 'growth';
  const look = KIND[kind];

  const weaponId = offer.id.startsWith('weapon:') ? (offer.id.slice(7) as WeaponId) : null;
  const owned = weaponId ? player.weapons.find((w) => w.id === weaponId) : undefined;
  const have = weaponId ? (owned?.level ?? 0) : perk(player, offer.id);
  const max = def?.max ?? 0;
  const isNew = weaponId !== null && !owned;
  const rare = kind === 'mastery' || (def?.weight ?? 1) <= RARE_WEIGHT;

  // An owned weapon's offer only says "Upgrade this weapon"; what it does is more useful.
  const description = owned && weaponId ? WEAPONS[weaponId].description : offer.description;

  let foot = '';
  if (max > 1) {
    const pips = Array.from({ length: max }, (_, i) =>
      i < have ? '<i class="got"></i>' : i === have ? '<i class="next"></i>' : '<i></i>',
    ).join('');
    foot = `<span class="up-pips" title="Level ${have + 1} of ${max}">${pips}</span>`;
  } else if (max === 0) {
    foot = `<span class="up-stack">Stacks${have > 0 ? ` · taken ${have}` : ''}</span>`;
  }

  const button = document.createElement('button');
  button.className = `offer upgrade k-${kind}${rare ? ' rare' : ''}`;
  button.style.setProperty('--i', String(index));
  button.innerHTML =
    `<span class="up-head"><span class="up-kind">${look.label}</span>` +
    (isNew ? '<span class="up-flag">New</span>' : rare ? '<span class="up-flag">Rare</span>' : '') +
    `</span>` +
    `<span class="up-icon">${icon(look.icon)}</span>` +
    `<b>${offer.title}</b><span class="up-desc">${description}</span>${foot}` +
    `<kbd class="up-key">${index + 1}</kbd>`;
  return button;
}
