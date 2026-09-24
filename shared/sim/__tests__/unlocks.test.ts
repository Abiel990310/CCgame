import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../data/items';
import { MACHINES, MACHINE_ORDER, TRAP_TIME } from '../../data/machines';
import { RECIPES } from '../../data/recipes';
import { TECHS, TECH_BY_ID, UNLOCKED_BY, type TechDef } from '../../data/techs';
import { factoryPlacementError, placeMachine } from '../factory';
import { tileKey } from '../grid';
import { addItem } from '../inventory';
import { finishCycle, isUnlocked } from '../research';
import { countIn } from '../slots';
import { TERRAIN_ORDER } from '../terrain';
import type { ItemId, Machine, MachineId, World } from '../types';
import { addPlayer, createWorld } from '../world';
import { advance, at, bench, lay, type Bench } from './bench';

/**
 * The palette opens as the island researches. These tests hold the gate to
 * three promises: a new island can always reach every machine, a peaceful
 * island can reach the top of the tree without a single wisp, and a gate is
 * enforced by the simulation rather than only by what the palette shows.
 */

/** Every tech that has to be finished before this one, and this one. */
function lineage(def: TechDef, into = new Set<string>()): Set<string> {
  if (into.has(def.id)) return into;
  into.add(def.id);
  for (const id of def.requires) lineage(TECH_BY_ID.get(id)!, into);
  return into;
}

/** An island that has to earn its machines, with a bench cleared on it. */
function gated(): Bench {
  const b = bench();
  b.world.research.unlockedAll = false;
  return b;
}

function finish(world: World, id: string): void {
  const def = TECH_BY_ID.get(id)!;
  for (let i = 0; i < def.cycles; i++) finishCycle(world, def, 1);
}

describe('the starting palette', () => {
  it('is enough to build a lab and feed it the first pack', () => {
    const world = createWorld(7, true);
    // A research pack is a gear and a copper plate: miners to dig, furnaces to
    // smelt, an assembler to make both, and a lab to eat it.
    for (const id of ['miner', 'furnace', 'assembler', 'lab', 'chest', 'inserter'] as const) {
      expect(isUnlocked(world, id), id).toBe(true);
    }
    const first = TECHS.filter((t) => t.requires.length === 0);
    for (const tech of first) {
      for (const input of tech.inputs) {
        const recipe = RECIPES.find((r) => r.outputs.some((o) => o.id === input.id))!;
        expect(isUnlocked(world, recipe.machine), recipe.machine).toBe(true);
      }
    }
  });

  it('holds back every tier above the first', () => {
    const world = createWorld(7, true);
    for (const id of MACHINE_ORDER) {
      if (MACHINES[id].tier > 1) expect(isUnlocked(world, id), id).toBe(false);
    }
  });
});

describe('the unlock table', () => {
  it('names each machine once, and only machines that exist', () => {
    const named = TECHS.flatMap((t) => t.unlocks ?? []);
    expect(new Set(named).size).toBe(named.length);
    for (const id of named) expect(MACHINES[id], id).toBeDefined();
  });

  it('opens each gated machine once its tech is done', () => {
    for (const [id, tech] of UNLOCKED_BY) {
      const world = createWorld(7, true);
      for (const done of lineage(tech)) world.research.levels[done] = 1;
      expect(isUnlocked(world, id), id).toBe(true);
    }
  });

  it('never gates a machine behind a pack its own tier has to make', () => {
    // A tech whose packs need the machine it unlocks could never be finished.
    for (const tech of TECHS) {
      const before = new Set([...lineage(tech)].filter((id) => id !== tech.id));
      const reachable = (id: MachineId): boolean => {
        const gate = UNLOCKED_BY.get(id);
        return !gate || before.has(gate.id);
      };
      for (const input of tech.inputs) {
        const recipe = RECIPES.find((r) => r.outputs.some((o) => o.id === input.id))!;
        expect(reachable(recipe.machine), `${tech.id} needs ${recipe.machine}`).toBe(true);
      }
    }
  });
});

describe('a peaceful island', () => {
  it('can reach the top of the tree by fishing alone', () => {
    // Essence is the one pack ingredient a miner cannot dig. Somewhere before
    // any tech that eats it, the island has to have earned a machine that
    // catches it, or peaceful is locked out of the endgame.
    const catchers = MACHINE_ORDER.filter((id) => MACHINES[id].family === 'fishTrap');
    expect(RESOURCES.fish.drops.some((d) => d.item === 'essence')).toBe(true);

    const needsEssence = (tech: TechDef): boolean =>
      tech.inputs.some((input) =>
        RECIPES.some(
          (r) =>
            r.outputs.some((o) => o.id === input.id) && r.inputs.some((i) => i.id === 'essence'),
        ),
      );

    const eaters = TECHS.filter(needsEssence);
    expect(eaters.length).toBeGreaterThan(0);
    for (const tech of eaters) {
      const earlier = [...lineage(tech)].filter((id) => id !== tech.id);
      const trap = catchers.some((id) => {
        const gate = UNLOCKED_BY.get(id);
        return !gate || earlier.includes(gate.id);
      });
      expect(trap, `${tech.id} has no fishing road`).toBe(true);
    }
  });
});

describe('placing a locked machine', () => {
  it('is refused by the simulation, not just hidden', () => {
    const b = gated();
    const { tx, ty } = at(2, 2);
    expect(factoryPlacementError(b.world, b.player, 'splitter', tx, ty)).toBe('locked');
    expect(placeMachine(b.world, b.player, 'splitter', tx, ty, 0)).toBe(null);

    finish(b.world, 'automation');
    finish(b.world, 'beltLogistics');
    expect(placeMachine(b.world, b.player, 'splitter', tx, ty, 0)).not.toBe(null);
  });

  it('cannot be dropped over the tier below it either', () => {
    const b = gated();
    const { tx, ty } = at(2, 2);
    expect(placeMachine(b.world, b.player, 'furnace', tx, ty, 0)).not.toBe(null);
    expect(factoryPlacementError(b.world, b.player, 'furnaceMk2', tx, ty)).toBe('locked');
    expect(placeMachine(b.world, b.player, 'furnaceMk2', tx, ty, 0)).toBe(null);

    finish(b.world, 'automation');
    finish(b.world, 'metallurgy');
    expect(placeMachine(b.world, b.player, 'furnaceMk2', tx, ty, 0)?.type).toBe('furnaceMk2');
  });

  it('never stops a machine already standing from working', () => {
    // An island that loses its unlock somehow keeps what it built running;
    // the gate is on placement and nothing else.
    const b = bench();
    addItem(b.player, 'fiber', 200);
    const trap = shoreTrap(b);
    b.world.research.unlockedAll = false;
    advance(b.world, TRAP_TIME * 3);
    expect(countIn(trap.output, 'fish') + countIn(trap.output, 'essence')).toBeGreaterThan(0);
  });

  it('is open to anyone on an island from before the gate', () => {
    const world = createWorld(7, true);
    world.research.unlockedAll = true;
    for (const id of MACHINE_ORDER) expect(isUnlocked(world, id), id).toBe(true);
  });
});

/** Turn the row above a bench tile into water, making the tile a shoreline. */
function shoreline(world: World, tx: number, ty: number): void {
  world.terrain[tileKey(tx, ty - 1)] = TERRAIN_ORDER.indexOf('water');
}

function shoreTrap(b: Bench): Machine {
  const { tx, ty } = at(4, 3);
  shoreline(b.world, tx, ty);
  const trap = placeMachine(b.world, b.player, 'fishTrap', tx, ty, 0);
  expect(trap).not.toBe(null);
  return trap!;
}

describe('a fish trap', () => {
  function trapBench(): Bench {
    const b = bench();
    addItem(b.player, 'fiber', 200);
    return b;
  }

  it('has to stand on the shore', () => {
    const b = trapBench();
    const { tx, ty } = at(4, 3);
    expect(factoryPlacementError(b.world, b.player, 'fishTrap', tx, ty)).toBe('shore');
    shoreline(b.world, tx, ty);
    expect(factoryPlacementError(b.world, b.player, 'fishTrap', tx, ty)).toBe(null);
  });

  it('belts fish and essence into a chest with nobody holding a rod', () => {
    const b = trapBench();
    const { tx, ty } = at(4, 3);
    shoreline(b.world, tx, ty);
    const [, , , chest] = lay(b, tx, ty, 0, ['fishTrap', 'belt', 'belt', 'chest']) as Machine[];

    // Long enough that a one-in-six catch cannot plausibly miss every roll.
    advance(b.world, TRAP_TIME * 120);
    const caught = (item: ItemId): number => countIn(chest.input, item);
    expect(caught('fish')).toBeGreaterThan(40);
    expect(caught('essence')).toBeGreaterThan(5);
    expect(caught('fish')).toBeGreaterThan(caught('essence'));
  });

  it('stops when nothing takes its catch away', () => {
    const b = trapBench();
    const trap = shoreTrap(b);
    advance(b.world, TRAP_TIME * 400);
    expect(trap.stalled).toBe(true);
    const held = countIn(trap.output, 'fish') + countIn(trap.output, 'essence');
    expect(held).toBeLessThanOrEqual(MACHINES.fishTrap.outputSlots * MACHINES.fishTrap.slotSize);
  });

  it('comes from research a peaceful island can do', () => {
    const world = createWorld(7, true);
    addPlayer(world, 'angler');
    expect(isUnlocked(world, 'fishTrap')).toBe(false);
    finish(world, 'automation');
    finish(world, 'angling');
    expect(isUnlocked(world, 'fishTrap')).toBe(true);
  });
});
