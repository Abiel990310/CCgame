import { ITEMS } from '@shared/data/items';
import { CYCLE } from '@shared/sim/constants';
import { activeTech, cyclesDone, cyclesNeeded } from '@shared/sim/research';
import { hasAll } from '@shared/sim/inventory';
import type { ClickButton, SlotArea, SlotRef } from '@shared/sim/containers';
import type { Machine, Player, World } from '@shared/sim/types';
import { InventoryScreen } from './inventory';
import {
  TABS,
  entriesFor,
  entryFor,
  selectionKey,
  tabOf,
  type BuildSelection,
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
    topbar: $<HTMLElement>('phase').parentElement as HTMLElement,
    phaseIcon: $('phase-icon'),
    phaseName: $('phase-name'),
    phaseSub: $('phase-sub'),
    phaseFill: $('phase-fill'),
    level: $('level'),
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
  };

  private inventory: InventoryScreen;
  private selection: BuildSelection = { kind: 'belt' };
  private tab: PaletteTab = 'factory';
  private buildMode = false;
  private pauseOpen = false;
  /** Signature of the last rendered offer set, to avoid rebuilding every frame. */
  private offerKey = '';
  private pouchKey = '';
  private hotbarKey = '';
  /** What each quick slot places. A client preference, saved on every change. */
  private hotbar: HotbarBinding[] = loadHotbar();

  constructor(private callbacks: HudCallbacks) {
    this.els.btnBuild.addEventListener('click', () => this.callbacks.onToggleBuild());
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
    this.els.pauseName.textContent = slotName;
    this.els.pauseSub.textContent = subtitle;
  }

  get isPauseOpen(): boolean {
    return this.pauseOpen;
  }

  setBuildMode(on: boolean): void {
    this.buildMode = on;
    this.els.buildbar.classList.toggle('hidden', !on);
    this.els.btnBuild.classList.toggle('on', on);
  }

  /** Open the inventory screen, on its own or beside a container. */
  openInventory(machine: Machine | null): void {
    this.inventory.show(machine);
    this.els.btnBag.classList.toggle('on', machine === null);
  }

  closeInventory(): void {
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
      button.textContent = tab.label;
      button.addEventListener('click', () => {
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
    for (const entry of entriesFor(this.tab)) {
      const button = document.createElement('button');
      button.className = 'build-option';
      button.dataset.key = selectionKey(entry.selection);
      button.title = entry.description;
      button.innerHTML = `<b>${entry.name}</b><em>${entry.cost
        .map((c) => `${c.count} ${ITEMS[c.id].name}`)
        .join(' · ')}</em>`;
      button.addEventListener('click', () => this.select(entry.selection));
      this.els.buildItems.appendChild(button);
    }
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
      cells[i].innerHTML = `<kbd>${i + 1}</kbd><b>${entry ? entry.name : '—'}</b>`;
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
    this.inventory.update(world, player, this.liveMachine(world));
    if (this.buildMode) this.updateBuildAffordability(player);
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
    this.els.phaseIcon.textContent = night ? '🌙' : '☀';
    this.els.phaseName.textContent = night ? `Night ${world.nightIndex}` : 'Day';
    this.els.phaseSub.textContent = night
      ? world.peaceful
        ? `${seconds}s until dawn · all quiet`
        : `${seconds}s until dawn · ${world.mobs.length} out there`
      : `Night ${world.nightIndex + 1} in ${seconds}s`;
    this.els.phaseFill.style.width = `${(world.phaseTime / total) * 100}%`;
  }

  private updateVitals(player: Player): void {
    this.els.level.textContent = String(player.level);
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
    for (const [id, count] of totals) {
      const def = ITEMS[id as keyof typeof ITEMS];
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `<i class="dot" style="background:${def.color}"></i>${count}`;
      chip.title = def.name;
      this.els.pouch.appendChild(chip);
    }
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
      button.addEventListener('click', () => this.callbacks.onChooseUpgrade(offer.id));
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
