/**
 * The save registry: every island you have started is a slot, and a slot is
 * what the main menu calls a game. The world data itself lives in its own
 * localStorage entries per slot (written by `save.ts`); this module only owns
 * the list of slots and the summary the menu needs to draw a card without
 * parsing a whole island.
 */

const INDEX_KEY = 'ccgame.saves.v1';
const SLOT_PREFIX = 'ccgame.slot.';
/** The single-slot key every save lived in before slots existed. */
const LEGACY_KEY = 'ccgame.save.v1';

export interface SaveSlot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Summary shown on the menu card, refreshed on every save. */
  night: number;
  level: number;
  playSeconds: number;
}

interface SaveIndex {
  version: 1;
  lastPlayed: string | null;
  slots: SaveSlot[];
}

const EMPTY: SaveIndex = { version: 1, lastPlayed: null, slots: [] };

/**
 * A slot's world data is split across several entries, grouped by how often
 * each part changes, so a save only rewrites what moved. `save.ts` owns what
 * goes in each; the registry only has to know they exist, so that deleting a
 * game takes all of them with it.
 */
export const SCENERY_SUFFIX = '.w';
export const FACTORY_SUFFIX = '.f';
/** Every entry one slot occupies, the header's own key first. */
export const SLOT_SUFFIXES = ['', SCENERY_SUFFIX, FACTORY_SUFFIX] as const;

/** Where one slot's world data lives. */
export function slotKey(id: string): string {
  return SLOT_PREFIX + id;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // A full or blocked storage quota must never take the game down.
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do — a failed clear just leaves the old entry in place.
  }
}

function readIndex(): SaveIndex {
  const index = read<SaveIndex>(INDEX_KEY);
  if (index && index.version === 1 && Array.isArray(index.slots)) return index;
  return adoptLegacySave();
}

function writeIndex(index: SaveIndex): boolean {
  return write(INDEX_KEY, index);
}

/**
 * Anyone who played before slots existed has one island under the old key.
 * It becomes their first slot, data untouched, so they open the new menu and
 * find their island waiting rather than an empty list.
 */
function adoptLegacySave(): SaveIndex {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return { ...EMPTY, slots: [] };
  }
  if (legacy === null) {
    writeIndex(EMPTY);
    return { ...EMPTY, slots: [] };
  }

  const slot: SaveSlot = {
    id: newId(),
    name: 'The Island',
    createdAt: Date.now(),
    updatedAt: legacySavedAt(legacy),
    night: legacyNumber(legacy, 'nightIndex'),
    level: 1,
    playSeconds: 0,
  };

  const index: SaveIndex = { version: 1, lastPlayed: slot.id, slots: [slot] };
  // Copy first and only then drop the old key, so a failed write (a full
  // quota, say) leaves the original save exactly where it was.
  try {
    localStorage.setItem(slotKey(slot.id), legacy);
  } catch {
    return { ...EMPTY, slots: [] };
  }
  if (!writeIndex(index)) {
    remove(slotKey(slot.id));
    return { ...EMPTY, slots: [] };
  }
  remove(LEGACY_KEY);
  return index;
}

function legacySavedAt(raw: string): number {
  return legacyNumber(raw, 'savedAt') || Date.now();
}

function legacyNumber(raw: string, field: string): number {
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  }
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}

/** Newest first, which is the order the menu lists them in. */
export function listSaves(): SaveSlot[] {
  return [...readIndex().slots].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function lastPlayed(): SaveSlot | null {
  const index = readIndex();
  return index.slots.find((s) => s.id === index.lastPlayed) ?? null;
}

const ISLAND_NAMES = [
  'Driftwood Cove',
  'Lantern Bay',
  'Saltpine',
  'Emberholt',
  'Quiet Shoal',
  'Gullrock',
  'Fernmouth',
  'Old Harbour',
  'Tidewatch',
  'Copper Sands',
];

/** A fresh name that is not already on the list, so cards stay tellable apart. */
export function suggestName(existing: SaveSlot[] = listSaves()): string {
  const taken = new Set(existing.map((s) => s.name));
  const free = ISLAND_NAMES.filter((name) => !taken.has(name));
  const pool = free.length > 0 ? free : ISLAND_NAMES;
  const base = pool[Math.floor(Math.random() * pool.length)];
  if (!taken.has(base)) return base;

  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name)) return name;
  }
}

export function createSlot(name: string): SaveSlot {
  const index = readIndex();
  const slot: SaveSlot = {
    id: newId(),
    name: name.trim() || suggestName(index.slots),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    night: 0,
    level: 1,
    playSeconds: 0,
  };
  index.slots.push(slot);
  index.lastPlayed = slot.id;
  writeIndex(index);
  return slot;
}

/** Refresh a slot's summary after a save, and mark it as the one to continue. */
export function touchSlot(
  id: string,
  summary: Pick<SaveSlot, 'night' | 'level' | 'playSeconds'>,
): void {
  const index = readIndex();
  const slot = index.slots.find((s) => s.id === id);
  if (!slot) return;
  slot.night = summary.night;
  slot.level = summary.level;
  slot.playSeconds = summary.playSeconds;
  slot.updatedAt = Date.now();
  index.lastPlayed = id;
  writeIndex(index);
}

export function renameSlot(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const index = readIndex();
  const slot = index.slots.find((s) => s.id === id);
  if (!slot) return;
  slot.name = trimmed.slice(0, 40);
  writeIndex(index);
}

export function deleteSlot(id: string): void {
  const index = readIndex();
  index.slots = index.slots.filter((s) => s.id !== id);
  if (index.lastPlayed === id) index.lastPlayed = index.slots[0]?.id ?? null;
  writeIndex(index);
  for (const suffix of SLOT_SUFFIXES) remove(slotKey(id) + suffix);
}

/** "just now", "12m ago", "3d ago" — the menu's only time display. */
export function describeAge(at: number): string {
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function describePlaytime(seconds: number): string {
  if (seconds < 60) return 'just started';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m played`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m played`;
}
