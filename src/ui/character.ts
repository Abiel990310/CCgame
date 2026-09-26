import { ITEMS } from '@shared/data/items';
import { TECHS } from '@shared/data/techs';
import { UPGRADES, WEAPON_MAX_LEVEL, type UpgradeKind } from '@shared/data/upgrades';
import { WEAPONS, weaponDamage, weaponRate } from '@shared/data/weapons';
import { MELEE, PLAYER } from '@shared/sim/constants';
import { toolSpeed } from '@shared/sim/crafting';
import { masteryId, perk } from '@shared/sim/perks';
import { researchBonuses, techLevel } from '@shared/sim/research';
import type { ItemId, Player, TargetRule, ToolKind, WeaponId, World } from '@shared/sim/types';
import { itemIconVar } from '../render/items';
import { icon, type IconName } from './icons';
import './character.css';

/**
 * The character sheet's Gear, Stats and Skills pages. Each is a pure function
 * of the player and the world, painted as HTML only when its key changes, so
 * nothing here can alter the island: it reads what the sim already decided.
 */

export type SheetTab = 'bag' | 'gear' | 'stats' | 'skills';
export const SHEET_TABS: { id: SheetTab; label: string; icon: IconName }[] = [
  { id: 'bag', label: 'Bag', icon: 'bag' },
  { id: 'gear', label: 'Gear', icon: 'sword' },
  { id: 'stats', label: 'Stats', icon: 'heart' },
  { id: 'skills', label: 'Skills', icon: 'star' },
];

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

const KIND: Record<UpgradeKind, { label: string; icon: IconName }> = {
  weapon: { label: 'Weapons', icon: 'sword' },
  mastery: { label: 'Mastery', icon: 'star' },
  spell: { label: 'Spells', icon: 'spell' },
  attack: { label: 'Attack', icon: 'bolt' },
  survival: { label: 'Survival', icon: 'shield' },
  gathering: { label: 'Explore', icon: 'compass' },
  growth: { label: 'Growth', icon: 'sprout' },
};
const KIND_ORDER: UpgradeKind[] = ['mastery', 'spell', 'attack', 'survival', 'gathering', 'growth'];

const AIM: Record<TargetRule, string> = {
  nearest: 'Nearest',
  toughest: 'Toughest',
  scatter: 'Spread',
  line: 'In a line',
};

/** The four kinds of hand tool, in the order a new island meets them. */
const TOOLS: { kind: ToolKind; name: string; verb: string; best: ItemId[] }[] = [
  { kind: 'axe', name: 'Axe', verb: 'chopping', best: ['steelAxe', 'ironAxe', 'stoneAxe'] },
  { kind: 'pick', name: 'Pickaxe', verb: 'mining', best: ['steelPick', 'ironPick', 'stonePick'] },
  { kind: 'hand', name: 'Basket', verb: 'foraging', best: ['forageBasket'] },
  { kind: 'rod', name: 'Rod', verb: 'fishing', best: ['fishingRod'] },
];

const PACKS: ItemId[] = ['satchel', 'ironPack', 'steelPack'];

function pips(have: number, max: number): string {
  return Array.from({ length: max }, (_, i) => (i < have ? '<i class="got"></i>' : '<i></i>')).join('');
}

function round(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
}

function percent(multiplier: number): string {
  const change = Math.round((multiplier - 1) * 100);
  return change === 0 ? '—' : `${change > 0 ? '+' : ''}${change}%`;
}

/** The tool of this kind the bag is carrying that counts, if any. */
function carriedTool(player: Player, kind: ToolKind): ItemId | null {
  const speed = toolSpeed(player, kind);
  if (speed <= 1) return null;
  for (const slot of player.inventory) {
    const tool = slot ? ITEMS[slot.id].tool : undefined;
    if (tool && tool.kind === kind && tool.speed === speed) return slot!.id;
  }
  return null;
}

function weaponCard(world: World, player: Player, id: WeaponId, level: number): string {
  const def = WEAPONS[id];
  const mastered = perk(player, masteryId(id)) > 0;
  const damage =
    weaponDamage(id, level) * player.stats.damage * researchBonuses(world).damage * (mastered ? 1.5 : 1);
  const rate = weaponRate(id, level) * player.stats.fireRate * (mastered ? 1.25 : 1);
  const reach = def.range * (1 + 0.1 * perk(player, 'keenEye'));
  const extra = [def.pierce > 0 ? `pierces ${def.pierce}` : '', def.splash ? 'bursts' : '', def.chill ? 'chills' : '']
    .filter(Boolean)
    .join(' · ');
  return (
    `<div class="gear-card k-weapon${mastered ? ' mastered' : ''}">` +
    `<span class="gear-icon" style="--tint:${def.color}">${icon('sword')}</span>` +
    `<div class="gear-body">` +
    `<div class="gear-name"><b>${def.name}</b>` +
    `<span class="up-pips" title="Level ${level} of ${WEAPON_MAX_LEVEL}">${pips(level, WEAPON_MAX_LEVEL)}</span>` +
    (mastered ? '<span class="gear-flag">Mastered</span>' : '') +
    `</div>` +
    `<p>${def.description}</p>` +
    `<div class="gear-stats">` +
    `<span><b>${round(damage)}</b> damage</span>` +
    `<span><b>${round(rate)}</b> shots/s</span>` +
    `<span><b>${Math.round(reach)}</b> reach</span>` +
    `<span><b>${AIM[def.targeting]}</b> first</span>` +
    (extra ? `<span>${extra}</span>` : '') +
    `</div></div></div>`
  );
}

function bladeCard(world: World, player: Player): string {
  const boost = player.stats.damage * researchBonuses(world).damage;
  const hits = MELEE.damage.map((d) => round(d * boost)).join(' · ');
  return (
    `<div class="gear-card k-blade">` +
    `<span class="gear-icon">${icon('sword')}</span>` +
    `<div class="gear-body">` +
    `<div class="gear-name"><b>Blade</b><span class="gear-key">Swing</span></div>` +
    `<p>Three hits in rhythm. Hold to slam everything around you; swing into a bite to parry it.</p>` +
    `<div class="gear-stats"><span><b>${hits}</b> damage</span><span><b>${MELEE.range}</b> reach</span>` +
    `<span><b>${round(MELEE.slamDamage * boost)}</b> slam</span></div>` +
    `</div></div>`
  );
}

/** A slot-shaped frame for a carried thing. Not an `.islot`: nothing here can be clicked into the bag. */
function toolArt(item: ItemId | null): string {
  return item
    ? `<span class="tool-art filled"><i style="background-image:${itemIconVar(item)}"></i></span>`
    : `<span class="tool-art"></span>`;
}

export function gearPage(world: World, player: Player): string {
  const weapons = player.weapons.map((w) => weaponCard(world, player, w.id, w.level)).join('');

  const tools = TOOLS.map((t) => {
    const item = carriedTool(player, t.kind);
    const speed = toolSpeed(player, t.kind);
    return (
      `<div class="tool-cell${item ? '' : ' empty'}"${item ? '' : ` title="Craft one at a workbench"`}>` +
      toolArt(item) +
      `<span class="tool-text"><b>${item ? ITEMS[item].name : t.name}</b>` +
      `<span>${item ? `${round(speed)}&times; ${t.verb}` : 'Not carried'}</span></span>` +
      `</div>`
    );
  }).join('');

  const sewn = player.bag ?? 0;
  const pack = sewn > 0 ? PACKS[sewn - 1] : null;
  const next = PACKS[sewn];
  const packCell =
    `<div class="tool-cell${pack ? '' : ' empty'}"${next ? ` title="Next: the ${ITEMS[next].name}, at a workbench"` : ''}>` +
    toolArt(pack) +
    `<span class="tool-text"><b>${pack ? ITEMS[pack].name : 'Plain bag'}</b>` +
    `<span>${player.inventory.length} slots</span></span>` +
    `</div>`;

  return (
    `<section class="inv-panel"><div class="inv-head"><b>Weapons</b><span>Fire on their own</span></div>` +
    `<div class="gear-list">${weapons}${bladeCard(world, player)}</div></section>` +
    `<section class="inv-panel"><div class="inv-head"><b>Tools</b><span>Made at a workbench, the best one carried counts</span></div>` +
    `<div class="tool-grid">${tools}${packCell}</div></section>`
  );
}

/** Every stat a level-up can move, shown even when untouched so the sheet reads the same each time. */
const STATS: { label: string; value: (p: Player) => string; base: (p: Player) => boolean }[] = [
  { label: 'Damage', value: (p) => percent(p.stats.damage), base: (p) => p.stats.damage === 1 },
  { label: 'Fire rate', value: (p) => percent(p.stats.fireRate), base: (p) => p.stats.fireRate === 1 },
  { label: 'Extra shots', value: (p) => (p.stats.multishot > 0 ? `+${p.stats.multishot}` : '—'), base: (p) => p.stats.multishot === 0 },
  { label: 'Move speed', value: (p) => percent(p.stats.moveSpeed), base: (p) => p.stats.moveSpeed === 1 },
  { label: 'Gathering', value: (p) => percent(p.stats.gatherSpeed), base: (p) => p.stats.gatherSpeed === 1 },
  { label: 'Pickup range', value: (p) => percent(p.stats.pickupRadius), base: (p) => p.stats.pickupRadius === 1 },
  { label: 'Experience', value: (p) => percent(p.stats.xpGain), base: (p) => p.stats.xpGain === 1 },
  { label: 'Regen', value: (p) => (p.stats.regen > 0 ? `+${p.stats.regen.toFixed(1)}/s` : '—'), base: (p) => p.stats.regen <= 0 },
];

const ISLAND: { kind: keyof ReturnType<typeof researchBonuses>; label: string }[] = [
  { kind: 'damage', label: 'Damage' },
  { kind: 'gather', label: 'Gathering' },
  { kind: 'xp', label: 'Experience' },
  { kind: 'mining', label: 'Miners' },
  { kind: 'crafting', label: 'Machines' },
  { kind: 'belt', label: 'Belts' },
  { kind: 'inserter', label: 'Arms' },
  { kind: 'lab', label: 'Labs' },
  { kind: 'fuel', label: 'Fuel' },
  { kind: 'power', label: 'Power' },
  { kind: 'yield', label: 'Yield' },
];

export function statsPage(world: World, player: Player): string {
  const xp = player.xpToNext > 0 ? Math.min(1, player.xp / player.xpToNext) : 0;
  const hp = player.maxHp > 0 ? Math.min(1, player.hp / player.maxHp) : 0;
  const skills = Object.values(player.perks ?? {}).filter((n) => n > 0).length;

  const head =
    `<div class="stat-top">` +
    `<div class="stat-big"><span>Level</span><b>${player.level}</b>` +
    `<div class="stat-meter xp"><i style="width:${xp * 100}%"></i></div>` +
    `<small>${Math.floor(player.xp)} / ${player.xpToNext} to next</small></div>` +
    `<div class="stat-big"><span>Health</span><b>${Math.ceil(player.hp)}</b>` +
    `<div class="stat-meter hp"><i style="width:${hp * 100}%"></i></div>` +
    `<small title="A new islander has ${PLAYER.maxHp}">of ${player.maxHp}</small></div>` +
    `<div class="stat-big"><span>Skills</span><b>${skills}</b>` +
    `<small>and ${player.weapons.length} weapon${player.weapons.length === 1 ? '' : 's'}</small></div>` +
    `</div>`;

  const rows = STATS.map(
    (s) => `<div class="stat-row${s.base(player) ? ' base' : ''}"><span>${s.label}</span><b>${s.value(player)}</b></div>`,
  ).join('');

  const bonus = researchBonuses(world);
  const island = ISLAND.filter((r) => bonus[r.kind] !== 1)
    .map((r) => `<div class="stat-row"><span>${r.label}</span><b>${percent(bonus[r.kind])}</b></div>`)
    .join('');
  const known = TECHS.filter((t) => techLevel(world, t.id) > 0).length;

  return (
    head +
    `<section class="inv-panel"><div class="inv-head"><b>You</b><span>From level-ups</span></div>` +
    `<div class="stat-rows">${rows}</div></section>` +
    `<section class="inv-panel"><div class="inv-head"><b>The island</b><span>${known} of ${TECHS.length} researched</span></div>` +
    (island
      ? `<div class="stat-rows">${island}</div>`
      : `<p class="stat-empty">Research at a lab raises these for everyone on the island.</p>`) +
    `</section>`
  );
}

export function skillsPage(player: Player): string {
  const held = Object.entries(player.perks ?? {})
    .map(([id, count]) => ({ def: BY_ID.get(id), count }))
    .filter((p): p is { def: NonNullable<typeof p.def>; count: number } => !!p.def && p.count > 0);
  const total = UPGRADES.filter((u) => u.kind !== 'weapon').length;

  const waiting = player.pendingUpgrades > 0
    ? `<div class="skill-waiting"><span>${icon('star')}<b>${player.pendingUpgrades} level-up${player.pendingUpgrades === 1 ? '' : 's'} to spend</b></span>` +
      `<button class="primary-btn" data-sheet="draft">Choose</button></div>`
    : '';

  const groups = KIND_ORDER.map((kind) => {
    const list = held.filter((h) => h.def.kind === kind);
    if (list.length === 0) return '';
    const cards = list
      .map(({ def, count }) => {
        const max = def.max ?? 0;
        const tail = max > 1
          ? `<span class="up-pips" title="${count} of ${max}">${pips(count, max)}</span>`
          : max === 0 && count > 1 ? `<span class="bc-count">&times;${count}</span>` : '';
        return (
          `<div class="skill-card k-${kind}"><span class="skill-icon">${icon(KIND[kind].icon)}</span>` +
          `<div class="skill-body"><div class="gear-name"><b>${def.title}</b>${tail}</div><p>${def.description}</p></div></div>`
        );
      })
      .join('');
    return `<div class="skill-group"><h3 class="skill-kind k-${kind}">${KIND[kind].label}</h3><div class="skill-list">${cards}</div></div>`;
  }).join('');

  return (
    waiting +
    `<section class="inv-panel"><div class="inv-head"><b>Skills</b><span>${held.length} of ${total} found</span></div>` +
    (groups || `<p class="stat-empty">Each level-up offers a skill. The ones you take are kept here.</p>`) +
    `</section>`
  );
}

/** Changes whenever a page would, so the DOM is only rebuilt then. */
export function sheetKey(tab: SheetTab, world: World, player: Player): string {
  if (tab === 'bag') return '';
  const s = player.stats;
  const base = [
    tab,
    player.weapons.map((w) => w.id + w.level).join(','),
    JSON.stringify(player.perks ?? {}),
    s.damage, s.fireRate, s.moveSpeed, s.gatherSpeed, s.pickupRadius, s.xpGain, s.regen, s.multishot,
    player.maxHp, player.pendingUpgrades,
  ];
  if (tab === 'gear') {
    base.push(player.bag ?? 0, player.inventory.length, TOOLS.map((t) => carriedTool(player, t.kind)).join(','));
  }
  if (tab === 'gear' || tab === 'stats') base.push(JSON.stringify(world.research.levels));
  if (tab === 'stats') base.push(player.level, Math.floor(player.xp), player.xpToNext, Math.ceil(player.hp));
  return base.join('|');
}
