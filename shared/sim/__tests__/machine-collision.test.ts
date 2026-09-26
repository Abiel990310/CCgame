import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { PLAYER, TICK_DT, TILE } from '../constants';
import { tileCenter } from '../grid';
import { spawnMob } from '../systems/mobs';
import { step } from '../step';
import type { PlayerInput, Vec2 } from '../types';
import { at, bench, put, type Bench } from './bench';

/** Hold one input for a while, the way a player leans on a key. */
function walk(b: Bench, move: Vec2, seconds: number, dash = false): void {
  const input: PlayerInput = { move, dash, interact: false };
  const inputs = new Map([[b.player.id, input]]);
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(b.world, inputs);
}

function standAt(b: Bench, dx: number, dy: number): void {
  const t = at(dx, dy);
  b.player.pos = tileCenter(t.tx, t.ty);
  b.player.vel = { x: 0, y: 0 };
}

function overlapsTile(pos: Vec2, radius: number, tx: number, ty: number): boolean {
  const half = TILE / 2;
  const c = tileCenter(tx, ty);
  const nx = Math.max(c.x - half, Math.min(pos.x, c.x + half));
  const ny = Math.max(c.y - half, Math.min(pos.y, c.y + half));
  return Math.hypot(pos.x - nx, pos.y - ny) < radius - 1e-6;
}

describe('machines are solid', () => {
  it('stops a player walking into a furnace', () => {
    const b = bench();
    const t = at(6, 3);
    put(b, 'furnace', t.tx, t.ty, 0);
    standAt(b, 2, 3);

    walk(b, { x: 1, y: 0 }, 2);

    expect(overlapsTile(b.player.pos, PLAYER.radius, t.tx, t.ty)).toBe(false);
    expect(b.player.pos.x).toBeLessThan(tileCenter(t.tx, t.ty).x);
    // It walked up to the furnace rather than stopping somewhere short of it.
    expect(tileCenter(t.tx, t.ty).x - b.player.pos.x).toBeLessThan(TILE / 2 + PLAYER.radius + 1);
  });

  it('does not let a dash tunnel through a machine', () => {
    const b = bench();
    const t = at(6, 3);
    // A dash leaps a machine with ground beyond it (vault.test.ts); a block
    // too deep to clear is where it has to stop against the face.
    for (let dx = 6; dx < 12; dx++) put(b, 'chest', at(dx, 3).tx, t.ty, 0);
    standAt(b, 4, 3);

    walk(b, { x: 1, y: 0 }, 0.5, true);

    expect(b.player.pos.x).toBeLessThan(tileCenter(t.tx, t.ty).x);
  });

  it('slides a player along a row of machines instead of sticking', () => {
    const b = bench();
    for (let dx = 4; dx < 10; dx++) {
      const t = at(dx, 3);
      put(b, 'chest', t.tx, t.ty, 0);
    }
    standAt(b, 4, 2);
    const startX = b.player.pos.x;

    // Pressing down-right into the row still carries the player along it.
    walk(b, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 1);

    expect(b.player.pos.x - startX).toBeGreaterThan(TILE * 2);
    expect(b.player.pos.y).toBeLessThan(tileCenter(at(0, 3).tx, at(0, 3).ty).y);
  });

  it('keeps belts and splitters walkable', () => {
    const b = bench();
    for (let dx = 4; dx < 7; dx++) {
      const t = at(dx, 3);
      put(b, 'belt', t.tx, t.ty, 1);
    }
    const s = at(7, 3);
    put(b, 'splitter', s.tx, s.ty, 1);
    standAt(b, 2, 3);

    walk(b, { x: 1, y: 0 }, 1.5);

    expect(b.player.pos.x).toBeGreaterThan(tileCenter(s.tx, s.ty).x);
  });

  it('pushes a player out of a machine placed on top of them', () => {
    const b = bench();
    standAt(b, 5, 3);
    const t = at(5, 3);
    put(b, 'assembler', t.tx, t.ty, 0);

    walk(b, { x: 0, y: 0 }, TICK_DT);

    expect(overlapsTile(b.player.pos, PLAYER.radius, t.tx, t.ty)).toBe(false);
  });

  it('stops mobs too', () => {
    const b = bench();
    const wall = at(10, 3);
    for (let dy = 0; dy < 8; dy++) put(b, 'chest', wall.tx, wall.ty - 3 + dy, 0);
    standAt(b, 14, 3);
    const start = tileCenter(at(6, 3).tx, at(6, 3).ty);
    const mob = spawnMob(b.world, 'slime', start);

    const inputs = new Map([[b.player.id, { move: { x: 0, y: 0 }, dash: false, interact: false }]]);
    for (let i = 0; i < Math.round(4 / TICK_DT); i++) {
      step(b.world, inputs);
      for (let dy = 0; dy < 8; dy++) {
        expect(overlapsTile(mob.pos, 13, wall.tx, wall.ty - 3 + dy)).toBe(false);
      }
    }
    const face = tileCenter(wall.tx, wall.ty).x - TILE / 2;
    expect(mob.pos.x).toBeLessThan(face);
    // It reached the chests and pressed on them, not merely ran out of time.
    expect(mob.pos.x).toBeGreaterThan(face - 13 - 2);
  });

  it('marks every machine but the splitter, the merger, the tunnel ends and the pole solid', () => {
    const walkable = Object.values(MACHINES).filter((m) => !m.solid).map((m) => m.id);
    expect(walkable).toEqual(['splitter', 'merger', 'tunnel', 'tunnelExit', 'pole']);
  });
});
