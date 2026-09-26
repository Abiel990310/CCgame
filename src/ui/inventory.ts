import { ITEMS, ITEM_ORDER } from '@shared/data/items';
import { FUEL_VALUE, MACHINES } from '@shared/data/machines';
import { RECIPE_BY_ID, craftTime, recipesFor } from '@shared/data/recipes';
import { TECHS, TECH_BY_ID } from '@shared/data/techs';
import { minerOreLeft } from '@shared/sim/ore';
import { INVENTORY_SLOTS } from '@shared/sim/inventory';
import {
  activeTech,
  cyclesDone,
  cyclesNeeded,
  isAvailable,
  isFinished,
  techLevel,
  type QueueOp,
} from '@shared/sim/research';
import { countIn, totalIn } from '@shared/sim/slots';
import { BEACON_BOOST, BEACON_STAGES, BEACON_WARD_TILES } from '@shared/data/beacon';
import { beaconLit, beaconStage } from '@shared/sim/beacon';
import { audio } from '../audio';
import type { ClickButton, SlotArea, SlotRef } from '@shared/sim/containers';
import { filterOf, hasSettings, hasSlotFilters } from '@shared/sim/factory';
import type { ItemId, Machine, MachineFamily, Player, Slot, World } from '@shared/sim/types';
import { itemIconVar } from '../render/items';
import { pieceIconVar } from '../render/pieces';
import { icon } from './icons';
import { buildKey, buildSummary } from './upgradecard';

export interface InventoryCallbacks {
  /** A slot was clicked: pick up, put down, split, or send across. */
  onSlotAction: (ref: SlotRef, button: ClickButton, quick: boolean) => void;
  onTakeAll: () => void;
  /** Tidy one grid: loose stacks merged, laid out in table order. */
  onSort: (area: SlotArea) => void;
  /** Double-click: pull every loose stack of this item into this slot. */
  onGather: (ref: SlotRef) => void;
  onSetRecipe: (machineId: number, recipeId: string) => void;
  /** Reorder the island's research queue. Research belongs to the world. */
  onQueueResearch: (techId: string, op: QueueOp) => void;
  /** Restrict an inserter to one item, or clear it with null. */
  onSetFilter: (machineId: number, item: ItemId | null) => void;
  /** Lift this machine's settings, or put the copied ones on it. */
  onCopySettings: (machineId: number) => void;
  onPasteSettings: (machineId: number) => void;
  onClose: () => void;
}

/** How far the pointer must travel between press and release to count as a drag. */
const DRAG_SLOP = 6;

interface Grid {
  area: SlotArea;
  el: HTMLElement;
  cells: HTMLElement[];
}

/**
 * The inventory screen: the player's bag, and whatever container is open,
 * shown together as grids of slots that items are dragged between.
 *
 * All it does is read slots and report clicks. Every rule about what may go
 * where lives in `shared/sim/containers.ts`, so the screen cannot invent an
 * item or move one somewhere the simulation would not allow.
 */
export class InventoryScreen {
  private root: HTMLElement;
  private els: {
    eyebrow: HTMLElement;
    icon: HTMLElement;
    title: HTMLElement;
    blurb: HTMLElement;
    container: HTMLElement;
    inputLabel: HTMLElement;
    inputGrid: HTMLElement;
    filterBlock: HTMLElement;
    filterGrid: HTMLElement;
    fuelBlock: HTMLElement;
    fuelGrid: HTMLElement;
    fuelNote: HTMLElement;
    outputBlock: HTMLElement;
    outputGrid: HTMLElement;
    progress: HTMLElement;
    progressFill: HTMLElement;
    takeAll: HTMLButtonElement;
    filterMode: HTMLButtonElement;
    filterHint: HTMLElement;
    settings: HTMLElement;
    copy: HTMLButtonElement;
    paste: HTMLButtonElement;
    sortInput: HTMLButtonElement;
    sortBag: HTMLButtonElement;
    recipes: HTMLElement;
    research: HTMLElement;
    bagGrid: HTMLElement;
    bagNote: HTMLElement;
    build: HTMLElement;
    buildNote: HTMLElement;
    buildList: HTMLElement;
    close: HTMLButtonElement;
    carried: HTMLElement;
  };

  private grids: Grid[] = [];
  private machine: Machine | null = null;
  private open = false;
  /** Where the pointer went down, so a release elsewhere reads as a drag. */
  private pressAt: { x: number; y: number } | null = null;
  private pressRef: SlotRef | null = null;
  /** Signature of what is drawn, so the DOM is only touched when it changes. */
  private painted = '';
  private recipeKey = '';
  private buildKey = '';
  /**
   * While on, a click on a chest slot sets its filter instead of moving items.
   * A mode rather than a modifier, so it is discoverable and works by touch.
   */
  private filtering = false;
  /** Which family the copied settings fit, or null when nothing is copied. */
  private clipboard: MachineFamily | null = null;

  constructor(private callbacks: InventoryCallbacks) {
    this.root = must('inv');
    this.els = {
      eyebrow: must('inv-eyebrow'),
      icon: must('inv-icon'),
      title: must('inv-title'),
      blurb: must('inv-blurb'),
      container: must('inv-container'),
      inputLabel: must('inv-input-label'),
      inputGrid: must('inv-input-grid'),
      filterBlock: must('inv-filters'),
      filterGrid: must('inv-filter-grid'),
      fuelBlock: must('inv-fuel'),
      fuelGrid: must('inv-fuel-grid'),
      fuelNote: must('inv-fuel-note'),
      outputBlock: must('inv-output'),
      outputGrid: must('inv-output-grid'),
      progress: must('inv-progress'),
      progressFill: must('inv-progress-fill'),
      takeAll: must<HTMLButtonElement>('inv-take-all'),
      filterMode: must<HTMLButtonElement>('inv-filter-mode'),
      filterHint: must('inv-filter-hint'),
      settings: must('inv-settings'),
      copy: must<HTMLButtonElement>('inv-copy'),
      paste: must<HTMLButtonElement>('inv-paste'),
      sortInput: must<HTMLButtonElement>('inv-sort-input'),
      sortBag: must<HTMLButtonElement>('inv-sort-bag'),
      recipes: must('inv-recipes'),
      research: must('inv-research'),
      bagGrid: must('inv-bag-grid'),
      bagNote: must('inv-bag-note'),
      build: must('inv-build'),
      buildNote: must('inv-build-note'),
      buildList: must('inv-build-list'),
      close: must<HTMLButtonElement>('inv-close'),
      carried: must('inv-carried'),
    };

    this.grids = [
      { area: 'input', el: this.els.inputGrid, cells: [] },
      { area: 'filter', el: this.els.filterGrid, cells: [] },
      { area: 'fuel', el: this.els.fuelGrid, cells: [] },
      { area: 'output', el: this.els.outputGrid, cells: [] },
      { area: 'bag', el: this.els.bagGrid, cells: [] },
    ];
    this.buildGrid('bag', INVENTORY_SLOTS);

    this.els.close.addEventListener('click', () => this.callbacks.onClose());
    this.els.takeAll.addEventListener('click', () => {
      audio.play('click');
      this.callbacks.onTakeAll();
    });
    this.els.filterMode.addEventListener('click', () => {
      audio.play('click');
      this.setFiltering(!this.filtering);
    });
    this.els.copy.addEventListener('click', () => {
      if (this.machine) this.callbacks.onCopySettings(this.machine.id);
    });
    this.els.paste.addEventListener('click', () => {
      if (this.machine) this.callbacks.onPasteSettings(this.machine.id);
    });
    this.els.sortInput.addEventListener('click', () => {
      audio.play('click');
      this.callbacks.onSort('input');
    });
    this.els.sortBag.addEventListener('click', () => {
      audio.play('click');
      this.callbacks.onSort('bag');
    });
    // Right-click is a split, not the browser's menu.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.root.addEventListener('pointermove', (e) => this.moveCarried(e.clientX, e.clientY));
    // Double-click gathers. The two clicks under it have already picked the
    // stack up and put it back, so the slot is exactly as it was.
    this.root.addEventListener('dblclick', (e) => {
      if (this.filtering) return;
      const ref = refAt(e.target);
      if (ref) this.callbacks.onGather(ref);
    });
    // Clicking the backdrop closes, the way every other modal here behaves.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.callbacks.onClose();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** True when a machine is open, which is also what suppresses world clicks. */
  get inspecting(): Machine | null {
    return this.open ? this.machine : null;
  }

  show(machine: Machine | null): void {
    this.open = true;
    this.machine = machine;
    this.painted = '';
    this.recipeKey = '';
    this.buildKey = '';
    this.pressRef = null;
    this.root.classList.remove('hidden');
    this.layout(machine);
    this.setFiltering(false);
  }

  setClipboard(family: MachineFamily | null): void {
    this.clipboard = family;
    this.paintPaste();
  }

  private setFiltering(on: boolean): void {
    this.filtering = on && !!this.machine && hasSlotFilters(this.machine);
    this.els.filterMode.textContent = this.filtering ? 'Done' : 'Filter slots';
    this.els.filterMode.classList.toggle('on', this.filtering);
    this.els.inputGrid.classList.toggle('filtering', this.filtering);
    this.els.filterHint.classList.toggle('hidden', !this.filtering);
    this.painted = '';
  }

  /** Paste is offered only where the copied settings would actually go. */
  private paintPaste(): void {
    const machine = this.machine;
    const fits = !!machine && this.clipboard === MACHINES[machine.type].family;
    this.els.paste.disabled = !fits;
  }

  hide(): void {
    this.open = false;
    this.machine = null;
    this.pressRef = null;
    this.root.classList.add('hidden');
    this.els.carried.classList.add('hidden');
  }

  /** Rebuild the parts that only change when a different container is opened. */
  private layout(machine: Machine | null): void {
    if (!machine) {
      this.els.eyebrow.textContent = 'Carrying';
      this.els.title.textContent = 'Your bag';
      this.els.icon.classList.add('hidden');
      this.els.blurb.classList.add('hidden');
      this.els.container.classList.add('hidden');
      this.els.research.classList.add('hidden');
      this.els.recipes.innerHTML = '';
      this.els.build.classList.remove('hidden');
      return;
    }
    this.els.build.classList.add('hidden');

    const def = MACHINES[machine.type];
    const lab = def.family === 'lab';
    const arm = def.family === 'inserter';
    this.els.eyebrow.textContent = lab
      ? 'Research'
      : def.family === 'beacon'
        ? 'Great work'
      : def.choosesRecipe
        ? 'Machine'
        : arm
          ? 'Arm'
          : def.family === 'splitter' || def.family === 'merger' || def.family === 'tunnel'
            ? 'Logistics'
            : 'Storage';
    this.els.title.textContent = def.name;
    this.els.icon.classList.remove('hidden');
    this.els.icon.style.backgroundImage = pieceIconVar(`machine:${machine.type}`);
    this.els.blurb.textContent = def.description;
    this.els.blurb.classList.remove('hidden');
    this.els.container.classList.remove('hidden');

    // A chest's grid is its whole point, so it is not labelled "In". An
    // inserter's one slot is the hand, holding whatever is mid-swing, and a
    // splitter's is a queue rather than a shelf.
    this.els.inputLabel.textContent = lab
      ? 'Packs'
      : def.family === 'beacon'
        ? beaconLit(machine)
          ? 'Fuel'
          : 'Delivered'
      : def.choosesRecipe
        ? 'In'
        : arm
          ? 'Holding'
          : def.family === 'splitter' || def.family === 'merger' || def.family === 'tunnel'
            ? 'Passing through'
            : 'Stored';
    this.els.inputGrid.parentElement?.classList.toggle('hidden', def.inputSlots === 0);
    this.els.outputBlock.classList.toggle('hidden', def.outputSlots === 0);
    // A lab has a cycle like a crafter does, even though it chooses no recipe.
    this.els.progress.classList.toggle('hidden', !def.choosesRecipe && !lab);
    this.els.research.classList.toggle('hidden', !lab);

    // A splitter's buffer is a queue of one item; there is nothing to tidy.
    this.els.sortInput.classList.toggle(
      'hidden',
      def.inputSlots < 2 || def.family === 'splitter' || def.family === 'merger',
    );
    this.els.filterBlock.classList.toggle('hidden', def.family !== 'splitter');
    this.els.filterMode.classList.toggle('hidden', !hasSlotFilters(machine));
    this.els.settings.classList.toggle('hidden', !hasSettings(machine));
    this.paintPaste();
    this.els.fuelBlock.classList.toggle('hidden', def.fuelSlots === 0);

    this.buildGrid('input', def.inputSlots);
    this.buildGrid('fuel', def.fuelSlots);
    this.buildGrid('output', def.outputSlots);
    if (def.family === 'splitter') this.buildSides();
  }

  /**
   * A splitter's two sides, as slots. They hold nothing — clicking one with a
   * stack in hand points that side at the item without spending any of it,
   * which is the same gesture as moving items and needs no second grammar.
   */
  private buildSides(): void {
    const grid = this.grids.find((g) => g.area === 'filter')!;
    if (grid.cells.length === 2) return;

    grid.el.innerHTML = '';
    grid.cells = [];
    for (const [index, name] of ['Left', 'Right'].entries()) {
      const wrap = document.createElement('div');
      wrap.className = 'filter-cell';

      const cell = document.createElement('div');
      cell.className = 'islot';
      cell.dataset.area = 'filter';
      cell.dataset.index = String(index);

      const caption = document.createElement('span');
      caption.textContent = name;

      wrap.append(cell, caption);
      grid.el.appendChild(wrap);
      grid.cells.push(cell);
    }
  }

  private buildGrid(area: SlotArea, count: number): void {
    const grid = this.grids.find((g) => g.area === area)!;
    if (grid.cells.length === count) return;

    grid.el.innerHTML = '';
    grid.cells = [];
    // A machine's handful of slots is centred; a full row is left-aligned.
    grid.el.classList.toggle('few', count > 0 && count < 8);
    for (let i = 0; i < count; i++) {
      const cell = document.createElement('div');
      cell.className = 'islot';
      cell.dataset.area = area;
      cell.dataset.index = String(i);
      grid.el.appendChild(cell);
      grid.cells.push(cell);
    }
  }

  update(player: Player, machine: Machine | null, world: World): void {
    if (!this.open) return;
    // The machine object is re-read every frame: removing it while its screen
    // is open must close the screen rather than show a ghost.
    if (this.machine && !machine) {
      this.callbacks.onClose();
      return;
    }
    this.machine = machine;

    const signature = this.signature(player, machine);
    if (signature !== this.painted) {
      this.painted = signature;
      this.paint(player, machine);
    }

    if (machine) this.updateProgress(machine);
    if (machine?.fuel) this.updateFuelNote(machine);
    if (machine && MACHINES[machine.type].family === 'miner') {
      this.updateMinerOre(world, machine);
    }
    if (machine && MACHINES[machine.type].family === 'lab') this.updateResearchNote(world);
    if (machine && MACHINES[machine.type].family === 'beacon') this.updateBeacon(machine);
    if (!machine) this.updateBuild(player);
    this.updatePanel(world, machine);
  }

  private updateBuild(player: Player): void {
    const key = buildKey(player) + player.level;
    if (key === this.buildKey) return;
    this.buildKey = key;
    this.els.buildNote.textContent = `Level ${player.level}`;
    this.els.buildList.innerHTML = buildSummary(player);
  }

  private signature(player: Player, machine: Machine | null): string {
    const slots = (list: Slot[]): string =>
      list.map((s) => (s ? `${s.id}x${s.count}` : '-')).join(',');
    const cursor = player.cursor ? `${player.cursor.id}x${player.cursor.count}` : '-';
    const held = machine
      ? `${slots(machine.input)}|${slots(machine.output)}|${slots(machine.fuel ?? [])}`
      : '';
    const sides = machine?.filters?.join(',') ?? '';
    return `${slots(player.inventory)}|${held}|${cursor}|${sides}|${this.filtering}`;
  }

  private paint(player: Player, machine: Machine | null): void {
    // A bag sewn on at the workbench grows the grid by a row.
    this.buildGrid('bag', player.inventory.length);
    this.paintGrid('bag', player.inventory);
    if (machine) {
      this.paintGrid('input', machine.input, hasSlotFilters(machine) ? machine.filters : undefined);
      this.paintGrid('output', machine.output);
      if (machine.fuel) this.paintGrid('fuel', machine.fuel);
      if (MACHINES[machine.type].family === 'splitter') this.paintSides(machine);
      const stored =
        totalIn(machine.input) + totalIn(machine.output) + totalIn(machine.fuel ?? []);
      this.els.takeAll.disabled = stored === 0;
      this.els.takeAll.textContent = stored === 0 ? 'Empty' : `Take all (${stored})`;
    }

    const used = player.inventory.filter((s) => s !== null).length;
    this.els.bagNote.textContent = `${used} / ${player.inventory.length} slots`;
    this.paintCarried(player);
  }

  private paintGrid(area: SlotArea, slots: Slot[], filters?: (ItemId | null)[]): void {
    const grid = this.grids.find((g) => g.area === area)!;
    for (let i = 0; i < grid.cells.length; i++) {
      paintSlot(grid.cells[i], slots[i] ?? null, filters?.[i] ?? null);
    }
  }

  private paintSides(machine: Machine): void {
    const grid = this.grids.find((g) => g.area === 'filter')!;
    for (let i = 0; i < grid.cells.length; i++) paintSide(grid.cells[i], filterOf(machine, i));
  }

  private paintCarried(player: Player): void {
    const held = player.cursor;
    this.els.carried.classList.toggle('hidden', !held);
    if (!held) return;
    paintSlot(this.els.carried, held);
  }

  private moveCarried(x: number, y: number): void {
    this.els.carried.style.transform = `translate(${x}px, ${y}px)`;
  }

  private updateProgress(machine: Machine): void {
    const def = MACHINES[machine.type];
    if (!def.choosesRecipe && def.family !== 'lab') return;

    const duration =
      def.family === 'lab'
        ? (machine.recipe ? (TECH_BY_ID.get(machine.recipe)?.time ?? 0) : 0)
        : this.craftDuration(machine, def.speed);
    const fraction = duration > 0 ? Math.min(1, machine.progress / duration) : 0;
    this.els.progressFill.style.width = `${fraction * 100}%`;
    this.els.progress.classList.toggle('stalled', machine.stalled);
  }

  /**
   * How long the fuel lasts, counted in crafts of the chosen recipe rather than
   * seconds, because crafts are the number a layout is planned by.
   */
  private updateFuelNote(machine: Machine): void {
    const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
    let heat = Math.max(0, machine.heat ?? 0);
    for (const slot of machine.fuel ?? []) {
      if (slot) heat += (FUEL_VALUE[slot.id] ?? 0) * slot.count;
    }
    const text =
      heat <= 0
        ? 'Out of fuel: feed it coal'
        : recipe
          ? `Enough for ${Math.floor(heat / recipe.time)} crafts`
          : 'Fuelled';
    if (this.els.fuelNote.textContent !== text) this.els.fuelNote.textContent = text;
    this.els.fuelNote.classList.toggle('warn', heat <= 0);
  }

  private craftDuration(machine: Machine, speed: number): number {
    const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
    return recipe ? craftTime(recipe, speed) : 0;
  }

  /** What the island is researching, in a line above the tech list. */
  private updateResearchNote(world: World): void {
    const tech = activeTech(world);
    const text = tech
      ? `Researching <b>${tech.name}</b> — ${cyclesDone(world, tech.id)} / ` +
        `${cyclesNeeded(world, tech)} cycles, ` +
        `${tech.inputs.map((i) => `${i.count} ${ITEMS[i.id].name}`).join(' + ')} each`
      : 'Nothing selected. Every lab on the island works on what you pick below.';
    if (this.els.research.innerHTML !== text) this.els.research.innerHTML = text;
  }

  /** A beacon's blurb is its build sheet: the stage under way and what it still wants. */
  private updateBeacon(machine: Machine): void {
    const current = beaconStage(machine);
    const text = current
      ? `Stage ${current.index + 1} of ${BEACON_STAGES.length}: ${current.stage.name}. Needs ` +
        current.stage.needs
          .map((n) => `${Math.min(n.count, countIn(machine.input, n.id))} / ${n.count} ${ITEMS[n.id].name}`)
          .join(', ') +
        '.'
      : machine.progress > 0
        ? `Burning: every machine, miner and lab on the island works ${Math.round(BEACON_BOOST * 100)}% faster, ` +
          `and creatures within ${BEACON_WARD_TILES} tiles of it slow down. ` +
          `${countIn(machine.input, 'processor')} processors in reserve, ${Math.ceil(machine.progress)}s on the one alight.`
        : `Lit, but banked. Feed it processors and it burns, one a minute, for ${Math.round(BEACON_BOOST * 100)}% faster machines, miners and labs across the island, and a ward that slows creatures near it.`;
    if (this.els.blurb.textContent !== text) this.els.blurb.textContent = text;
  }

  /**
   * A miner has no recipe to show, so its blurb carries the one number that
   * matters instead: how much is left under it before it has to move.
   */
  private updateMinerOre(world: World, machine: Machine): void {
    const left = minerOreLeft(world, machine);
    this.els.blurb.textContent =
      left > 0
        ? `${left.toLocaleString()} ore left within reach.`
        : 'The ground here is worked out. Move it to a fresh patch.';
  }

  /**
   * The panel under the slots: recipes for a machine that crafts, the item
   * filter for an inserter, the tech tree for a lab. Each is rebuilt only when
   * what it shows changes.
   */
  private updatePanel(world: World, machine: Machine | null): void {
    const def = machine ? MACHINES[machine.type] : null;
    const key = !machine
      ? ''
      : def?.family === 'lab'
        ? `lab:${researchKey(world)}`
        : def?.choosesRecipe
          ? `recipe:${machine.id}:${machine.recipe}`
          : def?.family === 'inserter'
            ? `filter:${machine.id}:${machine.filter}`
          : '';
    if (key === this.recipeKey) return;
    this.recipeKey = key;

    this.els.recipes.classList.toggle('filters', key.startsWith('filter:'));
    this.els.recipes.innerHTML = '';
    if (!machine) return;
    if (def?.family === 'lab') {
      this.paintTechs(world);
      return;
    }
    if (def?.family === 'inserter') {
      this.paintFilters(machine);
      return;
    }
    if (!def?.choosesRecipe) return;

    for (const recipe of recipesFor(machine.type)) {
      const button = document.createElement('button');
      button.className = `offer recipe${machine.recipe === recipe.id ? ' on' : ''}`;
      const stack = (id: ItemId, count: number): string =>
        `<span class="stack" title="${ITEMS[id].name}"><i class="ic" style="background-image:${itemIconVar(id)}"></i>${count}</span>`;
      const inputs = recipe.inputs.map((i) => stack(i.id, i.count)).join('');
      const outputs = recipe.outputs.map((o) => stack(o.id, o.count)).join('');
      const seconds = Math.round(craftTime(recipe, def.speed) * 10) / 10;
      button.innerHTML =
        `<b>${recipe.name}</b><span class="recipe-flow">${inputs}${icon('arrow')}${outputs}` +
        `<em>${seconds}s</em></span>`;
      button.addEventListener('click', () => {
        audio.play('click');
        this.callbacks.onSetRecipe(machine.id, recipe.id);
      });
      this.els.recipes.appendChild(button);
    }
  }

  /**
   * The tech tree, as the cards a level-up draft uses. Locked techs stay on the
   * list rather than being hidden: what you are working toward is most of the
   * reason to build another assembler.
   */
  private paintTechs(world: World): void {
    this.paintQueue(world);
    const queue = world.research.queue;
    for (const tech of TECHS) {
      const level = techLevel(world, tech.id);
      const open = isAvailable(world, tech);
      const done = isFinished(world, tech);
      const current = world.research.current === tech.id;
      const place = queue.indexOf(tech.id);

      const button = document.createElement('button');
      button.className = `offer${current ? ' on' : place >= 0 ? ' queued' : ''}`;
      // A locked tech can still be queued: its prerequisites go in ahead of it.
      button.disabled = done;

      const cost = tech.inputs
        .map(
          (i) =>
            `<span class="stack" title="${ITEMS[i.id].name}"><i class="ic" style="background-image:${itemIconVar(i.id)}"></i>${i.count}</span>`,
        )
        .join('');
      const progress = `${cyclesDone(world, tech.id)} / ${cyclesNeeded(world, tech)} cycles`;
      const state = done
        ? 'Done'
        : current
          ? `Researching · ${progress}`
          : place >= 0
            ? `Queued ${place + 1}${ordinal(place + 1)} · click to drop`
            : !open
              ? `Needs ${tech.requires.map((id) => TECH_BY_ID.get(id)?.name ?? id).join(', ')}`
              : progress;
      const name = tech.repeatable && level > 0 ? `${tech.name} ${level + 1}` : tech.name;
      const unlocks = tech.unlocks?.length
        ? `<span class="tech-unlocks">Unlocks ${tech.unlocks.map((id) => MACHINES[id].name).join(', ')}</span>`
        : '';

      button.className += ' tech';
      button.innerHTML =
        `<b>${name}</b><span>${tech.description}</span>${unlocks}` +
        `<span class="recipe-flow">${cost}<em>${tech.time}s · ${state}</em></span>`;
      button.addEventListener('click', () => {
        audio.play('click');
        this.callbacks.onQueueResearch(tech.id, current || place >= 0 ? 'remove' : 'add');
      });
      this.els.recipes.appendChild(button);
    }
  }

  /**
   * The order the labs will work in, above the tree. Each row can move up a
   * place or be dropped; the front row is what every lab is on right now.
   */
  private paintQueue(world: World): void {
    const research = world.research;
    const ids = [...(research.current ? [research.current] : []), ...research.queue];

    const box = document.createElement('div');
    box.className = 'research-queue';
    const head = document.createElement('p');
    head.className = 'filter-head';
    head.textContent = ids.length ? 'Research queue' : 'Research queue is empty';
    box.appendChild(head);
    if (!ids.length) {
      const hint = document.createElement('p');
      hint.className = 'queue-hint';
      hint.textContent = 'Click techs below to line them up. Anything locked brings its prerequisites with it.';
      box.appendChild(hint);
    }

    ids.forEach((id, index) => {
      const tech = TECH_BY_ID.get(id);
      if (!tech) return;
      const row = document.createElement('div');
      row.className = `queue-row${index === 0 && research.current ? ' on' : ''}`;
      const level = techLevel(world, id);
      const name = tech.repeatable && level > 0 ? `${tech.name} ${level + 1}` : tech.name;
      const done = cyclesDone(world, id);
      const needed = cyclesNeeded(world, tech);
      row.innerHTML =
        `<span class="queue-num">${index + 1}</span><b>${name}</b>` +
        `<span class="queue-cycles">${done} / ${needed}</span>`;

      const control = (label: string, title: string, op: QueueOp, enabled: boolean): void => {
        const b = document.createElement('button');
        b.className = 'mini-btn';
        b.textContent = label;
        b.title = title;
        b.disabled = !enabled;
        b.addEventListener('click', () => {
          audio.play('click');
          this.callbacks.onQueueResearch(id, op);
        });
        row.appendChild(b);
      };
      const ahead = index > 0 ? ids[index - 1] : null;
      control('▲', 'Research this sooner', 'up', ahead !== null && !tech.requires.includes(ahead));
      control('✕', 'Take it off the queue', 'remove', true);
      box.appendChild(row);
    });
    this.els.recipes.appendChild(box);
  }

  /**
   * One chip per item, plus "Anything". Every item is offered rather than a
   * curated list, because anything a player can carry can end up in a chest
   * and so can end up as the one thing an arm should pull out of it.
   */
  private paintFilters(machine: Machine): void {
    const head = document.createElement('p');
    head.className = 'filter-head';
    head.textContent = 'Move only';
    this.els.recipes.appendChild(head);

    const chip = (item: ItemId | null): void => {
      const button = document.createElement('button');
      button.className = `offer chip${machine.filter === item ? ' on' : ''}`;
      const icon = item
        ? `<span class="chip-icon"><i class="item" style="background-image:${itemIconVar(item)}"></i></span>`
        : '<span class="chip-icon any"></span>';
      button.innerHTML = `${icon}<b>${item ? ITEMS[item].name : 'Anything'}</b>`;
      button.addEventListener('click', () => this.callbacks.onSetFilter(machine.id, item));
      this.els.recipes.appendChild(button);
    };

    chip(null);
    // A bag is sewn on at the bench and never exists as an item to filter.
    for (const item of ITEM_ORDER) if (ITEMS[item].bag === undefined) chip(item);
  }

  private onPointerDown(event: PointerEvent): void {
    const ref = refAt(event.target);
    this.moveCarried(event.clientX, event.clientY);
    if (!ref) {
      this.pressRef = null;
      return;
    }

    // Filtering, a chest slot takes the splitter's gesture: the click sets a
    // label and moves nothing, so there is no drag to follow either.
    if (this.filtering && ref.area === 'input') {
      event.preventDefault();
      this.pressRef = null;
      audio.play('click');
      this.callbacks.onSlotAction({ area: 'filter', index: ref.index }, 'left', false);
      return;
    }

    event.preventDefault();
    this.pressRef = ref;
    this.pressAt = { x: event.clientX, y: event.clientY };
    audio.play('slot');
    this.callbacks.onSlotAction(ref, event.button === 2 ? 'right' : 'left', event.shiftKey);
  }

  private onPointerUp(event: PointerEvent): void {
    const from = this.pressRef;
    const at = this.pressAt;
    this.pressRef = null;
    if (!from || !at) return;

    // A release on the slot it started on leaves the stack on the cursor, so a
    // click-then-click works as well as a drag does.
    const travelled = Math.hypot(event.clientX - at.x, event.clientY - at.y);
    if (travelled < DRAG_SLOP) return;

    const to = refAt(event.target);
    if (!to || (to.area === from.area && to.index === from.index)) return;
    audio.play('slot');
    this.callbacks.onSlotAction(to, event.button === 2 ? 'right' : 'left', event.shiftKey);
  }
}

/** Everything the tech list draws from, so it repaints when research moves. */
function researchKey(world: World): string {
  const current = world.research.current;
  const levels = TECHS.map((t) => techLevel(world, t.id)).join(',');
  return `${current}:${world.research.queue.join(',')}:${levels}:${current ? cyclesDone(world, current) : 0}`;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
}

function refAt(target: EventTarget | null): SlotRef | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('.islot');
  if (!cell || cell.dataset.index === undefined) return null;
  return { area: cell.dataset.area as SlotArea, index: Number(cell.dataset.index) };
}

/**
 * One slot. `filter` is the item a chest slot is kept for: an empty kept slot
 * shows that item faintly, so a chest's layout reads before anything arrives.
 */
function paintSlot(cell: HTMLElement, slot: Slot, filter: ItemId | null = null): void {
  // Painted every frame the screen is open, so only a change touches the DOM;
  // that also lets a stack that just grew play its bump rather than restart it.
  const key = `${slot ? `${slot.id}:${slot.count}` : '-'}|${filter ?? ''}`;
  const before = cell.dataset.paint;
  if (before === key) return;
  cell.dataset.paint = key;
  const [was, wasCount] = (before ?? '').split('|')[0].split(':');
  const grew = slot !== null && was === slot.id && slot.count > Number(wasCount);
  const arrived = slot !== null && before !== undefined && was !== slot.id;
  if (grew || arrived) {
    cell.classList.remove('bump');
    void cell.offsetWidth;
    cell.classList.add('bump');
  }
  cell.classList.toggle('kept', filter !== null);
  cell.classList.toggle('reserved', filter !== null && !slot);
  const kept = filter ? ` Kept for ${ITEMS[filter].name}.` : '';

  if (!slot) {
    cell.classList.remove('filled');
    cell.innerHTML = filter
      ? `<i class="item" style="background-image:${itemIconVar(filter)}"></i>`
      : '';
    if (filter) cell.title = kept.trim();
    else cell.removeAttribute('title');
    return;
  }

  const def = ITEMS[slot.id];
  cell.classList.add('filled');
  cell.title = `${def.name} — ${slot.count}.${kept}`;
  cell.innerHTML =
    `<i class="item" style="background-image:${itemIconVar(slot.id)}"></i>` +
    `<b>${slot.count}</b>`;
}

function paintSide(cell: HTMLElement, item: ItemId | null): void {
  delete cell.dataset.paint;
  if (!item) {
    cell.className = 'islot any';
    cell.textContent = 'Any';
    cell.title = 'Takes anything. Drop an item here to keep this side for it.';
    return;
  }

  const def = ITEMS[item];
  cell.className = 'islot filled';
  cell.title = `${def.name} only. Click with an empty hand to open this side up.`;
  cell.innerHTML = `<i class="item" style="background-image:${itemIconVar(item)}"></i>`;
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
}
