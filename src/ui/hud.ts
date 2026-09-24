import { ITEMS } from '@shared/data/items';
import { CYCLE } from '@shared/sim/constants';
import { activeTech, cyclesDone, cyclesNeeded } from '@shared/sim/research';
import { countItem, hasAll } from '@shared/sim/inventory';
import type { ClickButton, SlotArea, SlotRef } from '@shared/sim/containers';
import type { ItemId, ItemStack, Machine, Player, World } from '@shared/sim/types';
import { audio } from '../audio';
import { itemIconVar } from '../render/items';
import { pieceIconVar } from '../render/pieces';
import { icon } from './icons';
import { InventoryScreen } from './inventory';
import { SoundPanel } from './sound';
import {
  GROUPS,
  TABS,
  entriesFor,
  entryFor,
  selectionKey,
  tabOf,
  type BuildSelection,
  type PaletteEntry,
  type PaletteTab,
} from './palette';
import {
  HOTBAR_SLOTS,
  loadHotbar,
  saveHotbar,
  slotOf,
  type HotbarBinding,
} from './hotbar';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
};

export interface HudCallbacks {
  onChooseUpgrade: (id: string) => void;
  onToggleBuild: () => void;
  onSelect: (selection: BuildSelection) => void;
  onToggleBag: () => void;
  onDash: () => void;
  onTogglePause: () => void;
  onQuitToMenu: () => void;
  onSetRecipe: (machineId: number, recipeId: string) => void;
  onSetResearch: (techId: string) => void;
  onSetFilter: (machineId: number, item: ItemId | null) => void;
  onSlotAction: (ref: SlotRef, button: ClickButton, quick: boolean) => void;
  onTakeAll: (machineId: number) => void;
  onSort: (area: SlotArea) => void;
  onGather: (ref: SlotRef) => void;
  onCloseInventory: () => void;
}

/**
 * Thin DOM layer over the simulation. It only ever reads world state and
 * reports intent back through callbacks, so it can be swapped or removed
 * without the sim noticing.
 */
export class Hud {
  private els = {
    topbar: $('topbar'),
    phaseName: $('phase-name'),
    phaseTime: $('phase-time'),
    phaseSub: $('phase-sub'),
    phaseFill: $('phase-fill'),
    level: $('level'),
    levelRing: $('level-ring'),
    hpFill: $('hp-fill'),
    hpText: $('hp-text'),
    xpFill: $('xp-fill'),
    xpText: $('xp-text'),
    research: $('research'),
    researchFill: $('research-fill'),
    researchText: $('research-text'),
    pouch: $('pouch'),
    hotbar: $('hotbar'),
    buildbar: $('buildbar'),
    buildTabs: $('buildbar-tabs'),
    buildItems: $('buildbar-items'),
    buildDetail: $('buildbar-detail'),
    buildClose: $<HTMLButtonElement>('buildbar-close'),
    stick: $('stick'),
    stickKnob: $('stick-knob'),
    btnBuild: $<HTMLButtonElement>('btn-build'),
    btnBag: $<HTMLButtonElement>('btn-bag'),
    btnDash: $<HTMLButtonElement>('btn-dash'),
    btnMenu: $<HTMLButtonElement>('btn-menu'),
    dashCd: $('dash-cd'),
    levelup: $('levelup'),
    levelupTitle: $('levelup-title'),
    offers: $('offers'),
    pause: $('pause'),
    pauseName: $('pause-name'),
    pauseSub: $('pause-sub'),
    pauseResume: $<HTMLButtonElement>('pause-resume'),
    pauseQuit: $<HTMLButtonElement>('pause-quit'),
    toasts: $('toasts'),
    sound: $('pause-sound'),
  };

  private inventory: InventoryScreen;
  private sound: SoundPanel;
  private selection: BuildSelection = { kind: 'belt' };
  private tab: PaletteTab = 'factory';
  private buildMode = false;
  private pauseOpen = false;
  /** Signature of the last rendered offer set, to avoid rebuilding every frame. */
  private offerKey = '';
  private pouchKey = '';
  private hotbarKey = '';
  private detailKey = '';
  /** The palette entry under the pointer, shown in the detail strip instead of the selection. */
  private hovered: PaletteEntry | null = null;
  private pouchCounts = new Map<string, number>();
  /** What each quick slot places. A client preference, saved on every change. */
  private hotbar: HotbarBinding[] = loadHotbar();

  constructor(private callbacks: HudCallbacks) {
    this.sound = new SoundPanel(this.els.sound);

    // Every button in the HUD clicks; the action each one triggers makes its
    // own noise on top, so the click is only ever the press itself.
    for (const button of [
      this.els.btnBuild,
      this.els.btnBag,
      this.els.btnDash,
      this.els.btnMenu,
      this.els.pauseResume,
      this.els.pauseQuit,
    ]) {
      button.addEventListener('click', () => audio.play('click'));
    }

    this.els.btnBuild.addEventListener('click', () => this.callbacks.onToggleBuild());
    this.els.buildClose.addEventListener('click', () => {
      audio.play('click');
      this.callbacks.onToggleBuild();
    });
    this.els.btnBag.addEventListener('click', () => this.callbacks.onToggleBag());
    this.els.btnDash.addEventListener('click', () => this.callbacks.onDash());
    this.els.btnMenu.addEventListener('click', () => this.callbacks.onTogglePause());
    this.els.pauseResume.addEventListener('click', () => this.callbacks.onTogglePause());
    this.els.pauseQuit.addEventListener('click', () => this.callbacks.onQuitToMenu());

    this.inventory = new InventoryScreen({
      onSlotAction: (ref, button, quick) => this.callbacks.onSlotAction(ref, button, quick),
      onTakeAll: () => {
        const machine = this.inventory.inspecting;
        if (machine) this.callbacks.onTakeAll(machine.id);
      },
      onSetRecipe: (machineId, recipeId) => this.callbacks.onSetRecipe(machineId, recipeId),
      onSetResearch: (techId) => this.callbacks.onSetResearch(techId),
      onSetFilter: (machineId, item) => this.callbacks.onSetFilter(machineId, item),
      onSort: (area) => this.callbacks.onSort(area),
      onGather: (ref) => this.callbacks.onGather(ref),
      onClose: () => this.callbacks.onCloseInventory(),
    });

    this.buildTabs();
    this.buildPalette();
    this.buildHotbar();
  }

  /** The pause overlay doubles as the way back to the main menu. */
  setPauseOpen(open: boolean, slotName = '', subtitle = ''): void {
    this.pauseOpen = open;
    this.els.pause.classList.toggle('hidden', !open);
    this.els.btnMenu.classList.toggle('on', open);
    if (!open) return;
    // The sliders may have been moved from the main menu, or by the mute key.
    this.sound.refresh();
    this.els.pauseName.textContent = slotName;
    this.els.pauseSub.textContent = subtitle;
  }

  get isPauseOpen(): boolean {
    return this.pauseOpen;
  }

  /** Pull the sound controls back in step after the mute key. */
  refreshSound(): void {
    this.sound.refresh();
  }

  setBuildMode(on: boolean): void {
    this.buildMode = on;
    this.els.buildbar.classList.toggle('hidden', !on);
    this.els.btnBuild.classList.toggle('on', on);
  }

  /** Open the inventory screen, on its own or beside a container. */
  openInventory(machine: Machine | null): void {
    if (!this.inventory.isOpen) audio.play('open');
    this.inventory.show(machine);
    this.els.btnBag.classList.toggle('on', machine === null);
  }

  closeInventory(): void {
    if (this.inventory.isOpen) audio.play('close');
    this.inventory.hide();
    this.els.btnBag.classList.remove('on');
  }

  get isBuildMode(): boolean {
    return this.buildMode;
  }

  get isInventoryOpen(): boolean {
    return this.inventory.isOpen;
  }

  get selected(): BuildSelection {
    return this.selection;
  }

  /** The machine whose screen is open, if any. Suppresses world clicks. */
  get inspecting(): Machine | null {
    return this.inventory.inspecting;
  }

  private buildTabs(): void {
    this.els.buildTabs.innerHTML = '';
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.className = `tab${tab.id === this.tab ? ' on' : ''}`;
      button.innerHTML = `${icon(tab.id === 'factory' ? 'gear' : 'leaf')}${tab.label}`;
      button.addEventListener('click', () => {
        audio.play('click');
        this.showTab(tab.id);
        // Switching tabs selects that tab's first entry, so the ghost is valid.
        const first = entriesFor(this.tab)[0];
        if (first) this.select(first.selection);
      });
      this.els.buildTabs.appendChild(button);
    }
  }

  private showTab(tab: PaletteTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.buildTabs();
    this.buildPalette();
  }

  private buildPalette(): void {
    this.els.buildItems.innerHTML = '';
    const entries = entriesFor(this.tab);
    const groups = GROUPS.filter((g) => entries.some((e) => e.group === g));
    this.els.buildItems.classList.toggle('single', groups.length === 1);
    this.els.buildItems.style.setProperty('--cols', String(groups.length));

    for (const group of groups) {
      const column = document.createElement('section');
      column.className = 'pal-group';
      column.innerHTML = groups.length > 1 ? `<h3>${group}</h3>` : '';
      const list = document.createElement('div');
      list.className = 'pal-list';
      column.appendChild(list);

      for (const entry of entries.filter((e) => e.group === group)) {
        const key = selectionKey(entry.selection);
        const button = document.createElement('button');
        button.className = 'build-option';
        button.dataset.key = key;
        button.title = entry.description;
        const tier = entry.tier > 1 ? `<span class="tier t${entry.tier}">Mk${entry.tier}</span>` : '';
        button.innerHTML =
          `<i class="piece" style="background-image:${pieceIconVar(key)}"></i>${tier}` +
          `<b>${entry.name}</b>${costHtml(entry.cost)}`;
        button.addEventListener('click', () => {
          audio.play('click');
          this.select(entry.selection);
        });
        button.addEventListener('pointerenter', () => {
          this.hovered = entry;
        });
        button.addEventListener('pointerleave', () => {
          if (this.hovered === entry) this.hovered = null;
        });
        list.appendChild(button);
      }
      this.els.buildItems.appendChild(column);
    }
    this.detailKey = '';
  }

  /** The strip under the palette: what the hovered or selected piece is and costs. */
  private paintDetail(player: Player): void {
    const entry = this.hovered ?? entryFor(this.selection);
    if (!entry) return;
    const key = `${selectionKey(entry.selection)}:${entry.cost
      .map((c) => (countItem(player, c.id) >= c.count ? 1 : 0))
      .join('')}`;
    if (key === this.detailKey) return;
    this.detailKey = key;

    this.els.buildDetail.innerHTML =
      `<i class="piece" style="background-image:${pieceIconVar(selectionKey(entry.selection))}"></i>` +
      `<div><b></b><p></p></div>${costHtml(entry.cost, player)}`;
    // Descriptions are table text; set as text so they can never be markup.
    (this.els.buildDetail.querySelector('b') as HTMLElement).textContent = entry.name;
    (this.els.buildDetail.querySelector('p') as HTMLElement).textContent = entry.description;
  }

  private select(selection: BuildSelection): void {
    this.selection = selection;
    this.callbacks.onSelect(selection);
  }

  private buildHotbar(): void {
    this.els.hotbar.innerHTML = '';
    this.hotbarKey = '';
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const cell = document.createElement('button');
      cell.className = 'quick';
      cell.dataset.index = String(i);
      cell.addEventListener('click', () => this.useHotbar(i));
      // Right-click clears a slot, the same button that removes in the world.
      cell.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.clearHotbar(i);
      });
      this.els.hotbar.appendChild(cell);
    }
    this.paintHotbar();
  }

  /** Redraw the labels. Only the binding changes them, so not every frame. */
  private paintHotbar(): void {
    const cells = Array.from(this.els.hotbar.children) as HTMLElement[];
    for (let i = 0; i < cells.length; i++) {
      const binding = this.hotbar[i];
      const entry = binding ? entryFor(binding) : undefined;
      cells[i].classList.toggle('empty', !entry);
      cells[i].title = entry
        ? `${entry.name} — ${entry.description}`
        : `Empty — select a piece and press shift+${i + 1}`;
      cells[i].dataset.name = entry ? entry.name : '';
      const art = binding && entry ? `<i class="piece" style="background-image:${pieceIconVar(selectionKey(binding))}"></i>` : '';
      cells[i].innerHTML = `${art}<kbd>${i + 1}</kbd>`;
    }
  }

  /**
   * Press a number: place what that slot holds. Pressing the slot already
   * selected leaves build mode again, so one key is the whole round trip.
   */
  useHotbar(index: number): void {
    const binding = this.hotbar[index];
    if (!binding) {
      this.toast(`Quick slot ${index + 1} is empty — shift+${index + 1} binds the selected piece`);
      return;
    }

    const same = selectionKey(binding) === selectionKey(this.selection);
    if (same && this.buildMode) {
      this.callbacks.onToggleBuild();
      return;
    }

    this.showTab(tabOf(binding));
    this.select(binding);
  }

  /** Shift-number: put whatever is selected into that slot. */
  bindHotbar(index: number): void {
    const entry = entryFor(this.selection);
    if (!entry) return;

    // A piece lives in one slot only, so binding it moves it rather than
    // leaving the player with two keys for the same thing.
    const existing = slotOf(this.hotbar, this.selection);
    if (existing >= 0) this.hotbar[existing] = null;
    this.hotbar[index] = this.selection;

    saveHotbar(this.hotbar);
    this.paintHotbar();
    this.toast(`${entry.name} on quick slot ${index + 1}`, 'good');
  }

  private clearHotbar(index: number): void {
    if (!this.hotbar[index]) return;
    this.hotbar[index] = null;
    saveHotbar(this.hotbar);
    this.paintHotbar();
  }

  private updateHotbar(player: Player): void {
    const active = slotOf(this.hotbar, this.selection);
    const key = `${active}:${this.buildMode}:${this.hotbar
      .map((b) => (b && hasAll(player, entryFor(b)?.cost ?? []) ? '1' : '0'))
      .join('')}`;
    if (key === this.hotbarKey) return;
    this.hotbarKey = key;

    const cells = Array.from(this.els.hotbar.children) as HTMLElement[];
    for (let i = 0; i < cells.length; i++) {
      const binding = this.hotbar[i];
      cells[i].classList.toggle('on', i === active && this.buildMode);
      cells[i].classList.toggle(
        'poor',
        !!binding && !hasAll(player, entryFor(binding)?.cost ?? []),
      );
    }
  }

  toast(message: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${tone === 'info' ? '' : tone}`.trim();
    el.textContent = message;
    this.els.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, 1900);
  }

  update(world: World, player: Player): void {
    this.updatePhase(world);
    this.updateVitals(player);
    this.updatePouch(player);
    this.updateDash(player);
    this.updateOffers(player);
    this.updateHotbar(player);
    this.updateResearch(world);
    this.inventory.update(player, this.liveMachine(world), world);
    if (this.buildMode) {
      this.updateBuildAffordability(player);
      this.paintDetail(player);
    }
  }

  /** The on-screen stick, drawn under the thumb that is steering. */
  updateStick(stick: { active: boolean; origin: { x: number; y: number }; pos: { x: number; y: number } }): void {
    this.els.stick.classList.toggle('hidden', !stick.active);
    if (!stick.active) return;
    const reach = 34;
    let dx = stick.pos.x - stick.origin.x;
    let dy = stick.pos.y - stick.origin.y;
    const length = Math.hypot(dx, dy);
    if (length > reach) {
      dx = (dx / length) * reach;
      dy = (dy / length) * reach;
    }
    this.els.stick.style.left = `${stick.origin.x}px`;
    this.els.stick.style.top = `${stick.origin.y}px`;
    this.els.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** Re-resolve the open machine each frame, so removing it closes the screen. */
  private liveMachine(world: World): Machine | null {
    const open = this.inventory.inspecting;
    if (!open) return null;
    return world.machines.find((m) => m.id === open.id) ?? null;
  }

  /**
   * The island's research, beside the player's own bars. It appears once a
   * tech is chosen and not before: nothing is more confusing on minute one
   * than a progress bar for a thing that does not exist yet.
   */
  private updateResearch(world: World): void {
    const tech = activeTech(world);
    this.els.research.classList.toggle('hidden', !tech);
    if (!tech) return;

    const done = cyclesDone(world, tech.id);
    const needed = cyclesNeeded(world, tech);
    this.els.researchFill.style.width = `${(done / needed) * 100}%`;
    this.els.researchText.textContent = `${tech.name} ${done} / ${needed}`;
  }

  private updatePhase(world: World): void {
    const night = world.phase === 'night';
    const total = night ? CYCLE.nightSeconds : CYCLE.daySeconds;
    const seconds = Math.max(0, Math.ceil(world.phaseTime));

    this.els.topbar.classList.toggle('night', night);
    this.els.phaseName.textContent = night ? `Night ${world.nightIndex}` : `Day ${world.nightIndex + 1}`;
    this.els.phaseSub.textContent = night
      ? world.peaceful
        ? 'All quiet until dawn'
        : `${world.mobs.length} out there · until dawn`
      : world.peaceful
        ? 'A peaceful island'
        : `Until night ${world.nightIndex + 1}`;
    this.els.phaseTime.textContent = formatSeconds(seconds);
    this.els.phaseFill.style.width = `${(world.phaseTime / total) * 100}%`;
  }

  private updateVitals(player: Player): void {
    this.els.level.textContent = String(player.level);
    this.els.levelRing.style.setProperty('--p', String(Math.min(1, player.xp / player.xpToNext)));
    const hp = Math.max(0, Math.round(player.hp));
    this.els.hpFill.style.width = `${(hp / player.maxHp) * 100}%`;
    this.els.hpText.textContent = `${hp} / ${player.maxHp}`;
    this.els.xpFill.style.width = `${(player.xp / player.xpToNext) * 100}%`;
    this.els.xpText.textContent = `${Math.floor(player.xp)} / ${player.xpToNext}`;
  }

  private updatePouch(player: Player): void {
    const totals = new Map<string, number>();
    for (const stack of player.inventory) {
      if (stack) totals.set(stack.id, (totals.get(stack.id) ?? 0) + stack.count);
    }
    const key = [...totals].map(([id, n]) => `${id}:${n}`).join(',');
    if (key === this.pouchKey) return;
    this.pouchKey = key;

    this.els.pouch.innerHTML = '';
    this.els.pouch.classList.toggle('hidden', totals.size === 0);
    for (const [id, count] of totals) {
      const def = ITEMS[id as keyof typeof ITEMS];
      const chip = document.createElement('div');
      chip.className = 'res';
      // A count that just went up flashes, so a haul registers without reading.
      if (count > (this.pouchCounts.get(id) ?? Infinity)) chip.classList.add('bump');
      chip.innerHTML = `<i class="res-icon" style="background-image:${itemIconVar(id as ItemId)}"></i>${formatCount(count)}`;
      chip.title = `${def.name} — ${count}`;
      this.els.pouch.appendChild(chip);
    }
    this.pouchCounts = totals;
  }

  private updateDash(player: Player): void {
    const fraction = player.dashCd > 0 ? player.dashCd / 1.6 : 0;
    this.els.dashCd.style.transform = `scaleY(${fraction})`;
  }

  private updateOffers(player: Player): void {
    const showing = player.pendingUpgrades > 0 && player.offers.length > 0;
    this.els.levelup.classList.toggle('hidden', !showing);
    if (!showing) {
      this.offerKey = '';
      return;
    }

    const key = player.offers.map((o) => o.id).join('|') + player.pendingUpgrades;
    if (key === this.offerKey) return;
    this.offerKey = key;

    this.els.levelupTitle.textContent =
      player.pendingUpgrades > 1
        ? `Choose an upgrade (${player.pendingUpgrades} pending)`
        : 'Choose an upgrade';

    this.els.offers.innerHTML = '';
    for (const offer of player.offers) {
      const button = document.createElement('button');
      button.className = 'offer';
      button.innerHTML = `<b>${offer.title}</b><span>${offer.description}</span>`;
      button.addEventListener('click', () => {
        audio.play('levelUp');
        this.callbacks.onChooseUpgrade(offer.id);
      });
      this.els.offers.appendChild(button);
    }
  }

  private updateBuildAffordability(player: Player): void {
    const current = selectionKey(this.selection);
    const entries = entriesFor(this.tab);

    for (const button of Array.from(this.els.buildItems.children) as HTMLElement[]) {
      const key = button.dataset.key ?? '';
      const entry = entries.find((e) => selectionKey(e.selection) === key);
      button.classList.toggle('on', key === current);
      button.classList.toggle('poor', entry ? !hasAll(player, entry.cost) : false);
    }
  }
}

/**
 * A cost as the items themselves. Given a player, each ingredient they are
 * short of is marked, so "why can't I place this" is answered on the card.
 */
function costHtml(cost: ItemStack[], player?: Player): string {
  const parts = cost.map((c) => {
    const short = player ? countItem(player, c.id) < c.count : false;
    return (
      `<span class="${short ? 'short' : ''}" title="${ITEMS[c.id].name}">` +
      `<i style="background-image:${itemIconVar(c.id)}"></i>${c.count}</span>`
    );
  });
  return `<span class="cost">${parts.join('')}</span>`;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Counts past four digits are abbreviated so a chip never grows wider than its icon. */
function formatCount(n: number): string {
  if (n < 10000) return String(n);
  if (n < 1000000) return `${Math.floor(n / 100) / 10}k`;
  return `${Math.floor(n / 100000) / 10}m`;
}
