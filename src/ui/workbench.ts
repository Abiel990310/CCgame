import { CRAFTS, type CraftDef } from '@shared/data/crafting';
import { ITEMS } from '@shared/data/items';
import { MACHINES } from '@shared/data/machines';
import { UNLOCKED_BY } from '@shared/data/techs';
import { countItem } from '@shared/sim/inventory';
import { isUnlocked } from '@shared/sim/research';
import type { Player, ToolKind, World } from '@shared/sim/types';
import { itemIconVar } from '../render/items';
import { pieceIconVar } from '../render/pieces';
import { icon } from './icons';

const VERB: Record<ToolKind, string> = { axe: 'chopping', pick: 'mining', hand: 'foraging', rod: 'fishing' };

const GROUPS: Array<{ id: CraftDef['group']; title: string; note: string }> = [
  { id: 'tools', title: 'Tools', note: 'Carry one and you gather faster. The best of each kind counts.' },
  {
    id: 'machines',
    title: 'Machines',
    note: 'Advanced machines are made here, then placed from the build bar.',
  },
];

/**
 * The workbench screen: everything the bench can make, what each costs against
 * what is in the bag, and one click to make it. The rules live in
 * `shared/sim/crafting.ts`; this only reports what the player picked.
 */
export class WorkbenchScreen {
  private root = document.createElement('div');
  private list: HTMLElement;
  private open = false;
  private painted = '';

  constructor(
    host: HTMLElement,
    private callbacks: { onCraft: (id: string) => void; onClose: () => void },
  ) {
    this.root.className = 'modal hidden';
    this.root.id = 'craft';
    this.root.innerHTML =
      `<div class="modal-inner craft-inner">` +
      `<header class="sheet-head">` +
      `<div class="sheet-icon" style="background-image:${pieceIconVar('building:workbench')}"></div>` +
      `<div class="sheet-title"><p class="eyebrow">Workbench</p><h2>Crafting</h2></div>` +
      `<button class="icon-btn" id="craft-close" title="Close (C / Esc)">${icon('close')}</button>` +
      `</header><div class="craft-list"></div></div>`;
    host.appendChild(this.root);
    this.list = this.root.querySelector('.craft-list') as HTMLElement;

    this.root.querySelector('#craft-close')?.addEventListener('click', () => this.callbacks.onClose());
    // A click on the dimmed backdrop closes, as it does for every other sheet.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.callbacks.onClose();
    });
    this.list.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-craft]');
      if (card?.dataset.craft) this.callbacks.onCraft(card.dataset.craft);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.painted = '';
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  /** Repaint only when a count or a lock the cards show has changed. */
  update(world: World, player: Player): void {
    if (!this.open) return;
    const key = CRAFTS.map(
      (c) =>
        `${countItem(player, c.output)}:${c.unlock && !isUnlocked(world, c.unlock) ? 'L' : ''}:` +
        c.cost.map((p) => Math.min(countItem(player, p.id), p.count)).join(','),
    ).join('|');
    if (key === this.painted) return;
    this.painted = key;
    this.list.innerHTML = GROUPS.map(
      (g) =>
        `<section class="craft-group"><div class="craft-group-head"><h3>${g.title}</h3><span>${g.note}</span></div>` +
        `<div class="craft-grid">${CRAFTS.filter((c) => c.group === g.id)
          .map((c) => card(world, player, c))
          .join('')}</div></section>`,
    ).join('');
  }

  /** Flash the card the player just made, so the click visibly landed. */
  pulse(id: string): void {
    const el = this.list.querySelector<HTMLElement>(`[data-craft="${id}"]`);
    if (!el) return;
    el.classList.remove('made');
    void el.offsetWidth;
    el.classList.add('made');
  }
}

function card(world: World, player: Player, c: CraftDef): string {
  const item = ITEMS[c.output];
  const locked = c.unlock && !isUnlocked(world, c.unlock) ? UNLOCKED_BY.get(c.unlock) : null;
  const affordable = c.cost.every((p) => countItem(player, p.id) >= p.count);
  const have = countItem(player, c.output);

  let sub = '';
  if (item.tool) sub = `${item.tool.speed}× ${VERB[item.tool.kind]}`;
  else if (c.unlock) {
    const tier = MACHINES[c.unlock].tier;
    sub = tier > 1 ? `<span class="tier t${tier}">Mk${tier}</span>` : 'Machine';
  }

  const cost = c.cost
    .map((p) => {
      const short = countItem(player, p.id) < p.count;
      return (
        `<span class="${short ? 'short' : ''}" title="${ITEMS[p.id].name}">` +
        `<i style="background-image:${itemIconVar(p.id)}"></i>${p.count}</span>`
      );
    })
    .join('');

  const state = locked ? 'locked' : affordable ? 'ready' : 'poor';
  const foot = locked
    ? `<em class="craft-lock">Research ${locked.name}</em>`
    : have > 0
      ? `<em class="craft-have">${have} in bag</em>`
      : '';
  return (
    `<button class="craft-card ${state}" data-craft="${c.id}" title="${item.name}">` +
    `<i class="craft-icon" style="background-image:${itemIconVar(c.output)}"></i>` +
    `<div class="craft-text"><b>${item.name}</b><small>${sub}</small>` +
    `<span class="cost">${cost}</span>${foot}</div></button>`
  );
}
