import { describe, expect, it } from 'vitest';
import { itemPitch } from '../audio/pitch';

describe('production sound pitch', () => {
  it('gives every output of the same kind of machine its own note', () => {
    const smelted = (['ironPlate', 'copperPlate', 'steelPlate'] as const).map(itemPitch);
    expect(new Set(smelted).size).toBe(3);
    const mined = (['ironOre', 'copperOre', 'coal'] as const).map(itemPitch);
    expect(new Set(mined).size).toBe(3);
  });

  it('is the same note every time for one item, so a bank of them is a unison', () => {
    expect(itemPitch('ironPlate')).toBe(itemPitch('ironPlate'));
  });

  it('stays within about an octave either side so no sound goes shrill or inaudible', () => {
    for (const item of ['wood', 'ironPlate', 'gear', 'processor', 'engineeringPack'] as const) {
      const pitch = itemPitch(item);
      expect(pitch).toBeGreaterThan(0.7);
      expect(pitch).toBeLessThanOrEqual(2);
    }
  });
});
