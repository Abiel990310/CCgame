import { BEACON_LIT, BEACON_STAGES, BEACON_STAGE_BY_ID, BEACON_XP, type BeaconStage } from '../data/beacon';
import { tileCenter } from './grid';
import { grantXp } from './progression';
import { addToSlots, countIn, takeFromSlots } from './slots';
import type { ItemId, Machine, World } from './types';

/** The stage a beacon is building, or null once it is lit. A new one starts at the first. */
export function beaconStage(machine: Machine): { stage: BeaconStage; index: number } | null {
  if (machine.recipe === BEACON_LIT) return null;
  return BEACON_STAGE_BY_ID.get(machine.recipe ?? '') ?? { stage: BEACON_STAGES[0], index: 0 };
}

export function beaconLit(machine: Machine): boolean {
  return machine.recipe === BEACON_LIT;
}

/** How many more of an item the current stage still wants. */
export function beaconWants(machine: Machine, item: ItemId): number {
  const current = beaconStage(machine);
  const need = current?.stage.needs.find((n) => n.id === item);
  return need ? Math.max(0, need.count - countIn(machine.input, item)) : 0;
}

/** Takes only what the stage under way still needs, so a line never overfeeds it. */
export function insertIntoBeacon(machine: Machine, item: ItemId, slotSize: number): boolean {
  if (beaconWants(machine, item) <= 0) return false;
  return addToSlots(machine.input, item, 1, slotSize) === 1;
}

/**
 * A stage is raised the moment everything it needs is in the grid. What it
 * swallowed is gone for good; the next stage starts on an empty grid.
 */
export function stepBeacon(world: World, machine: Machine): void {
  const current = beaconStage(machine);
  if (!current) {
    machine.stalled = false;
    return;
  }
  machine.recipe ??= current.stage.id;
  const done = current.stage.needs.every((n) => countIn(machine.input, n.id) >= n.count);
  machine.stalled = !done;
  if (!done) return;

  for (const n of current.stage.needs) takeFromSlots(machine.input, n.id, n.count);
  const next = BEACON_STAGES[current.index + 1];
  machine.recipe = next ? next.id : BEACON_LIT;
  // Progress is read by the renderer as how far up the spire has been built.
  machine.progress = 0;
  const lit = !next;
  world.events.push({ kind: 'beacon', pos: tileCenter(machine.tx, machine.ty), stage: current.index + 1, lit });
  if (lit) for (const player of world.players.values()) grantXp(world, player, BEACON_XP);
}
