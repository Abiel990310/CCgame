import { MACHINES } from '../data/machines';
import { RECIPE_BY_ID } from '../data/recipes';
import { isSplitter, setSideFilter, splitterAccepts } from './factory';
import { giveOrDrop } from './inventory';
import { addToSlots, slotCap, sortSlots, takeFromSlots } from './slots';
import type { ItemId, Machine, Player, Slot, World } from './types';

/**
 * Moving items by hand, between the player's bag and whatever container is
 * open. The rules live here rather than in the UI so a future server can run
 * the identical checks: a click is an input like any other, and the client is
 * only allowed to ask.
 *
 * The held stack lives on the player (`player.cursor`) rather than in the DOM,
 * so closing the screen, reloading, or a tab that never comes back cannot
 * swallow a stack mid-drag.
 */

/**
 * `filter` is not storage. A splitter's two sides are shown as slots because
 * setting one is the same gesture as moving a stack: drop an item on a side to
 * point it at that item, click it empty-handed to open it up again.
 */
export type SlotArea = 'bag' | 'input' | 'output' | 'filter';

export interface SlotRef {
  area: SlotArea;
  index: number;
}

export type ClickButton = 'left' | 'right';

export function machineById(world: World, id: number | null): Machine | null {
  if (id === null) return null;
  return world.machines.find((m) => m.id === id) ?? null;
}

function slotsFor(player: Player, machine: Machine | null, area: SlotArea): Slot[] | null {
  if (area === 'bag') return player.inventory;
  if (!machine || area === 'filter') return null;
  return area === 'input' ? machine.input : machine.output;
}

/** The per-slot ceiling in one area. Machines hold less per slot than a bag. */
function capIn(machine: Machine | null, area: SlotArea, id: ItemId): number {
  if (area === 'bag' || !machine) return slotCap(id);
  return slotCap(id, MACHINES[machine.type].slotSize);
}

/** Whether the player may put this item into that area by hand. */
export function accepts(machine: Machine | null, area: SlotArea, id: ItemId): boolean {
  if (area === 'bag') return true;
  if (!machine) return false;
  // The output side is what the machine made; taking from it is fine, filling it is not.
  if (area === 'output') return false;
  if (area === 'filter') return isSplitter(machine);

  const def = MACHINES[machine.type];
  if (def.inputSlots === 0) return false;
  // Handing a splitter something neither side would route only jams it.
  if (def.family === 'splitter') return splitterAccepts(machine, id);
  // A chest takes anything; a crafter only takes what its recipe actually uses.
  if (!def.choosesRecipe) return true;

  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  return !!recipe && recipe.inputs.some((i) => i.id === id);
}

/**
 * One click on one slot, in Minecraft's grammar: left picks up or puts down a
 * whole stack, right splits it in half or places a single item, and clicking a
 * slot that holds something else swaps the two.
 */
export function clickSlot(
  world: World,
  player: Player,
  machineId: number | null,
  ref: SlotRef,
  button: ClickButton = 'left',
): boolean {
  const machine = machineById(world, machineId);
  // A side is set from what is in hand and cleared by an empty one, so the
  // click never takes the item: a filter is a label, not a stored stack.
  if (ref.area === 'filter') {
    if (machineId === null || !machine || !isSplitter(machine)) return false;
    return setSideFilter(world, machineId, ref.index, player.cursor?.id ?? null);
  }

  const slots = slotsFor(player, machine, ref.area);
  if (!slots || ref.index < 0 || ref.index >= slots.length) return false;

  const slot = slots[ref.index];
  const cursor = player.cursor;

  if (!cursor) return pickUp(player, slots, ref.index, button);
  if (slot && slot.id === cursor.id) return stackTogether(player, machine, slots, ref, button);
  if (!accepts(machine, ref.area, cursor.id)) return false;

  const cap = capIn(machine, ref.area, cursor.id);

  if (!slot) {
    const moved = Math.min(button === 'right' ? 1 : cursor.count, cap);
    slots[ref.index] = { id: cursor.id, count: moved };
    spend(player, moved);
    return true;
  }

  // Swapping only works when the whole held stack fits in the slot it lands in.
  if (cursor.count > cap) return false;
  slots[ref.index] = cursor;
  player.cursor = slot;
  return true;
}

function pickUp(player: Player, slots: Slot[], index: number, button: ClickButton): boolean {
  const slot = slots[index];
  if (!slot) return false;

  if (button === 'left') {
    player.cursor = slot;
    slots[index] = null;
    return true;
  }

  // Right-click splits, keeping the larger half in hand.
  const taken = Math.ceil(slot.count / 2);
  player.cursor = { id: slot.id, count: taken };
  slot.count -= taken;
  if (slot.count <= 0) slots[index] = null;
  return true;
}

/** Cursor and slot hold the same item: merge one into the other. */
function stackTogether(
  player: Player,
  machine: Machine | null,
  slots: Slot[],
  ref: SlotRef,
  button: ClickButton,
): boolean {
  const cursor = player.cursor!;
  const slot = slots[ref.index]!;

  if (accepts(machine, ref.area, cursor.id)) {
    const room = capIn(machine, ref.area, cursor.id) - slot.count;
    const moved = Math.min(button === 'right' ? 1 : cursor.count, room);
    if (moved <= 0) return false;
    slot.count += moved;
    spend(player, moved);
    return true;
  }

  // Nothing may go into an output slot, but collecting more of what is already
  // in hand is just taking, so it is allowed.
  const room = slotCap(cursor.id) - cursor.count;
  const moved = Math.min(slot.count, room);
  if (moved <= 0) return false;
  cursor.count += moved;
  slot.count -= moved;
  if (slot.count <= 0) slots[ref.index] = null;
  return true;
}

function spend(player: Player, moved: number): void {
  const cursor = player.cursor;
  if (!cursor) return;
  cursor.count -= moved;
  if (cursor.count <= 0) player.cursor = null;
}

/**
 * Shift-click: send a whole stack across to the other grid without picking it
 * up. Emptying a chest is the common case and one click per stack is the
 * difference between usable and not.
 */
export function quickMove(
  world: World,
  player: Player,
  machineId: number | null,
  ref: SlotRef,
): boolean {
  const machine = machineById(world, machineId);
  const slots = slotsFor(player, machine, ref.area);
  if (!slots) return false;

  const slot = slots[ref.index];
  if (!slot) return false;

  if (ref.area === 'bag') {
    if (!machine || !accepts(machine, 'input', slot.id)) return false;
    const moved = addToSlots(machine.input, slot.id, slot.count, MACHINES[machine.type].slotSize);
    if (moved === 0) return false;
    takeOut(slots, ref.index, moved);
    return true;
  }

  const moved = addToSlots(player.inventory, slot.id, slot.count);
  if (moved === 0) return false;
  takeOut(slots, ref.index, moved);
  return true;
}

function takeOut(slots: Slot[], index: number, count: number): void {
  const slot = slots[index];
  if (!slot) return;
  slot.count -= count;
  if (slot.count <= 0) slots[index] = null;
}

/** Empty a container into the bag in one action, as far as the bag has room. */
export function takeAll(world: World, player: Player, machineId: number): number {
  const machine = machineById(world, machineId);
  if (!machine) return 0;

  let moved = 0;
  for (const slots of [machine.output, machine.input]) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const stored = addToSlots(player.inventory, slot.id, slot.count);
      takeOut(slots, i, stored);
      moved += stored;
    }
  }
  return moved;
}

/** The per-slot ceiling the whole of one area obeys. */
function maxIn(machine: Machine | null, area: SlotArea): number {
  if (area === 'bag' || !machine) return Infinity;
  return MACHINES[machine.type].slotSize;
}

/**
 * Tidy one grid: loose stacks merged into full ones, laid out in table order.
 * A chest of eight part-used stacks is the state every storage game arrives at,
 * and doing it by hand is a dozen drags.
 */
export function sortArea(
  world: World,
  player: Player,
  machineId: number | null,
  area: SlotArea,
): boolean {
  const machine = machineById(world, machineId);
  const slots = slotsFor(player, machine, area);
  if (!slots) return false;
  return sortSlots(slots, maxIn(machine, area));
}

/**
 * Gather every loose stack of one item in the same grid into the slot that was
 * clicked, up to its ceiling. The double-click half of sorting: it tidies the
 * one item the player is actually looking at without rearranging the grid
 * around it.
 *
 * Smallest stacks are emptied first, so the loose ends disappear rather than a
 * full stack being broken up to top up another.
 */
export function gatherStacks(
  world: World,
  player: Player,
  machineId: number | null,
  ref: SlotRef,
): boolean {
  // A held stack means the click was part of a drag, not a gather.
  if (player.cursor) return false;

  const machine = machineById(world, machineId);
  const slots = slotsFor(player, machine, ref.area);
  if (!slots) return false;

  const target = slots[ref.index];
  if (!target) return false;

  let room = capIn(machine, ref.area, target.id) - target.count;
  if (room <= 0) return false;

  const loose = slots
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => entry.index !== ref.index && entry.slot?.id === target.id)
    .sort((a, b) => a.slot!.count - b.slot!.count);

  let gathered = 0;
  for (const { index } of loose) {
    if (room <= 0) break;
    const slot = slots[index]!;
    const moved = Math.min(slot.count, room);
    slot.count -= moved;
    room -= moved;
    gathered += moved;
    if (slot.count <= 0) slots[index] = null;
  }

  if (gathered === 0) return false;
  target.count += gathered;
  return true;
}

/**
 * Put the held stack away. Called whenever the screen closes, so a stack on the
 * cursor can never be stranded — it goes back to the bag, or falls at the
 * player's feet when the bag is full.
 */
export function stowCursor(world: World, player: Player): void {
  const held = player.cursor;
  if (!held) return;
  player.cursor = null;
  giveOrDrop(world, player, held.id, held.count);
}

/** Take a whole item type out of a container. Used by tests and tooling. */
export function withdraw(
  world: World,
  player: Player,
  machineId: number,
  id: ItemId,
  count: number,
): number {
  const machine = machineById(world, machineId);
  if (!machine) return 0;

  let left = count;
  for (const slots of [machine.output, machine.input]) {
    if (left <= 0) break;
    const available = Math.min(left, sumOf(slots, id));
    if (available <= 0) continue;
    const stored = addToSlots(player.inventory, id, available);
    takeFromSlots(slots, id, stored);
    left -= stored;
  }
  return count - left;
}

function sumOf(slots: Slot[], id: ItemId): number {
  let total = 0;
  for (const slot of slots) if (slot && slot.id === id) total += slot.count;
  return total;
}
