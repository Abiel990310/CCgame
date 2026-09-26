import { describe, expect, it } from 'vitest';
import { applyOrder } from '../commands';
import { oreLeftAt } from '../ore';
import { activeTech, finishCycle, cyclesNeeded, orderResearch, researchBonuses } from '../research';
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
