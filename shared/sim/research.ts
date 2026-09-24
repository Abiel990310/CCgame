import type { TechDef, TechEffectKind } from '../data/techs';
import { TECHS, TECH_BY_ID, UNLOCKED_BY, techCycles } from '../data/techs';
import { grantXp } from './progression';
import type { MachineId, Research, World } from './types';

export function newResearch(): Research {
  return { current: null, progress: {}, levels: {}, unlockedAll: false };
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
  if (id === null) {
    world.research.current = null;
    return true;
  }

  const def = TECH_BY_ID.get(id);
  if (!def || !isAvailable(world, def) || isFinished(world, def)) return false;
  if (world.research.current === id) return false;

  world.research.current = id;
  return true;
}

/**
 * What to research once one finishes, so a lab does not sit idle the moment a
 * tech completes. One-shot techs come first in table order; the repeatable
 * ones are the tail that never runs out.
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

  // A repeatable tech stays selected; anything else hands the labs the next
  // thing to chew on rather than stalling every line feeding them.
  const next = def.repeatable ? def : nextTech(world);
  research.current = next ? next.id : null;

  world.events.push({
    kind: 'research',
    tech: def.id,
    level,
    next: next && next.id !== def.id ? next.id : null,
  });
}
