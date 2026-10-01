import { describe, expect, it } from 'vitest';
import { TECHS, techTier } from '../../data/techs';
import { WAVES } from '../constants';
import { researchTier } from '../research';
import { nightBudget } from '../systems/mobs';
import { addPlayer, createWorld } from '../world';

function island() {
  const world = createWorld(53);
  addPlayer(world, 'test');
  world.nightIndex = 10;
  return world;
}

describe('the raid budget and research', () => {
  it('is unchanged on an island that has researched nothing', () => {
    const world = island();
    const n = world.nightIndex;
    expect(researchTier(world)).toBe(0);
    expect(nightBudget(world)).toBe(Math.round(WAVES.baseBudget + WAVES.budgetPerNight * n + WAVES.budgetPerNightSq * n * n));
  });

  it('reads the highest pack tier of any finished tech', () => {
    const world = island();
    world.research.levels.automation = 1;
    expect(researchTier(world)).toBe(1);
    world.research.levels.weaponsmithing = 1;
    expect(researchTier(world)).toBe(2);
    world.research.levels.resonance = 1;
    expect(researchTier(world)).toBe(4);
  });

  it('grows the night with each tier, and a tier is only ever added to what nights earn', () => {
    const world = island();
    const none = nightBudget(world);
    let last = none;
    for (const id of ['automation', 'weaponsmithing', 'deepDrilling', 'resonance']) {
      world.research.levels[id] = 1;
      const budget = nightBudget(world);
      expect(budget).toBeGreaterThanOrEqual(last);
      last = budget;
    }
    expect(last).toBeGreaterThan(none);
    expect(last).toBeLessThanOrEqual(Math.round(none * (1 + WAVES.budgetPerResearchTier * 4)) + 1);
  });

  it('never counts anything built, only techs finished', () => {
    const tiers = TECHS.map(techTier);
    expect(Math.min(...tiers)).toBeGreaterThan(0);
  });
});
