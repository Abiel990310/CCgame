import { expect } from 'vitest';
import { TICK_DT } from '../constants';
import { placeBelt, placeMachine, setRecipe } from '../factory';
import { tileKey } from '../grid';
import { addItem } from '../inventory';
import { addToSlots, countIn, stacksIn, totalIn } from '../slots';
import { ORE_ORDER } from '../ore';
import { EMPTY_INPUT, step } from '../step';
import { TERRAIN_ORDER } from '../terrain';
import type {
  Belt,
  Direction,
  ItemId,
  Machine,
  MachineId,
  OreKind,
  Player,
  Slot,
  World,
} from '../types';
import { addPlayer, createWorld } from '../world';

/**
 * A prepared build site for factory tests.
 *
 * Generated terrain decides where a line will fit, which makes a test that
 * hunts for a spot either seed-dependent or quietly skipped. The bench instead
 * flattens a strip of tiles well clear of the camp and plants ore where the
 * test asks for it, so any layout is buildable and a placement that fails is a
 * real failure.
 */
export const BENCH = { tx: 20, ty: 60, width: 30, height: 8 };

export interface Bench {
  world: World;
  player: Player;
}

export function bench(seed = 2026): Bench {
  const world = createWorld(seed, true);
  const player = addPlayer(world, 'line-tester');

  // Enough of everything the machines cost, so placement never fails for want
  // of materials.
  for (const item of ['wood', 'stone', 'ironPlate'] as ItemId[]) addItem(player, item, 900);

  const grass = TERRAIN_ORDER.indexOf('grass');
  for (let ty = BENCH.ty; ty < BENCH.ty + BENCH.height; ty++) {
    for (let tx = BENCH.tx; tx < BENCH.tx + BENCH.width; tx++) {
      world.terrain[tileKey(tx, ty)] = grass;
      world.ore[tileKey(tx, ty)] = 0;
    }
  }

  return { world, player };
}

/** A tile on the bench, offset from its top-left corner. */
export function at(dx: number, dy: number): { tx: number; ty: number } {
  return { tx: BENCH.tx + dx, ty: BENCH.ty + dy };
}

export function plantOre(world: World, kind: OreKind, tx: number, ty: number): void {
  world.ore[tileKey(tx, ty)] = ORE_ORDER.indexOf(kind);
}

/** Run the whole simulation forward, the same way the game does. */
export function advance(world: World, seconds: number): void {
  const ticks = Math.round(seconds / TICK_DT);
  const inputs = new Map([...world.players.keys()].map((id) => [id, EMPTY_INPUT]));
  for (let i = 0; i < ticks; i++) step(world, inputs);
}

/** One part of a line: a belt, or a machine optionally set to a recipe. */
export type Part = 'belt' | MachineId | [MachineId, string];

/** Place one part, failing the test rather than skipping when it will not fit. */
export function put(b: Bench, part: Part, tx: number, ty: number, dir: Direction): Belt | Machine {
  if (part === 'belt') {
    const belt = placeBelt(b.world, b.player, tx, ty, dir);
    expect(belt, `no belt at ${tx},${ty}`).not.toBe(null);
    return belt!;
  }

  const [type, recipe] = Array.isArray(part) ? part : [part, null];
  const machine = placeMachine(b.world, b.player, type, tx, ty, dir);
  expect(machine, `no ${type} at ${tx},${ty}`).not.toBe(null);
  if (recipe) expect(setRecipe(b.world, machine!.id, recipe), `recipe ${recipe}`).toBe(true);
  return machine!;
}

/** Place parts on consecutive tiles from (tx, ty), each facing the next one. */
export function lay(
  b: Bench,
  tx: number,
  ty: number,
  dir: Direction,
  parts: Part[],
): Array<Belt | Machine> {
  const stepX = dir === 0 ? 1 : dir === 2 ? -1 : 0;
  const stepY = dir === 1 ? 1 : dir === 3 ? -1 : 0;
  return parts.map((part, i) => put(b, part, tx + stepX * i, ty + stepY * i, dir));
}

/** How many of one item a machine is holding on its input side. */
export function held(machine: Machine, item: ItemId): number {
  return countIn(machine.input, item);
}

export function totalHeld(machine: Machine): number {
  return totalIn(machine.input);
}

/** The distinct items in a machine's storage, ignoring which slot they sit in. */
export function contents(slots: Slot[]): ItemId[] {
  return stacksIn(slots).map((s) => s.id);
}

/** Put items straight into a machine's grid, the way a belt would. */
export function fill(slots: Slot[], item: ItemId, count: number, max = Infinity): void {
  expect(addToSlots(slots, item, count, max)).toBe(count);
}

export function itemsOnBelts(world: World): number {
  return world.belts.reduce((n, belt) => n + belt.items.length, 0);
}
