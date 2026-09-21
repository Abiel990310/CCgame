import { ITEMS } from '@shared/data/items';
import { MACHINES } from '@shared/data/machines';
import { recipesFor } from '@shared/data/recipes';
import { CYCLE } from '@shared/sim/constants';
import { hasAll } from '@shared/sim/inventory';
import type { Machine, Player, World } from '@shared/sim/types';
import {
  TABS,
  entriesFor,
  selectionKey,
  type BuildSelection,
  type PaletteTab,
} from './palette';

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
  onStart: (fresh: boolean, peaceful: boolean) => void;
  onSetRecipe: (machineId: number, recipeId: string) => void;
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
    pouch: $('pouch'),
    buildbar: $('buildbar'),
    buildTabs: $('buildbar-tabs'),
    buildItems: $('buildbar-items'),
    machine: $('machine'),
    machineKind: $('machine-kind'),
    machineTitle: $('machine-title'),
    machineIo: $('machine-io'),
    machineRecipes: $('machine-recipes'),
    machineClose: $<HTMLButtonElement>('machine-close'),
    peaceful: $<HTMLInputElement>('opt-peaceful'),
    btnBuild: $<HTMLButtonElement>('btn-build'),
    btnBag: $<HTMLButtonElement>('btn-bag'),
    btnDash: $<HTMLButtonElement>('btn-dash'),
    dashCd: $('dash-cd'),
    levelup: $('levelup'),
    levelupTitle: $('levelup-title'),
    offers: $('offers'),
    bag: $('bag'),
    bagGrid: $('bag-grid'),
    bagClose: $<HTMLButtonElement>('bag-close'),
    start: $('start'),
    btnContinue: $<HTMLButtonElement>('btn-continue'),
    btnNew: $<HTMLButtonElement>('btn-new'),
    toasts: $('toasts'),
  };

  private selection: BuildSelection = { kind: 'belt' };
  private tab: PaletteTab = 'factory';
  private inspecting: Machine | null = null;
  private buildMode = false;
  private bagOpen = false;
  /** Signature of the last rendered offer set, to avoid rebuilding every frame. */
  private offerKey = '';
  private pouchKey = '';

  constructor(private callbacks: HudCallbacks) {
    this.els.btnBuild.addEventListener('click', () => this.callbacks.onToggleBuild());
    this.els.btnBag.addEventListener('click', () => this.callbacks.onToggleBag());
    this.els.btnDash.addEventListener('click', () => this.callbacks.onDash());
    this.els.bagClose.addEventListener('click', () => this.callbacks.onToggleBag());
    this.els.btnContinue.addEventListener('click', () => this.dismissStart(false));
    this.els.btnNew.addEventListener('click', () => this.dismissStart(true));
    this.els.machineClose.addEventListener('click', () => this.closeMachine());
    this.buildTabs();
    this.buildPalette();
  }

  private dismissStart(fresh: boolean): void {
    this.els.start.classList.add('hidden');
    this.callbacks.onStart(fresh, this.els.peaceful.checked);
  }

  showStart(canContinue: boolean): void {
    this.els.btnContinue.textContent = canContinue ? 'Continue' : 'Begin';
    this.els.btnNew.classList.toggle('hidden', !canContinue);
    this.els.start.classList.remove('hidden');
  }

  setBuildMode(on: boolean): void {
    this.buildMode = on;
    this.els.buildbar.classList.toggle('hidden', !on);
    this.els.btnBuild.classList.toggle('on', on);
  }

  setBagOpen(open: boolean): void {
    this.bagOpen = open;
    this.els.bag.classList.toggle('hidden', !open);
    this.els.btnBag.classList.toggle('on', open);
  }

  get isBuildMode(): boolean {
    return this.buildMode;
  }

  get selected(): BuildSelection {
    return this.selection;
  }

  get isInspecting(): boolean {
    return this.inspecting !== null;
  }

  private buildTabs(): void {
    this.els.buildTabs.innerHTML = '';
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.className = `tab${tab.id === this.tab ? ' on' : ''}`;
      button.textContent = tab.label;
      button.addEventListener('click', () => {
        this.tab = tab.id;
        this.buildTabs();
        this.buildPalette();
        // Switching tabs selects that tab's first entry, so the ghost is valid.
        const first = entriesFor(this.tab)[0];
        if (first) this.select(first.selection);
      });
      this.els.buildTabs.appendChild(button);
    }
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

  openMachine(machine: Machine): void {
    this.inspecting = machine;
    const def = MACHINES[machine.type];
    this.els.machineTitle.textContent = def.name;
    this.els.machineKind.textContent = def.description;
    this.els.machine.classList.remove('hidden');
    this.renderMachineRecipes(machine);
    this.renderMachineIo(machine);
  }

  closeMachine(): void {
    this.inspecting = null;
    this.els.machine.classList.add('hidden');
  }

  private renderMachineRecipes(machine: Machine): void {
    this.els.machineRecipes.innerHTML = '';
    if (!MACHINES[machine.type].choosesRecipe) return;

    for (const recipe of recipesFor(machine.type)) {
      const button = document.createElement('button');
      button.className = 'offer';
      const inputs = recipe.inputs.map((i) => `${i.count} ${ITEMS[i.id].name}`).join(' + ');
      const outputs = recipe.outputs.map((o) => `${o.count} ${ITEMS[o.id].name}`).join(' + ');
      button.innerHTML = `<b>${recipe.name}</b><span>${inputs} → ${outputs}<br>${recipe.time}s</span>`;
      if (machine.recipe === recipe.id) button.style.borderColor = 'var(--gold)';
      button.addEventListener('click', () => {
        this.callbacks.onSetRecipe(machine.id, recipe.id);
        this.renderMachineRecipes(machine);
      });
      this.els.machineRecipes.appendChild(button);
    }
  }

  private renderMachineIo(machine: Machine): void {
    const group = (label: string, stacks: typeof machine.input): string => {
      const body = stacks.length
        ? stacks
            .map(
              (s) =>
                `<span class="io-stack"><i class="dot" style="background:${
                  ITEMS[s.id].color
                }"></i>${s.count}</span>`,
            )
            .join('')
        : '<span class="io-empty">empty</span>';
      return `<div class="io-group"><b>${label}</b><div class="io-stacks">${body}</div></div>`;
    };

    const def = MACHINES[machine.type];
    const parts: string[] = [];
    if (def.inputSlots > 0) parts.push(group('In', machine.input));
    if (def.outputSlots > 0) parts.push(group('Out', machine.output));
    this.els.machineIo.innerHTML = parts.join('');
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
    if (this.bagOpen) this.updateBag(player);
    if (this.buildMode) this.updateBuildAffordability(player);
    // The inspector shows live contents, so refresh it while it is open.
    if (this.inspecting) this.renderMachineIo(this.inspecting);
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
      totals.set(stack.id, (totals.get(stack.id) ?? 0) + stack.count);
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

  private updateBag(player: Player): void {
    this.els.bagGrid.innerHTML = '';
    for (const stack of player.inventory) {
      const def = ITEMS[stack.id];
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<i class="dot" style="background:${def.color}"></i><b>${stack.count}</b>${def.name}`;
      this.els.bagGrid.appendChild(slot);
    }
    if (player.inventory.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'blurb';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'Nothing yet. Go chop something.';
      this.els.bagGrid.appendChild(empty);
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
