import { ITEMS } from '@shared/data/items';
import type { ItemId } from '@shared/sim/types';

/**
 * Semitones above a production sound's own pitch. A major pentatonic, so any
 * handful of items sounding together is a chord and never a clash: a bank of
 * furnaces smelting three different plates is three notes that agree with
 * each other, and one that goes quiet leaves a hole in the chord.
 */
const SCALE = [-5, -3, 0, 2, 4, 7, 9, 12] as const;

/**
 * The pitch multiplier an item's production sound is played at. It follows the
 * item's row in the table, and the table groups an item with its neighbours
 * (ores, then plates, then parts), so the outputs of one kind of machine land
 * on different notes. A hash would be stable under inserts but gives
 * copper plate and steel plate the same note about as often as not.
 */
export function itemPitch(item: ItemId): number {
  const row = ORDER.indexOf(item);
  return 2 ** (SCALE[(row < 0 ? 0 : row) % SCALE.length]! / 12);
}

const ORDER = Object.keys(ITEMS) as ItemId[];
