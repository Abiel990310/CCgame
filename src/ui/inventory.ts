import { ITEMS, ITEM_ORDER } from '@shared/data/items';
import { MACHINES } from '@shared/data/machines';
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
} from '@shared/sim/research';
import { totalIn } from '@shared/sim/slots';
import { audio } from '../audio';
import type { ClickButton, SlotArea, SlotRef } from '@shared/sim/containers';
import { filterOf } from '@shared/sim/factory';
import type { ItemId, Machine, Player, Slot, World } from '@shared/sim/types';
import { itemIconVar } from '../render/items';
import { pieceIconVar } from '../render/pieces';
import { icon } from './icons';

export interface InventoryCallbacks {
  /** A slot was clicked: pick up, put down, split, or send across. */
  onSlotAction: (ref: SlotRef, button: ClickButton, quick: boolean) => void;
  onTakeAll: () => void;
  /** Tidy one grid: loose stacks merged, laid out in table order. */
  onSort: (area: SlotArea) => void;
  /** Double-click: pull every loose stack of this item into this slot. */
  onGather: (ref: SlotRef) => void;
  onSetRecipe: (machineId: number, recipeId: string) => void;
  /** Point every lab on the island at a tech. Research belongs to the world. */
  onSetResearch: (techId: string) => void;
  /** Restrict an inserter to one item, or clear it with null. */
  onSetFilter: (machineId: number, item: ItemId | null) => void;
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
    outputBlock: HTMLElement;
    outputGrid: HTMLElement;
    progress: HTMLElement;
    progressFill: HTMLElement;
    takeAll: HTMLButtonElement;
    sortInput: HTMLButtonElement;
    sortBag: HTMLButtonElement;
    recipes: HTMLElement;
    research: HTMLElement;
    bagGrid: HTMLElement;
    bagNote: HTMLElement;
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
      outputBlock: must('inv-output'),
      outputGrid: must('inv-output-grid'),
      progress: must('inv-progress'),
      progressFill: must('inv-progress-fill'),
      takeAll: must<HTMLButtonElement>('inv-take-all'),
      sortInput: must<HTMLButtonElement>('inv-sort-input'),
      sortBag: must<HTMLButtonElement>('inv-sort-bag'),
      recipes: must('inv-recipes'),
      research: must('inv-research'),
      bagGrid: must('inv-bag-grid'),
      bagNote: must('inv-bag-note'),
      close: must<HTMLButtonElement>('inv-close'),
      carried: must('inv-carried'),
    };

    this.grids = [
      { area: 'input', el: this.els.inputGrid, cells: [] },
      { area: 'filter', el: this.els.filterGrid, cells: [] },
      { area: 'output', el: this.els.outputGrid, cells: [] },
      { area: 'bag', el: this.els.bagGrid, cells: [] },
    ];
    this.buildGrid('bag', INVENTORY_SLOTS);

    this.els.close.addEventListener('click', () => this.callbacks.onClose());
    this.els.takeAll.addEventListener('click', () => {
      audio.play('click');
      this.callbacks.onTakeAll();
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
    this.pressRef = null;
    this.root.classList.remove('hidden');
    this.layout(machine);
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
      return;
    }

    const def = MACHINES[machine.type];
    const lab = def.family === 'lab';
    const arm = def.family === 'inserter';
    this.els.eyebrow.textContent = lab
      ? 'Research'
      : def.choosesRecipe
        ? 'Machine'
        : arm
          ? 'Arm'
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
      : def.choosesRecipe
        ? 'In'
        : arm
          ? 'Holding'
          : def.family === 'splitter'
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
      def.inputSlots < 2 || def.family === 'splitter',
    );
    this.els.filterBlock.classList.toggle('hidden', def.family !== 'splitter');

    this.buildGrid('input', def.inputSlots);
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
    if (machine && MACHINES[machine.type].family === 'miner') {
      this.updateMinerOre(world, machine);
    }
    if (machine && MACHINES[machine.type].family === 'lab') this.updateResearchNote(world);
    this.updatePanel(world, machine);
  }

  private signature(player: Player, machine: Machine | null): string {
    const slots = (list: Slot[]): string =>
      list.map((s) => (s ? `${s.id}x${s.count}` : '-')).join(',');
    const cursor = player.cursor ? `${player.cursor.id}x${player.cursor.count}` : '-';
    const held = machine ? `${slots(machine.input)}|${slots(machine.output)}` : '';
    const sides = machine?.filters?.join(',') ?? '';
    return `${slots(player.inventory)}|${held}|${cursor}|${sides}`;
  }

  private paint(player: Player, machine: Machine | null): void {
    this.paintGrid('bag', player.inventory);
    if (machine) {
      this.paintGrid('input', machine.input);
      this.paintGrid('output', machine.output);
      if (MACHINES[machine.type].family === 'splitter') this.paintSides(machine);
      const stored = totalIn(machine.input) + totalIn(machine.output);
      this.els.takeAll.disabled = stored === 0;
      this.els.takeAll.textContent = stored === 0 ? 'Empty' : `Take all (${stored})`;
    }

    const used = player.inventory.filter((s) => s !== null).length;
    this.els.bagNote.textContent = `${used} / ${INVENTORY_SLOTS} slots`;
    this.paintCarried(player);
  }

  private paintGrid(area: SlotArea, slots: Slot[]): void {
    const grid = this.grids.find((g) => g.area === area)!;
    for (let i = 0; i < grid.cells.length; i++) paintSlot(grid.cells[i], slots[i] ?? null);
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
    for (const tech of TECHS) {
      const level = techLevel(world, tech.id);
      const open = isAvailable(world, tech);
      const done = isFinished(world, tech);
      const current = world.research.current === tech.id;

      const button = document.createElement('button');
      button.className = `offer${current ? ' on' : ''}`;
      button.disabled = !open || done;

      const cost = tech.inputs
        .map(
          (i) =>
            `<span class="stack" title="${ITEMS[i.id].name}"><i class="ic" style="background-image:${itemIconVar(i.id)}"></i>${i.count}</span>`,
        )
        .join('');
      const state = done
        ? 'Done'
        : !open
          ? `Needs ${tech.requires.map((id) => TECH_BY_ID.get(id)?.name ?? id).join(', ')}`
          : `${cyclesDone(world, tech.id)} / ${cyclesNeeded(world, tech)} cycles`;
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
        this.callbacks.onSetResearch(tech.id);
      });
      this.els.recipes.appendChild(button);
    }
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
    for (const item of ITEM_ORDER) chip(item);
  }

  private onPointerDown(event: PointerEvent): void {
    const ref = refAt(event.target);
    this.moveCarried(event.clientX, event.clientY);
    if (!ref) {
      this.pressRef = null;
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
  return `${current}:${levels}:${current ? cyclesDone(world, current) : 0}`;
}

function refAt(target: EventTarget | null): SlotRef | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('.islot');
  if (!cell || cell.dataset.index === undefined) return null;
  return { area: cell.dataset.area as SlotArea, index: Number(cell.dataset.index) };
}

function paintSlot(cell: HTMLElement, slot: Slot): void {
  if (!slot) {
    cell.className = cell.className.replace(/ filled\b/, '');
    cell.innerHTML = '';
    cell.removeAttribute('title');
    return;
  }

  const def = ITEMS[slot.id];
  if (!cell.className.includes(' filled')) cell.className += ' filled';
  cell.title = `${def.name} — ${slot.count}`;
  cell.innerHTML =
    `<i class="item" style="background-image:${itemIconVar(slot.id)}"></i>` +
    `<b>${slot.count}</b>`;
}

function paintSide(cell: HTMLElement, item: ItemId | null): void {
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
