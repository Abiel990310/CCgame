import { MACHINES, isFuel } from '../data/machines';
import { RECIPE_BY_ID } from '../data/recipes';
import { isResearchPack } from '../data/techs';
import { hasSlotFilters, isSplitter, setSideFilter, setSlotFilter, splitterAccepts } from './factory';
import { BEACON_FUEL_CAP } from '../data/beacon';
import { beaconLit, beaconStage, beaconWants } from './beacon';
import { TURRET_AMMO } from './systems/turret';
import { giveOrDrop } from './inventory';
import { handLoadRoom } from './systems/factory';
import { addToSlots, slotCap, slotTakes, sortSlots, takeFromSlots } from './slots';
import type { SlotFilters } from './slots';
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
 * point it at that item, click it empty-handed to open it up again. A chest's
 * slots take the same gesture with `filter` naming the slot by its index.
 */
export type SlotArea = 'bag' | 'input' | 'output' | 'filter' | 'fuel';

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
  if (area === 'fuel') return machine.fuel ?? null;
  return area === 'input' ? machine.input : machine.output;
}

/** The per-slot ceiling in one area. Machines hold less per slot than a bag. */
function capIn(machine: Machine | null, area: SlotArea, id: ItemId): number {
  if (area === 'bag' || !machine) return slotCap(id);
  // A beacon slot holds a stage's worth and no more, so a stack handed in
  // whole leaves the rest in hand rather than clogging the next stage.
  if (area === 'input' && MACHINES[machine.type].family === 'beacon') {
    if (beaconLit(machine)) return id === 'processor' ? BEACON_FUEL_CAP : 0;
    return beaconStage(machine)?.stage.needs.find((n) => n.id === id)?.count ?? 0;
  }
  return slotCap(id, MACHINES[machine.type].slotSize);
}

/** The slot filters a hand has to respect in one area, if it has any. */
function filtersIn(machine: Machine | null, area: SlotArea): SlotFilters | undefined {
  if (!machine || area !== 'input' || !hasSlotFilters(machine)) return undefined;
  return machine.filters;
}

/**
 * Whether the player may put this item into that area by hand. With `index`,
 * whether it may go into that one slot, which a chest's filters can refuse.
 */
export function accepts(
  machine: Machine | null,
  area: SlotArea,
  id: ItemId,
  index?: number,
): boolean {
  if (index !== undefined && !slotTakes(filtersIn(machine, area), index, id)) return false;
  if (area === 'bag') return true;
  if (!machine) return false;
  // The output side is what the machine made; taking from it is fine, filling it is not.
  if (area === 'output') return false;
  if (area === 'filter') return isSplitter(machine) || hasSlotFilters(machine);
  if (area === 'fuel') return !!machine.fuel && isFuel(id);

  const def = MACHINES[machine.type];
  if (def.inputSlots === 0) return false;
  // A lab is loaded by hand on the same terms a belt loads it: packs only.
  if (def.family === 'lab') return isResearchPack(id);
  if (def.family === 'beacon') return beaconWants(machine, id) > 0;
  // A turret is loaded with the rounds it fires, and nothing else.
  if (def.family === 'turret') return id === TURRET_AMMO;
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
    if (machineId === null || !machine) return false;
    if (isSplitter(machine)) {
      return setSideFilter(world, machineId, ref.index, player.cursor?.id ?? null);
    }
    if (hasSlotFilters(machine)) {
      return setSlotFilter(world, machineId, ref.index, slotFilterFor(machine, ref.index, player));
    }
    return false;
  }

  const slots = slotsFor(player, machine, ref.area);
  if (!slots || ref.index < 0 || ref.index >= slots.length) return false;

  const slot = slots[ref.index];
  const cursor = player.cursor;

  if (!cursor) return pickUp(player, slots, ref.index, button);
  if (slot && slot.id === cursor.id) return stackTogether(player, machine, slots, ref, button);
  if (!accepts(machine, ref.area, cursor.id, ref.index)) return false;

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

/**
 * What a filter click on a chest slot sets it to. A held item names the item,
 * as it does on a splitter's side. Empty-handed, the click keeps the slot for
 * whatever it already holds, and a second click opens it up again, so a chest
 * already laid out by hand is filtered one click per slot.
 */
function slotFilterFor(machine: Machine, index: number, player: Player): ItemId | null {
  if (player.cursor) return player.cursor.id;
  const current = machine.filters?.[index] ?? null;
  const held = machine.input[index]?.id ?? null;
  if (held !== null && held !== current) return held;
  return null;
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

  if (accepts(machine, ref.area, cursor.id, ref.index)) {
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
    if (!machine) return false;
    // Coal shift-clicked into a burner is fuel first; only what the fuel grid
    // cannot hold goes on to the recipe, as it would off a belt.
    const size = MACHINES[machine.type].slotSize;
    let moved = 0;
    for (const area of ['fuel', 'input'] as const) {
      const target = slotsFor(player, machine, area);
      if (!target || !accepts(machine, area, slot.id)) continue;
      const wants = area === 'fuel' ? Infinity
        : MACHINES[machine.type].family === 'beacon' ? beaconWants(machine, slot.id)
        : handLoadRoom(machine, slot.id);
      moved += addToSlots(target, slot.id, Math.min(wants, slot.count - moved), size, filtersIn(machine, area));
    }
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
  for (const slots of [machine.output, machine.input, machine.fuel ?? []]) {
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
  return sortSlots(slots, maxIn(machine, area), filtersIn(machine, area));
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
  // A stack left in a slot now kept for something else is not grown.
  if (!slotTakes(filtersIn(machine, ref.area), ref.index, target.id)) return false;

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
  for (const slots of [machine.output, machine.input, machine.fuel ?? []]) {
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
