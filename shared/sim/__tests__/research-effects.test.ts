import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { researchBonuses } from '../research';
import { step } from '../step';
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
    // Carry is rows added, not a multiplier, so it starts from none.
    const { carry, ...multipliers } = researchBonuses(b.world);
    expect(carry).toBe(0);
    for (const value of Object.values(multipliers)) expect(value).toBe(1);
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

  it('raises max health on top of level-ups, and heals what it adds', () => {
    const b = bench();
    const { player, world } = b;
    player.stats.maxHp += 20;
    player.maxHp += 20;
    player.hp = 50;
    world.research.levels.fieldMedicine = 1;
    world.research.levels.vitality = 2;
    // 120 from level-ups, and 1 + 0.2 + 0.1 * 2 = 1.4 on top.
    advance(world, 0.1);
    expect(researchBonuses(world).health).toBeCloseTo(1.4, 9);
    expect(player.maxHp).toBe(168);
    expect(player.hp).toBeCloseTo(50 + 48, 0);
  });

  it('trims health that is above a cap research no longer gives', () => {
    const b = bench();
    b.world.research.levels.fieldMedicine = 1;
    advance(b.world, 0.1);
    expect(b.player.maxHp).toBe(120);
    b.player.hp = 120;

    b.world.research.levels.fieldMedicine = 0;
    advance(b.world, 0.1);
    expect(b.player.maxHp).toBe(100);
    expect(b.player.hp).toBeLessThanOrEqual(100);
  });

  it('walks faster with Conditioning and Endurance', () => {
    const run = (levels: Record<string, number>): number => {
      const b = bench();
      Object.assign(b.world.research.levels, levels);
      const start = b.player.pos.x;
      const inputs = new Map([[b.player.id, { move: { x: 1, y: 0 }, dash: false, interact: false }]]);
      for (let i = 0; i < 30; i++) step(b.world, inputs, 1 / 30);
      return b.player.pos.x - start;
    };
    const base = run({});
    expect(base).toBeGreaterThan(0);
    expect(run({ conditioning: 1 })).toBeGreaterThan(base * 1.05);
    expect(run({ conditioning: 1, endurance: 2 })).toBeGreaterThan(run({ conditioning: 1 }));
  });
});
