import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { RECIPE_BY_ID } from '../../data/recipes';
import { PACK_TIER, RESEARCH_PACKS, TECH_BY_ID, TECHS } from '../../data/techs';
import { setResearch } from '../research';
import { createWorld } from '../world';

/** Every tech that eats the frontier pack, and so lives on the far side's branch. */
const BRANCH = TECHS.filter((t) => t.inputs.some((i) => i.id === 'frontierPack'));

describe('the titanium branch', () => {
  it('has techs, and every one of them leads back to the crossing', () => {
    expect(BRANCH.length).toBeGreaterThanOrEqual(4);
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (id === 'causeways') return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return TECH_BY_ID.get(id)!.requires.some((r) => reaches(r, seen));
    };
    for (const tech of BRANCH) expect(reaches(tech.id), `${tech.id} is not behind the causeways`).toBe(true);
  });

  it('ends in a repeatable, so the branch never runs out', () => {
    expect(BRANCH.some((t) => t.repeatable)).toBe(true);
  });

  it('makes its pack out of titanium plate, which only the far side gives', () => {
    const recipe = RECIPE_BY_ID.get('frontierPack')!;
    expect(recipe.inputs.map((i) => i.id)).toContain('titaniumPlate');
    expect(PACK_TIER.frontierPack).toBeDefined();
  });

  it('is researchable in a lab, which has a slot for every kind of pack', () => {
    expect(MACHINES.lab.inputSlots).toBeGreaterThanOrEqual(RESEARCH_PACKS.length);
    const world = createWorld(31, true);
    world.research.unlockedAll = false;
    // Locked until its requirements are done.
    expect(setResearch(world, 'titaniumAlloys')).toBe(false);
    for (const id of ['causeways', 'electricity']) world.research.levels[id] = 1;
    expect(setResearch(world, 'titaniumAlloys')).toBe(true);
  });
});
