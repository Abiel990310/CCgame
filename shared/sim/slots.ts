import { ITEMS } from '../data/items';
import type { ItemId, ItemStack, Slot } from './types';

/**
 * Fixed-length slot arrays. A bag and a chest are grids the player arranges by
 * hand, so a slot has to keep its position when it empties — a compacted list
 * would slide every stack left the moment one ran out, which is exactly the
 * thing that makes a container feel like a text readout rather than a grid.
 */
export function makeSlots(size: number): Slot[] {
  return new Array<Slot>(size).fill(null);
}

/** The ceiling for one slot: the item's own stack size, capped by the container's. */
export function slotCap(id: ItemId, max = Infinity): number {
  return Math.min(ITEMS[id].stack, max);
}

export function countIn(slots: Slot[], id: ItemId): number {
  let total = 0;
  for (const slot of slots) if (slot && slot.id === id) total += slot.count;
  return total;
}

export function totalIn(slots: Slot[]): number {
  let total = 0;
  for (const slot of slots) if (slot) total += slot.count;
  return total;
}

/**
 * Per-slot filters on a storage grid: a slot set to an item takes only that
 * item, and a null or missing entry takes anything. A filtered slot is kept
 * for its item even while it stands empty, which is the point of setting one.
 */
export type SlotFilters = readonly (ItemId | null)[];

/** Whether slot `index` may take this item under the grid's filters. */
export function slotTakes(filters: SlotFilters | undefined, index: number, id: ItemId): boolean {
  const filter = filters?.[index] ?? null;
  return filter === null || filter === id;
}

/** How many more of one item would fit, across partial stacks and empty slots. */
export function roomFor(slots: Slot[], id: ItemId, max = Infinity, filters?: SlotFilters): number {
  const cap = slotCap(id, max);
  let room = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slotTakes(filters, i, id)) continue;
    if (slot === null) room += cap;
    else if (slot.id === id) room += Math.max(0, cap - slot.count);
  }
  return room;
}

/** Returns how many were actually stored — a container can be full. */
export function addToSlots(
  slots: Slot[],
  id: ItemId,
  count: number,
  max = Infinity,
  filters?: SlotFilters,
): number {
  const cap = slotCap(id, max);
  let remaining = count;

  // Top up partial stacks before opening a new slot, so a grid stays tidy. A
  // stack left in a slot filtered to something else is not topped up: it is
  // there to be taken out, not grown.
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const slot = slots[i];
    if (!slot || slot.id !== id || slot.count >= cap || !slotTakes(filters, i, id)) continue;
    const moved = Math.min(cap - slot.count, remaining);
    slot.count += moved;
    remaining -= moved;
  }

  // Slots kept for this item open first, so the free slots are left for items
  // that have nowhere else to go.
  for (const reserved of [true, false]) {
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      if (slots[i] !== null || !slotTakes(filters, i, id)) continue;
      if (((filters?.[i] ?? null) !== null) !== reserved) continue;
      const moved = Math.min(cap, remaining);
      slots[i] = { id, count: moved };
      remaining -= moved;
    }
  }

  return count - remaining;
}

/** Returns how many were actually taken, emptying the last stacks first. */
export function takeFromSlots(slots: Slot[], id: ItemId, count: number): number {
  let remaining = count;
  for (let i = slots.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = slots[i];
    if (!slot || slot.id !== id) continue;
    const taken = Math.min(slot.count, remaining);
    slot.count -= taken;
    remaining -= taken;
    if (slot.count <= 0) slots[i] = null;
  }
  return count - remaining;
}

/** A compacted, one-entry-per-item view, for readouts and assertions. */
export function stacksIn(slots: Slot[]): ItemStack[] {
  const totals = new Map<ItemId, number>();
  for (const slot of slots) {
    if (slot) totals.set(slot.id, (totals.get(slot.id) ?? 0) + slot.count);
  }
  return [...totals].map(([id, count]) => ({ id, count }));
}

/**
 * Read a slot array out of a save. Accepts both the compacted lists saves
 * before version 3 stored and the sparse grids written since, so an old island
 * opens with its chests intact rather than empty.
 */
export function normalizeSlots(raw: unknown, size: number, max = Infinity): Slot[] {
  const slots = makeSlots(size);
  if (!Array.isArray(raw)) return slots;

  // A grid that shrank cannot honour the old positions, so it is packed from
  // the front instead; that is the only way nothing gets dropped.
  const keepPositions = raw.length <= size;
  const spare: ItemStack[] = [];

  for (let i = 0; i < raw.length; i++) {
    const stack = asStack(raw[i]);
    if (!stack) continue;
    const fits = keepPositions && slots[i] === null && stack.count <= slotCap(stack.id, max);
    if (fits) slots[i] = stack;
    else spare.push(stack);
  }
  // Anything that no longer fits where it sat is merged back in, never dropped.
  for (const stack of spare) addToSlots(slots, stack.id, stack.count, max);

  return slots;
}

export function asStack(value: unknown): ItemStack | null {
  if (!value || typeof value !== 'object') return null;
  const { id, count } = value as Partial<ItemStack>;
  if (typeof id !== 'string' || !(id in ITEMS)) return null;
  if (typeof count !== 'number' || !(count > 0)) return null;
  return { id: id as ItemId, count: Math.floor(count) };
}

/**
 * Where an item sits in a sorted grid. The declaration order of `ITEMS` is the
 * order the game already introduces them in, so sorting groups raw ore next to
 * ore and plates next to plates without a second table to keep in step.
 */
const ITEM_ORDER = new Map<ItemId, number>(
  (Object.keys(ITEMS) as ItemId[]).map((id, index) => [id, index]),
);

export function itemOrder(id: ItemId): number {
  return ITEM_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Tidy a grid in place: every loose stack of one item merged into full ones,
 * laid out from the first slot in table order. Returns whether anything moved,
 * so a caller can tell a no-op from a sort.
 *
 * Merging can only ever use fewer slots than it started with, so the sorted
 * layout always fits — but it is built beside the grid and copied in at the
 * end, so a grid can never be left half-sorted with items dropped.
 */
export function sortSlots(slots: Slot[], max = Infinity, filters?: SlotFilters): boolean {
  const totals = new Map<ItemId, number>();
  for (const slot of slots) {
    if (slot) totals.set(slot.id, (totals.get(slot.id) ?? 0) + slot.count);
  }

  const sorted = makeSlots(slots.length);

  // A filtered slot keeps its place and is filled with its own item first, so
  // sorting tidies a chest without undoing the shape the player gave it.
  for (let i = 0; i < sorted.length; i++) {
    const filter = filters?.[i] ?? null;
    if (filter === null) continue;
    const left = totals.get(filter) ?? 0;
    if (left <= 0) continue;
    const moved = Math.min(slotCap(filter, max), left);
    sorted[i] = { id: filter, count: moved };
    totals.set(filter, left - moved);
  }

  let next = 0;
  for (const [id, count] of [...totals].sort((a, b) => itemOrder(a[0]) - itemOrder(b[0]))) {
    const cap = slotCap(id, max);
    let remaining = count;
    while (remaining > 0) {
      while (next < sorted.length && (sorted[next] !== null || (filters?.[next] ?? null) !== null)) {
        next++;
      }
      if (next >= sorted.length) return false;
      const moved = Math.min(cap, remaining);
      sorted[next++] = { id, count: moved };
      remaining -= moved;
    }
  }

  let changed = false;
  for (let i = 0; i < slots.length; i++) {
    const was = slots[i];
    const now = sorted[i];
    if (was?.id !== now?.id || was?.count !== now?.count) changed = true;
    slots[i] = now;
  }
  return changed;
}
