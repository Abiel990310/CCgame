import { MAP_TILES, TILE } from './constants';
import type { Direction, Vec2 } from './types';

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

export function dirAngle(dir: Direction): number {
  return (dir * Math.PI) / 2;
}
