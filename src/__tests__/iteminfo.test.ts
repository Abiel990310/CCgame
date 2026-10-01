import { describe, expect, it } from 'vitest';
import { ITEMS } from '@shared/data/items';
import type { ItemId } from '@shared/sim/types';
import { itemInfo } from '../ui/iteminfo';

describe('item card text', () => {
  const ids = Object.keys(ITEMS) as ItemId[];

  it('says something about where every item comes from or what it is for', () => {
    // A blank card is a card that looks broken; a new item row with no recipe,
    // node or use should be noticed here rather than in the bag.
    const blank = ids.filter((id) => {
      const info = itemInfo(id);
      return info.from.length === 0 && info.effect.length === 0;
    });
    expect(blank).toEqual([]);
  });

  it('reads what an item does off its data row', () => {
    expect(itemInfo('coal').effect.join(' ')).toMatch(/Fuel/);
    expect(itemInfo('grilledFish').effect.join(' ')).toMatch(new RegExp(`${ITEMS.grilledFish.food}`));
    expect(itemInfo('speedModule').effect.join(' ')).toMatch(/\+50% speed/);
    expect(itemInfo('stonePick').kind).toBe('Tool');
    expect(itemInfo('ironPlate').from).toContain('Furnace');
    expect(itemInfo('ironPlate').uses).toContain('Gear');
  });

  it('caps the uses so a common material does not run off the card', () => {
    for (const id of ids) expect(itemInfo(id).uses.length).toBeLessThanOrEqual(6);
  });
});
