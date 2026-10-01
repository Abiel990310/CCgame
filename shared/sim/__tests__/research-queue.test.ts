import { describe, expect, it } from 'vitest';
import { applyOrder } from '../commands';
import { oreLeftAt } from '../ore';
import {
  MAX_PLANNED,
  activeTech,
  finishCycle,
  cyclesNeeded,
  orderResearch,
  pruneResearchQueue,
  researchBonuses,
  researchPlan,
} from '../research';
import { countIn } from '../slots';
import { TECH_BY_ID } from '../../data/techs';
import type { Machine, World } from '../types';
import { advance, at, bench, plantOre, put } from './bench';

function finish(world: World, id: string): void {
  const tech = TECH_BY_ID.get(id)!;
  const needed = cyclesNeeded(world, tech);
  for (let i = 0; i < needed; i++) finishCycle(world, tech, 1);
}

describe('the research queue', () => {
  it('queues the road to a locked tech, prerequisites first', () => {
    const { world } = bench();
    expect(orderResearch(world, 'roboticArms', 'add')).toBe(true);
    expect(world.research.current).toBe('automation');
    expect(world.research.queue).toEqual(['beltLogistics', 'roboticArms']);
  });

  it('works through the queue in the player\'s order, not the table\'s', () => {
    const { world } = bench();
    orderResearch(world, 'automation', 'add');
    orderResearch(world, 'angling', 'add');
    orderResearch(world, 'toolmaking', 'add');
    orderResearch(world, 'toolmaking', 'up');
    expect(world.research.queue).toEqual(['toolmaking', 'angling']);

    finish(world, 'automation');
    expect(activeTech(world)?.id).toBe('toolmaking');
    expect(world.events).toContainEqual({ kind: 'research', tech: 'automation', level: 1, next: 'toolmaking' });
    finish(world, 'toolmaking');
    expect(activeTech(world)?.id).toBe('angling');
    expect(world.research.queue).toEqual([]);
  });

  it('never moves a tech ahead of its own prerequisite', () => {
    const { world } = bench();
    orderResearch(world, 'beltLogistics', 'add');
    expect(orderResearch(world, 'beltLogistics', 'up')).toBe(false);
    expect(world.research.current).toBe('automation');
  });

  it('takes out what was queued on a tech that is dropped', () => {
    const { world } = bench();
    orderResearch(world, 'roboticArms', 'add');
    orderResearch(world, 'toolmaking', 'add');
    expect(orderResearch(world, 'beltLogistics', 'remove')).toBe(true);
    expect(world.research.queue).toEqual(['toolmaking']);

    // Dropping the current tech hands the labs the next one in line.
    orderResearch(world, 'automation', 'remove');
    expect(world.research.current).toBe(null);
    expect(world.research.queue).toEqual([]);
  });

  it('moves the front of the queue into the labs, banking what the old one had', () => {
    const { world } = bench();
    world.research.levels.automation = 1;
    orderResearch(world, 'metallurgy', 'add');
    orderResearch(world, 'toolmaking', 'add');
    finishCycle(world, TECH_BY_ID.get('metallurgy')!, 1);

    expect(orderResearch(world, 'toolmaking', 'up')).toBe(true);
    expect(world.research.current).toBe('toolmaking');
    expect(world.research.queue).toEqual(['metallurgy']);
    expect(world.research.progress.metallurgy).toBe(1);
  });

  it('lets a repeatable tech give way to whatever is queued after it', () => {
    const { world } = bench();
    for (const id of ['automation', 'beltLogistics', 'metallurgy', 'roboticArms', 'labAutomation']) {
      world.research.levels[id] = 1;
    }
    orderResearch(world, 'deepDrilling', 'add');
    orderResearch(world, 'toolmaking', 'add');
    finish(world, 'deepDrilling');
    expect(activeTech(world)?.id).toBe('toolmaking');
  });

  it('falls back to the next open tech only when nothing is queued', () => {
    const { world } = bench();
    orderResearch(world, 'automation', 'add');
    finish(world, 'automation');
    expect(activeTech(world)?.id).toBe('beltLogistics');
  });

  it('is a command, and refuses nonsense off the wire', () => {
    const b = bench();
    const p = b.player.id;
    expect(applyOrder(b.world, { p, c: { k: 'queue', tech: 'angling', op: 'add' } })).toBe(true);
    expect(b.world.research.queue).toEqual(['angling']);
    expect(applyOrder(b.world, { p, c: { k: 'queue', tech: 'nope', op: 'add' } })).toBe(false);
    // @ts-expect-error a malformed op from another browser
    expect(applyOrder(b.world, { p, c: { k: 'queue', tech: 'angling', op: 'sideways' } })).toBe(false);
  });
});

describe('a repeatable tech planned more than once', () => {
  const ready = (): World => {
    const { world } = bench();
    for (const id of ['automation', 'prospecting', 'labAutomation', 'metallurgy']) world.research.levels[id] = 1;
    return world;
  };

  it('takes one entry per level, and the others still only one', () => {
    const world = ready();
    expect(orderResearch(world, 'miningProductivity', 'add')).toBe(true);
    expect(orderResearch(world, 'miningProductivity', 'add')).toBe(true);
    expect(orderResearch(world, 'miningProductivity', 'add')).toBe(true);
    expect(researchPlan(world.research)).toEqual(['miningProductivity', 'miningProductivity', 'miningProductivity']);

    expect(orderResearch(world, 'toolmaking', 'add')).toBe(true);
    expect(orderResearch(world, 'toolmaking', 'add')).toBe(false);
  });

  it('runs the levels back to back, each dearer than the last', () => {
    const world = ready();
    for (let i = 0; i < 3; i++) orderResearch(world, 'miningProductivity', 'add');
    const def = TECH_BY_ID.get('miningProductivity')!;

    finish(world, 'miningProductivity');
    expect(world.research.levels.miningProductivity).toBe(1);
    expect(activeTech(world)?.id).toBe('miningProductivity');
    expect(world.research.queue).toEqual(['miningProductivity']);
    expect(cyclesNeeded(world, def)).toBe(def.cycles * 2);

    finish(world, 'miningProductivity');
    finish(world, 'miningProductivity');
    expect(world.research.levels.miningProductivity).toBe(3);
    // The plan was three levels; it stays on the tech only because nothing else is queued.
    expect(activeTech(world)?.id).toBe('miningProductivity');
    expect(world.research.queue).toEqual([]);
  });

  it('drops one level at a time, from the end unless told which', () => {
    const world = ready();
    for (let i = 0; i < 3; i++) orderResearch(world, 'miningProductivity', 'add');
    orderResearch(world, 'toolmaking', 'add');

    expect(orderResearch(world, 'miningProductivity', 'remove')).toBe(true);
    expect(researchPlan(world.research)).toEqual(['miningProductivity', 'miningProductivity', 'toolmaking']);

    // Removing the front entry hands the labs the next level of the same tech.
    expect(orderResearch(world, 'miningProductivity', 'remove', 0)).toBe(true);
    expect(researchPlan(world.research)).toEqual(['miningProductivity', 'toolmaking']);
    // A place that holds some other tech is not this tech's to drop.
    expect(orderResearch(world, 'miningProductivity', 'remove', 1)).toBe(false);
    expect(orderResearch(world, 'miningProductivity', 'remove', 9)).toBe(false);
  });

  it('lets a level move past another tech but not past itself', () => {
    const world = ready();
    orderResearch(world, 'miningProductivity', 'add');
    orderResearch(world, 'miningProductivity', 'add');
    orderResearch(world, 'toolmaking', 'add');

    expect(orderResearch(world, 'miningProductivity', 'up', 1)).toBe(false);
    expect(orderResearch(world, 'toolmaking', 'up', 2)).toBe(true);
    expect(researchPlan(world.research)).toEqual(['miningProductivity', 'toolmaking', 'miningProductivity']);
  });

  it('is cut back to the cap, in a world and off a save', () => {
    const world = ready();
    for (let i = 0; i < MAX_PLANNED + 5; i++) orderResearch(world, 'miningProductivity', 'add');
    expect(researchPlan(world.research)).toHaveLength(MAX_PLANNED);

    world.research.queue = Array(MAX_PLANNED * 2).fill('miningProductivity');
    pruneResearchQueue(world.research);
    expect(researchPlan(world.research)).toHaveLength(MAX_PLANNED);
  });

  it('takes a plan off a tech that needs a prerequisite that is gone', () => {
    const world = ready();
    world.research.levels.labAutomation = 0;
    world.research.queue = ['miningProductivity', 'miningProductivity'];
    pruneResearchQueue(world.research);
    expect(world.research.queue).toEqual([]);
  });

  it('is a command that refuses a place that is not a whole number', () => {
    const b = bench();
    const p = b.player.id;
    // Automation first, then Angling at place 1.
    orderResearch(b.world, 'angling', 'add');
    // @ts-expect-error a malformed place from another browser
    expect(applyOrder(b.world, { p, c: { k: 'queue', tech: 'angling', op: 'remove', place: 'x' } })).toBe(false);
    expect(applyOrder(b.world, { p, c: { k: 'queue', tech: 'angling', op: 'remove', place: 0.5 } })).toBe(false);
    expect(applyOrder(b.world, { p, c: { k: 'queue', tech: 'angling', op: 'remove', place: 1 } })).toBe(true);
  });
});

describe('ore yield research', () => {
  const mine = (techs: string[]): { out: number; left: number; rng: number } => {
    const b = bench();
    for (const id of techs) b.world.research.levels[id] = 1;
    const { tx, ty } = at(3, 6);
    plantOre(b.world, 'ironOre', tx, ty, 20);
    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    advance(b.world, 50);
    return { out: countIn(miner.output, 'ironOre'), left: oreLeftAt(b.world, tx, ty), rng: b.world.rngState };
  };

  it('takes exactly one ore from the tile per ore without it', () => {
    expect(mine([]).out).toBe(20);
  });

  it('gets more ore out of the same tile, and the tile still runs dry', () => {
    const techs = ['automation', 'prospecting', 'metallurgy', 'electricity', 'flotation'];
    const { world } = bench();
    for (const id of techs) world.research.levels[id] = 1;
    expect(researchBonuses(world).yield).toBeCloseTo(1.45);

    const run = mine(techs);
    expect(run.out).toBeGreaterThan(22);
    expect(run.out).toBeLessThanOrEqual(50);
    expect(run.left).toBe(0);
    // Same island, same research, same ore: the spared draws are the world's.
    expect(mine(techs)).toEqual(run);
  });
});
