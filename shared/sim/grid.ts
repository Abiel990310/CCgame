import { MACHINES } from '../data/machines';
import { MAP_TILES, TILE } from './constants';
import type { Belt, Direction, Machine, MachineId, Vec2 } from './types';

/** Packs tile coordinates into one integer key for the occupancy map. */
export function tileKey(tx: number, ty: number): number {
  return ty * MAP_TILES + tx;
}

export function inBounds(tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES;
}

export function toTile(pos: Vec2): { tx: number; ty: number } {
  return { tx: Math.floor(pos.x / TILE), ty: Math.floor(pos.y / TILE) };
}

/** Centre of a tile in world units — where machines and belts are drawn. */
export function tileCenter(tx: number, ty: number): Vec2 {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

/** Direction order is right, down, left, up. */
export const DIR_VECTORS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export function step1(tx: number, ty: number, dir: Direction): { tx: number; ty: number } {
  return stepN(tx, ty, dir, 1);
}

/** The tile `n` steps away, which is how an arm reaches over what lies between. */
export function stepN(
  tx: number,
  ty: number,
  dir: Direction,
  n: number,
): { tx: number; ty: number } {
  const v = DIR_VECTORS[dir];
  return { tx: tx + v.x * n, ty: ty + v.y * n };
}

export function opposite(dir: Direction): Direction {
  return ((dir + 2) % 4) as Direction;
}

export function rotate(dir: Direction): Direction {
  return ((dir + 1) % 4) as Direction;
}

/** A quarter turn anticlockwise — the direction on an entity's left. */
export function turnLeft(dir: Direction): Direction {
  return ((dir + 3) % 4) as Direction;
}

export function dirAngle(dir: Direction): number {
  return (dir * Math.PI) / 2;
}

/** Tiles along one side of a machine's footprint: 1 for nearly everything. */
export function machineSize(type: MachineId): number {
  return MACHINES[type].size ?? 1;
}

/** Every tile a machine stands on, its anchor (top-left) first. */
export function footprint(machine: { type: MachineId; tx: number; ty: number }): Array<{ tx: number; ty: number }> {
  return footprintAt(machine.type, machine.tx, machine.ty);
}

/** The tiles a machine of this type would cover with its anchor here. */
export function footprintAt(type: MachineId, tx: number, ty: number): Array<{ tx: number; ty: number }> {
  const size = machineSize(type);
  const tiles: Array<{ tx: number; ty: number }> = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) tiles.push({ tx: tx + x, ty: ty + y });
  return tiles;
}

/** The middle of a machine's footprint, where it is drawn and where events happen. */
export function machineCentre(machine: { type: MachineId; tx: number; ty: number }): Vec2 {
  const half = (machineSize(machine.type) * TILE) / 2;
  return { x: machine.tx * TILE + half, y: machine.ty * TILE + half };
}

/** Put a belt or machine on the occupancy grid, on every tile it covers. */
export function occupy(grid: Map<number, Belt | Machine>, entity: Belt | Machine): void {
  if ('items' in entity) {
    grid.set(tileKey(entity.tx, entity.ty), entity);
    return;
  }
  for (const tile of footprint(entity)) grid.set(tileKey(tile.tx, tile.ty), entity);
}

/** Take a machine off the grid, from every tile it covers. */
export function vacate(grid: Map<number, Belt | Machine>, entity: Belt | Machine): void {
  if ('items' in entity) {
    grid.delete(tileKey(entity.tx, entity.ty));
    return;
  }
  for (const tile of footprint(entity)) grid.delete(tileKey(tile.tx, tile.ty));
}
