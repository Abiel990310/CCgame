import {
  BEACON_BOOST,
  BEACON_BURN_SECONDS,
  BEACON_FUEL_CAP,
  BEACON_LIT,
  BEACON_WARD_TILES,
  BEACON_STAGES,
  BEACON_STAGE_BY_ID,
  BEACON_XP,
  type BeaconStage,
} from '../data/beacon';
import type { ResearchBonuses } from './research';
import { tileCenter } from './grid';
import { grantXp } from './progression';
import { addToSlots, countIn, takeFromSlots } from './slots';
import { TILE } from './constants';
import type { ItemId, Machine, Vec2, World } from './types';

/** The stage a beacon is building, or null once it is lit. A new one starts at the first. */
export function beaconStage(machine: Machine): { stage: BeaconStage; index: number } | null {
  if (machine.recipe === BEACON_LIT) return null;
  return BEACON_STAGE_BY_ID.get(machine.recipe ?? '') ?? { stage: BEACON_STAGES[0], index: 0 };
}

export function beaconLit(machine: Machine): boolean {
  return machine.recipe === BEACON_LIT;
}

/** Seconds a lit beacon will keep burning on what it has already caught. */
export function beaconBurning(machine: Machine): boolean {
  return beaconLit(machine) && machine.progress > 0;
}

/** How many more of an item the current stage still wants; once lit, its fuel. */
export function beaconWants(machine: Machine, item: ItemId): number {
  if (beaconLit(machine)) return item === 'processor' ? Math.max(0, BEACON_FUEL_CAP - countIn(machine.input, item)) : 0;
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
export function stepBeacon(world: World, machine: Machine, dt: number): void {
  const current = beaconStage(machine);
  if (!current) {
    // Lit: \`progress\` is the seconds of burn left on the processor it last took.
    machine.progress = Math.max(0, machine.progress - dt);
    if (machine.progress <= 0 && takeFromSlots(machine.input, 'processor', 1) === 1) {
      machine.progress = BEACON_BURN_SECONDS;
    }
    machine.stalled = machine.progress <= 0;
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

/**
 * Research bonuses with any burning beacon's boost added on. Read once a tick
 * before the machines step, so every machine that tick sees the same number.
 */
export function withBeacon(world: World, bonuses: ResearchBonuses): ResearchBonuses {
  if (!world.machines.some((m) => m.type === 'beacon' && beaconBurning(m))) return bonuses;
  return {
    ...bonuses,
    crafting: bonuses.crafting + BEACON_BOOST,
    mining: bonuses.mining + BEACON_BOOST,
    lab: bonuses.lab + BEACON_BOOST,
  };
}

/** Centres of every burning beacon, and how far each one's ward reaches. */
export function beaconWards(world: World): { pos: Vec2; radius: number }[] {
  const wards: { pos: Vec2; radius: number }[] = [];
  for (const m of world.machines) {
    if (m.type === 'beacon' && beaconBurning(m)) wards.push({ pos: tileCenter(m.tx, m.ty), radius: BEACON_WARD_TILES * TILE });
  }
  return wards;
}

/** How many beacons on the island have been lit, burning or not. */
export function litBeacons(world: World): number {
  return world.machines.filter((m) => m.type === 'beacon' && beaconLit(m)).length;
}
