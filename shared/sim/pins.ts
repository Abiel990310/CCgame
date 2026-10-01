import { MAP_SIZE } from './constants';
import type { World } from './types';

/** Pins an island can hold; a map with more than this stops being a map. */
export const MAX_PINS = 24;
/** How many marker colours the map offers. */
export const PIN_HUES = 6;
/** A second pin closer than this to one already there is the same spot marked twice. */
const PIN_MERGE = 12;

/** Drop a pin at a point of the island. False when the point is off the island, the map is full or it is already marked. */
export function placePin(world: World, x: number, y: number, hue: number): boolean {
  if (!(x >= 0 && y >= 0 && x <= MAP_SIZE && y <= MAP_SIZE)) return false;
  if (!Number.isInteger(hue) || hue < 0 || hue >= PIN_HUES) return false;
  if (world.pins.length >= MAX_PINS) return false;
  // Whole numbers, so a pin costs a few bytes in the save however it was aimed.
  const px = Math.round(x);
  const py = Math.round(y);
  if (world.pins.some((p) => Math.hypot(p.x - px, p.y - py) < PIN_MERGE)) return false;
  world.pins.push({ id: world.nextId++, x: px, y: py, hue });
  return true;
}

export function removePin(world: World, id: number): boolean {
  const i = world.pins.findIndex((p) => p.id === id);
  if (i < 0) return false;
  world.pins.splice(i, 1);
  return true;
}

/** Pins read back from a save: anything malformed or off the island is dropped, and the count is capped. */
export function sanitizePins(raw: unknown, nextId: number): World['pins'] {
  if (!Array.isArray(raw)) return [];
  const out: World['pins'] = [];
  for (const p of raw) {
    if (out.length >= MAX_PINS) break;
    if (typeof p !== 'object' || p === null) continue;
    const { id, x, y, hue } = p as Record<string, unknown>;
    if (typeof id !== 'number' || !Number.isInteger(id) || id >= nextId) continue;
    if (typeof x !== 'number' || typeof y !== 'number' || !(x >= 0 && y >= 0 && x <= MAP_SIZE && y <= MAP_SIZE)) continue;
    out.push({ id, x, y, hue: typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue < PIN_HUES ? hue : 0 });
  }
  return out;
}
