import { MACHINES, placementCost } from '../data/machines';
import { TILE } from './constants';
import { inBounds, tileCenter, tileKey } from './grid';
import { giveOrDrop, hasAll, payAll } from './inventory';
import { isUnlocked } from './research';
import { BRIDGE_OVER_DEEP, BRIDGE_OVER_WATER, isBridgeByte, isWalkable, terrainAtIndex } from './terrain';
import type { MachineId, Player, World } from './types';

/**
 * Why a span cannot go down here, or null when it can. Reported with the
 * factory placement errors, so the ghost and the toast need nothing of their
 * own: the same words come out of the same place for every piece.
 */
export type BridgeError = 'bounds' | 'locked' | 'water' | 'anchor' | 'cost' | null;

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function bridgeError(world: World, player: Player, what: MachineId, tx: number, ty: number): BridgeError {
  if (!inBounds(tx, ty)) return 'bounds';
  if (!isUnlocked(world, what)) return 'locked';
  const here = terrainAtIndex(world.terrain, tx, ty);
  if (here !== 'water' && here !== 'deep') return 'water';
  // A span grows out of ground, so it can never float free of the shore.
  const anchored = NEIGHBOURS.some(([dx, dy]) => isWalkable(terrainAtIndex(world.terrain, tx + dx, ty + dy)));
  if (!anchored) return 'anchor';
  return hasAll(player, placementCost(what)) ? null : 'cost';
}

/** Lay one span over the water. Returns whether it went down. */
export function placeBridge(world: World, player: Player, what: MachineId, tx: number, ty: number): boolean {
  if (bridgeError(world, player, what, tx, ty) !== null) return false;
  if (!payAll(player, placementCost(what))) return false;
  const key = tileKey(tx, ty);
  world.terrain[key] = world.terrain[key] === 0 ? BRIDGE_OVER_DEEP : BRIDGE_OVER_WATER;
  world.events.push({ kind: 'placed', pos: tileCenter(tx, ty), what });
  return true;
}

/**
 * Take a span back up and put the sea back under it, refunding what it cost.
 * Refused while anything stands on it: a belt or machine has to come off
 * first, and anyone on the deck would be left in the water.
 */
export function removeBridge(world: World, player: Player, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const key = tileKey(tx, ty);
  const byte = world.terrain[key];
  if (!isBridgeByte(byte) || world.grid.has(key)) return false;
  const on = (pos: { x: number; y: number }): boolean => Math.floor(pos.x / TILE) === tx && Math.floor(pos.y / TILE) === ty;
  if ([...world.players.values()].some((p) => on(p.pos)) || world.mobs.some((m) => on(m.pos))) return false;
  world.terrain[key] = byte === BRIDGE_OVER_DEEP ? 0 : 1;
  world.events.push({ kind: 'removed', pos: tileCenter(tx, ty) });
  for (const entry of placementCost('bridge')) giveOrDrop(world, player, entry.id, entry.count);
  return true;
}

/** Whether a piece of the palette is a span rather than something that stands on the grid. */
export function isBridgePiece(what: MachineId): boolean {
  return MACHINES[what].family === 'bridge';
}
