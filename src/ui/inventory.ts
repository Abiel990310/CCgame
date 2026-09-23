import { ITEMS } from '@shared/data/items';
import { MACHINES } from '@shared/data/machines';
import { RECIPE_BY_ID, craftTime, recipesFor } from '@shared/data/recipes';
import { INVENTORY_SLOTS } from '@shared/sim/inventory';
import { totalIn } from '@shared/sim/slots';
import type { ClickButton, SlotArea, SlotRef } from '@shared/sim/containers';
import type { Machine, Player, Slot } from '@shared/sim/types';
import { itemIconVar } from '../render/items';

export interface InventoryCallbacks {
  /** A slot was clicked: pick up, put down, split, or send across. */
  onSlotAction: (ref: SlotRef, button: ClickButton, quick: boolean) => void;
  onTakeAll: () => void;
  /** Tidy one grid: loose stacks merged, laid out in table order. */
  onSort: (area: SlotArea) => void;
  /** Double-click: pull every loose stack of this item into this slot. */
  onGather: (ref: SlotRef) => void;
  onSetRecipe: (machineId: number, recipeId: string) => void;
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
    title: HTMLElement;
    blurb: HTMLElement;
    container: HTMLElement;
    inputLabel: HTMLElement;
    inputGrid: HTMLElement;
    outputBlock: HTMLElement;
    outputGrid: HTMLElement;
    progress: HTMLElement;
    progressFill: HTMLElement;
    takeAll: HTMLButtonElement;
    sortInput: HTMLButtonElement;
    sortBag: HTMLButtonElement;
    recipes: HTMLElement;
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
      title: must('inv-title'),
      blurb: must('inv-blurb'),
      container: must('inv-container'),
      inputLabel: must('inv-input-label'),
      inputGrid: must('inv-input-grid'),
      outputBlock: must('inv-output'),
      outputGrid: must('inv-output-grid'),
      progress: must('inv-progress'),
      progressFill: must('inv-progress-fill'),
      takeAll: must<HTMLButtonElement>('inv-take-all'),
      sortInput: must<HTMLButtonElement>('inv-sort-input'),
      sortBag: must<HTMLButtonElement>('inv-sort-bag'),
      recipes: must('inv-recipes'),
      bagGrid: must('inv-bag-grid'),
      bagNote: must('inv-bag-note'),
      close: must<HTMLButtonElement>('inv-close'),
      carried: must('inv-carried'),
    };

    this.grids = [
      { area: 'input', el: this.els.inputGrid, cells: [] },
      { area: 'output', el: this.els.outputGrid, cells: [] },
      { area: 'bag', el: this.els.bagGrid, cells: [] },
    ];
    this.buildGrid('bag', INVENTORY_SLOTS);

    this.els.close.addEventListener('click', () => this.callbacks.onClose());
    this.els.takeAll.addEventListener('click', () => this.callbacks.onTakeAll());
    this.els.sortInput.addEventListener('click', () => this.callbacks.onSort('input'));
    this.els.sortBag.addEventListener('click', () => this.callbacks.onSort('bag'));
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
      this.els.blurb.classList.add('hidden');
      this.els.container.classList.add('hidden');
      this.els.recipes.innerHTML = '';
      return;
    }

    const def = MACHINES[machine.type];
    this.els.eyebrow.textContent = def.choosesRecipe ? 'Machine' : 'Storage';
    this.els.title.textContent = def.name;
    this.els.blurb.textContent = def.description;
    this.els.blurb.classList.remove('hidden');
    this.els.container.classList.remove('hidden');

    // A chest's grid is its whole point, so it is not labelled "In".
    this.els.inputLabel.textContent = def.choosesRecipe ? 'In' : 'Stored';
    this.els.inputGrid.parentElement?.classList.toggle('hidden', def.inputSlots === 0);
    this.els.outputBlock.classList.toggle('hidden', def.outputSlots === 0);
    this.els.progress.classList.toggle('hidden', !def.choosesRecipe);

    this.els.sortInput.classList.toggle('hidden', def.inputSlots < 2);

    this.buildGrid('input', def.inputSlots);
    this.buildGrid('output', def.outputSlots);
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

  update(player: Player, machine: Machine | null): void {
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
    this.updateRecipes(machine);
  }

  private signature(player: Player, machine: Machine | null): string {
    const slots = (list: Slot[]): string =>
      list.map((s) => (s ? `${s.id}x${s.count}` : '-')).join(',');
    const cursor = player.cursor ? `${player.cursor.id}x${player.cursor.count}` : '-';
    const held = machine ? `${slots(machine.input)}|${slots(machine.output)}` : '';
    return `${slots(player.inventory)}|${held}|${cursor}`;
  }

  private paint(player: Player, machine: Machine | null): void {
    this.paintGrid('bag', player.inventory);
    if (machine) {
      this.paintGrid('input', machine.input);
      this.paintGrid('output', machine.output);
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
    if (!def.choosesRecipe) return;

    const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
    const duration = recipe ? craftTime(recipe, def.speed) : 0;
    const fraction = duration > 0 ? Math.min(1, machine.progress / duration) : 0;
    this.els.progressFill.style.width = `${fraction * 100}%`;
    this.els.progress.classList.toggle('stalled', machine.stalled);
  }

  private updateRecipes(machine: Machine | null): void {
    const def = machine ? MACHINES[machine.type] : null;
    const key = machine && def?.choosesRecipe ? `${machine.id}:${machine.recipe}` : '';
    if (key === this.recipeKey) return;
    this.recipeKey = key;

    this.els.recipes.innerHTML = '';
    if (!machine || !def?.choosesRecipe) return;

    for (const recipe of recipesFor(machine.type)) {
      const button = document.createElement('button');
      button.className = `offer${machine.recipe === recipe.id ? ' on' : ''}`;
      const inputs = recipe.inputs.map((i) => `${i.count} ${ITEMS[i.id].name}`).join(' + ');
      const outputs = recipe.outputs.map((o) => `${o.count} ${ITEMS[o.id].name}`).join(' + ');
      button.innerHTML = `<b>${recipe.name}</b><span>${inputs} → ${outputs}<br>${recipe.time}s</span>`;
      button.addEventListener('click', () => this.callbacks.onSetRecipe(machine.id, recipe.id));
      this.els.recipes.appendChild(button);
    }
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
    this.callbacks.onSlotAction(to, event.button === 2 ? 'right' : 'left', event.shiftKey);
  }
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

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
}
