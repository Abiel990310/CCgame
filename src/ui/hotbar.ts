import { BUILDINGS } from '@shared/data/buildings';
import { MACHINES } from '@shared/data/machines';
import { entriesFor, selectionKey, type BuildSelection } from './palette';

/**
 * The quick slots along the bottom of the screen. A number key selects what
 * build mode places, which is the difference between building a line and
 * hunting through a palette for every piece of it.
 *
 * The binding is a client preference, not world state: it says how one person
 * likes their bar arranged, so it lives in `localStorage` beside the save index
 * rather than in the island — and a bar shared across islands is what a player
 * arranging it once actually expects.
 */
export const HOTBAR_SLOTS = 8;

export type HotbarBinding = BuildSelection | null;

const STORE_KEY = 'ccgame.hotbar.v1';

/** The first eight pieces in palette order — the bar a new player wants. */
export function defaultHotbar(): HotbarBinding[] {
  const order = [...entriesFor('factory'), ...entriesFor('camp')].map((e) => e.selection);
  const slots: HotbarBinding[] = [];
  for (let i = 0; i < HOTBAR_SLOTS; i++) slots.push(order[i] ?? null);
  return slots;
}

/** A binding is only kept if the piece it names still exists in the tables. */
function valid(binding: unknown): HotbarBinding {
  if (!binding || typeof binding !== 'object') return null;
  const { kind, id } = binding as { kind?: string; id?: string };
  if (kind === 'belt') return { kind: 'belt' };
  if (kind === 'machine' && id && id in MACHINES) return { kind: 'machine', id: id as never };
  if (kind === 'building' && id && id in BUILDINGS) return { kind: 'building', id: id as never };
  return null;
}

export function loadHotbar(): HotbarBinding[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return defaultHotbar();
  }
  if (!raw) return defaultHotbar();

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultHotbar();
    const slots: HotbarBinding[] = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) slots.push(valid(parsed[i]));
    return slots;
  } catch {
    return defaultHotbar();
  }
}

export function saveHotbar(slots: HotbarBinding[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(slots));
  } catch {
    // A blocked storage quota costs the player their bar layout, nothing more.
  }
}

/** Which slot holds this selection, or -1. Drives the highlight on the bar. */
export function slotOf(slots: HotbarBinding[], selection: BuildSelection): number {
  const key = selectionKey(selection);
  return slots.findIndex((b) => b !== null && selectionKey(b) === key);
}
