import { UPGRADES, WEAPON_MAX_LEVEL, type UpgradeKind } from '@shared/data/upgrades';
import { WEAPONS } from '@shared/data/weapons';
import { PLAYER } from '@shared/sim/constants';
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

/** The order a build reads in: what you fight with, then how, then the rest. */
const KIND_ORDER: UpgradeKind[] = ['mastery', 'attack', 'survival', 'gathering', 'growth'];

/** A plain boost is folded into `stats` rather than counted, so it is shown as the total it adds up to. */
const STATS: { label: string; show: (p: Player) => string | null }[] = [
  { label: 'Damage', show: (p) => percent(p.stats.damage) },
  { label: 'Fire rate', show: (p) => percent(p.stats.fireRate) },
  { label: 'Move', show: (p) => percent(p.stats.moveSpeed) },
  { label: 'Gathering', show: (p) => percent(p.stats.gatherSpeed) },
  { label: 'Pickup range', show: (p) => percent(p.stats.pickupRadius) },
  { label: 'Experience', show: (p) => percent(p.stats.xpGain) },
  { label: 'Max health', show: (p) => (p.maxHp !== PLAYER.maxHp ? signed(p.maxHp - PLAYER.maxHp) : null) },
  { label: 'Regen', show: (p) => (p.stats.regen > 0 ? `+${p.stats.regen.toFixed(1)}/s` : null) },
  { label: 'Projectiles', show: (p) => (p.stats.multishot > 0 ? signed(p.stats.multishot) : null) },
];

function percent(multiplier: number): string | null {
  const change = Math.round((multiplier - 1) * 100);
  return change === 0 ? null : `${signed(change)}%`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function pips(have: number, max: number): string {
  return Array.from({ length: max }, (_, i) => (i < have ? '<i class="got"></i>' : '<i></i>')).join('');
}

function chip(kind: UpgradeKind, title: string, tip: string, tail: string): string {
  return (
    `<span class="build-chip k-${kind}" title="${tip}">` +
    `<span class="bc-icon">${icon(KIND[kind].icon)}</span>` +
    `<span class="bc-name">${title}</span>${tail}</span>`
  );
}

/**
 * Everything a player's level-ups have added up to: their weapons, the perks
 * they hold, and the net effect of the plain boosts. After thirty levels the
 * cards are long gone, and this is the only place the build can be read.
 */
export function buildSummary(player: Player): string {
  const weapons = player.weapons
    .map((w) =>
      chip('weapon', WEAPONS[w.id].name, WEAPONS[w.id].description,
        `<span class="up-pips" title="Level ${w.level} of ${WEAPON_MAX_LEVEL}">${pips(w.level, WEAPON_MAX_LEVEL)}</span>`),
    )
    .join('');

  const held = Object.entries(player.perks ?? {})
    .map(([id, count]) => ({ def: BY_ID.get(id), count }))
    .filter((p): p is { def: NonNullable<typeof p.def>; count: number } => !!p.def && p.count > 0)
    .sort((a, b) => KIND_ORDER.indexOf(a.def.kind) - KIND_ORDER.indexOf(b.def.kind));
  const perks = held
    .map(({ def, count }) => {
      const max = def.max ?? 0;
      const tail = max > 1
        ? `<span class="up-pips" title="${count} of ${max}">${pips(count, max)}</span>`
        : max === 0 && count > 1 ? `<span class="bc-count">&times;${count}</span>` : '';
      return chip(def.kind, def.title, def.description, tail);
    })
    .join('');

  const stats = STATS.map((s) => ({ label: s.label, value: s.show(player) }))
    .filter((s) => s.value !== null)
    .map((s) => `<span class="build-stat"><b>${s.value}</b>${s.label}</span>`)
    .join('');

  return (
    `<div class="build-row">${weapons}</div>` +
    (perks ? `<div class="build-row">${perks}</div>` : '') +
    (stats ? `<div class="build-stats">${stats}</div>` : '')
  );
}

/** Changes whenever the summary would, so the DOM is only rebuilt then. */
export function buildKey(player: Player): string {
  const s = player.stats;
  return [
    player.weapons.map((w) => w.id + w.level).join(','),
    JSON.stringify(player.perks ?? {}),
    s.damage, s.fireRate, s.moveSpeed, s.gatherSpeed, s.pickupRadius, s.xpGain, s.regen, s.multishot,
    player.maxHp,
  ].join('|');
}
