import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { researchBonuses } from '../research';
import { countIn } from '../slots';
import type { Machine } from '../types';
import { advance, at, bench, fill, put } from './bench';

/**
 * The techs whose reward is a multiplier on something other than a machine.
 * Each is read where the thing it multiplies happens, so each is checked there.
 */
describe('research effects', () => {
  it('starts every multiplier at one', () => {
    const b = bench();
    for (const value of Object.values(researchBonuses(b.world))) expect(value).toBe(1);
  });

  it('sums a repeatable tech on top of the one-shot one beneath it', () => {
    const b = bench();
    b.world.research.levels.weaponsmithing = 1;
    b.world.research.levels.ballistics = 3;
    expect(researchBonuses(b.world).damage).toBeCloseTo(1.5, 9);
  });

  it('gets more plates out of each coal with Firebox Design', () => {
    const plates = (firebox: boolean): number => {
      const b = bench();
      if (firebox) b.world.research.levels.fireboxDesign = 1;
      const spot = at(0, 2);
      const furnace = put(b, ['furnaceMk2', 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
      fill(furnace.input, 'ironOre', 100, MACHINES.furnaceMk2.slotSize);
      fill(furnace.fuel!, 'coal', 2);
      advance(b.world, 40);
      return countIn(furnace.output, 'ironPlate');
    };
    // Two coal is eight plates, and a quarter more is ten.
    expect(plates(false)).toBeLessThanOrEqual(8);
    expect(plates(true)).toBeGreaterThanOrEqual(9);
  });
});
