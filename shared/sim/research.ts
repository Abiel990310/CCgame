import type { TechDef, TechEffectKind } from '../data/techs';
import { TECHS, TECH_BY_ID, UNLOCKED_BY, techCycles } from '../data/techs';
import { grantXp } from './progression';
import type { MachineId, Research, World } from './types';

export function newResearch(): Research {
  return { current: null, queue: [], progress: {}, levels: {}, unlockedAll: false };
}

/** How many times a tech has been completed. One-shot techs are 0 or 1. */
export function techLevel(world: World, id: string): number {
  return world.research.levels[id] ?? 0;
}

/** True when every prerequisite is finished, so this tech can be worked on. */
export function isAvailable(world: World, def: TechDef): boolean {
  return def.requires.every((id) => techLevel(world, id) > 0);
}

/**
 * True when this island may build the machine. Enforced here rather than in
 * the palette, so a server running the same code refuses a locked piece
 * whatever a client claims to have on its bar.
 */
export function isUnlocked(world: World, id: MachineId): boolean {
  if (world.research.unlockedAll) return true;
  const tech = UNLOCKED_BY.get(id);
  return !tech || techLevel(world, tech.id) > 0;
}

/**
 * Mark every prerequisite of a finished tech as finished too. A tech added to
 * the tree later, beneath one an island has already researched, would
 * otherwise sit locked under it and take back machines already standing.
 */
export function backfillPrerequisites(research: Research): void {
  const pending = Object.keys(research.levels).filter((id) => (research.levels[id] ?? 0) > 0);
  while (pending.length > 0) {
    const def = TECH_BY_ID.get(pending.pop()!);
    for (const id of def?.requires ?? []) {
      if ((research.levels[id] ?? 0) > 0) continue;
      research.levels[id] = 1;
      delete research.progress[id];
      pending.push(id);
    }
  }
}

/** True when there is nothing left to gain from it. Repeatable techs never are. */
export function isFinished(world: World, def: TechDef): boolean {
  return !def.repeatable && techLevel(world, def.id) > 0;
}

export function activeTech(world: World): TechDef | null {
  const id = world.research.current;
  return id ? (TECH_BY_ID.get(id) ?? null) : null;
}

/** Cycles the current level of a tech takes, at this island's progress. */
export function cyclesNeeded(world: World, def: TechDef): number {
  return techCycles(def, techLevel(world, def.id));
}

/** Cycles already banked toward a tech. */
export function cyclesDone(world: World, id: string): number {
  return world.research.progress[id] ?? 0;
}

/**
 * Point the island's labs at a tech. Cycles are banked per tech, so switching
 * away and coming back later picks up exactly where it left off — changing
 * your mind costs only the packs a lab is holding mid-cycle, which it returns.
 */
export function setResearch(world: World, id: string | null): boolean {
  const research = world.research;
  if (id === null) {
    research.current = null;
    research.queue = [];
    return true;
  }

  const def = TECH_BY_ID.get(id);
  if (!def || !isAvailable(world, def) || isFinished(world, def)) return false;
  if (research.current === id) return false;

  research.queue = research.queue.filter((q) => q !== id);
  research.current = id;
  pruneResearchQueue(world.research);
  return true;
}

/** What a player can do to one tech in the lab screen's queue. */
export type QueueOp = 'add' | 'remove' | 'up';

export function isQueueOp(op: unknown): op is QueueOp {
  return op === 'add' || op === 'remove' || op === 'up';
}

/** True when the tech is being researched or waits in the queue. */
export function isPlanned(world: World, id: string): boolean {
  return world.research.current === id || world.research.queue.includes(id);
}

/**
 * Change the research queue. The order is the player's: labs take the front
 * of it the moment the current tech finishes, and only an empty queue falls
 * back to `nextTech`'s guess.
 */
export function orderResearch(world: World, id: string, op: QueueOp): boolean {
  const def = TECH_BY_ID.get(id);
  if (!def) return false;
  switch (op) {
    case 'add':
      return queueTech(world, def);
    case 'remove':
      return unqueueTech(world, id);
    case 'up':
      return raiseTech(world, def);
  }
}

/**
 * Queue a tech, and ahead of it every prerequisite not already done or
 * planned, deepest first. Asking for the thing you want is enough; the tree
 * works out the road to it.
 */
function queueTech(world: World, def: TechDef): boolean {
  if (isFinished(world, def) || isPlanned(world, def.id)) return false;

  const road: string[] = [];
  const visit = (tech: TechDef): void => {
    for (const req of tech.requires) {
      const before = TECH_BY_ID.get(req);
      if (!before || techLevel(world, req) > 0 || isPlanned(world, req) || road.includes(req)) continue;
      visit(before);
    }
    road.push(tech.id);
  };
  visit(def);

  world.research.queue.push(...road);
  if (world.research.current === null) advanceResearch(world);
  return true;
}

function unqueueTech(world: World, id: string): boolean {
  const research = world.research;
  if (research.current === id) {
    // The next in line takes over, but never a guess: labs the player has just
    // stopped should stay stopped rather than pick the same tech back up.
    research.current = null;
    pruneResearchQueue(research);
    research.current = research.queue.shift() ?? null;
    return true;
  }
  const at = research.queue.indexOf(id);
  if (at < 0) return false;
  research.queue.splice(at, 1);
  pruneResearchQueue(world.research);
  return true;
}

/**
 * Move a queued tech one place forward; from the front of the queue it takes
 * over from the current one, whose banked cycles wait for it. It never passes
 * its own prerequisite, which is the only thing that could make it unworkable.
 */
function raiseTech(world: World, def: TechDef): boolean {
  const research = world.research;
  const at = research.queue.indexOf(def.id);
  if (at < 0) return false;

  const ahead = at === 0 ? research.current : research.queue[at - 1];
  if (ahead === null) {
    research.queue.splice(at, 1);
    research.current = def.id;
    return true;
  }
  if (def.requires.includes(ahead)) return false;

  if (at === 0) {
    research.queue[0] = ahead;
    research.current = def.id;
  } else {
    research.queue[at - 1] = def.id;
    research.queue[at] = ahead;
  }
  return true;
}

/**
 * Drop anything from the queue that can no longer be reached where it sits:
 * finished, unknown, twice, or waiting on a prerequisite that is neither done
 * nor planned ahead of it. Taking a tech out takes out what was queued on it.
 */
export function pruneResearchQueue(research: Research): void {
  const done = (id: string): boolean => (research.levels[id] ?? 0) > 0;
  const ahead = new Set<string>();
  if (research.current) ahead.add(research.current);
  research.queue = research.queue.filter((id) => {
    const def = TECH_BY_ID.get(id);
    if (!def || ahead.has(id) || (!def.repeatable && done(id))) return false;
    if (!def.requires.every((req) => done(req) || ahead.has(req))) return false;
    ahead.add(id);
    return true;
  });
}

/**
 * Hand the labs the front of the queue, or `nextTech`'s guess when the player
 * has queued nothing, so no line feeding them stalls the moment a tech ends
 * or the first one is queued.
 */
function advanceResearch(world: World): TechDef | null {
  const research = world.research;
  pruneResearchQueue(world.research);
  const id = research.queue.shift();
  const next = id ? (TECH_BY_ID.get(id) ?? null) : nextTech(world);
  research.current = next ? next.id : null;
  return next;
}

/**
 * What to research once one finishes and nothing is queued, so a lab does not
 * sit idle the moment a tech completes. One-shot techs come first in table
 * order; the repeatable ones are the tail that never runs out.
 */
export function nextTech(world: World): TechDef | null {
  const open = TECHS.filter((t) => isAvailable(world, t) && !isFinished(world, t));
  return open.find((t) => !t.repeatable) ?? open[0] ?? null;
}

export type ResearchBonuses = Record<TechEffectKind, number>;

const NONE: ResearchBonuses = {
  mining: 1,
  crafting: 1,
  belt: 1,
  inserter: 1,
  lab: 1,
  xp: 1,
  gather: 1,
  damage: 1,
  fuel: 1,
  power: 1,
  yield: 1,
};

/**
 * Every completed tech as one multiplier per effect. Summed over `TECHS` rather
 * than over the levels object, so the order the additions happen in is the
 * table's and never a save file's — a float sum is order-dependent, and the
 * simulation has to land on the same number on every machine that runs it.
 */
export function researchBonuses(world: World): ResearchBonuses {
  const bonuses = { ...NONE };
  for (const def of TECHS) {
    const level = techLevel(world, def.id);
    if (level > 0 && def.effect) bonuses[def.effect.kind] += def.effect.amount * level;
  }
  return bonuses;
}

/**
 * One finished lab cycle. The XP is the point as much as the tech is:
 * automating the island is what earns levels once you stop swinging an axe by
 * hand, and it is the only levelling a peaceful world has.
 */
export function finishCycle(world: World, def: TechDef, xpBonus: number): void {
  const research = world.research;
  const banked = cyclesDone(world, def.id) + 1;
  research.progress[def.id] = banked;

  for (const player of world.players.values()) grantXp(world, player, def.xp * xpBonus);

  if (banked < cyclesNeeded(world, def)) return;

  const level = techLevel(world, def.id) + 1;
  research.levels[def.id] = level;
  // A repeatable tech starts its next level from nothing, at a higher price.
  research.progress[def.id] = 0;

  // A repeatable tech keeps going until the player queues something after
  // it; anything else hands the labs the next thing to chew on rather than
  // stalling every line feeding them.
  const next = def.repeatable && research.queue.length === 0 ? def : advanceResearch(world);

  world.events.push({
    kind: 'research',
    tech: def.id,
    level,
    next: next && next.id !== def.id ? next.id : null,
  });
}
