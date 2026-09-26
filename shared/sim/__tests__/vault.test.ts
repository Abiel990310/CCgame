import { describe, expect, it } from 'vitest';
import { TILE, VAULT } from '../constants';
import { placeMachine } from '../factory';
import { tileKey } from '../grid';
import { EMPTY_INPUT } from '../step';
import { stepPlayerMovement } from '../systems/movement';
import { TERRAIN_ORDER } from '../terrain';
import type { PlayerInput, Terrain } from '../types';
import { at, bench } from './bench';

const DT = 1 / 30;
const EAST: PlayerInput = { ...EMPTY_INPUT, move: { x: 1, y: 0 } };
const DASH_EAST: PlayerInput = { ...EAST, dash: true };

/** A player standing in the middle of a bench tile, facing east, and a dash taken. */
function dashFrom(tx: number, ty: number, setup: (b: ReturnType<typeof bench>) => void) {
  const b = bench();
  setup(b);
  const { world, player } = b;
  player.pos = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  player.vel = { x: 0, y: 0 };
  player.facing = { x: 1, y: 0 };
  world.events.length = 0;
  stepPlayerMovement(world, player, DASH_EAST, DT);
  const vaulted = player.vault !== undefined;
  for (let t = 0; t < VAULT.duration + 0.3; t += DT) stepPlayerMovement(world, player, EMPTY_INPUT, DT);
  return { world, player, vaulted };
}

const paint = (world: ReturnType<typeof bench>['world'], tx: number, ty: number, t: Terrain): void => {
  world.terrain[tileKey(tx, ty)] = TERRAIN_ORDER.indexOf(t);
};

describe('vaulting', () => {
  it('a dash into a machine leaps it and lands on the far side', () => {
    const start = at(2, 4);
    const { world, player, vaulted } = dashFrom(start.tx, start.ty, ({ world, player }) => {
      expect(placeMachine(world, player, 'furnace', start.tx + 2, start.ty, 0)).not.toBe(null);
    });
    expect(vaulted).toBe(true);
    expect(world.events.some((e) => e.kind === 'vault')).toBe(true);
    expect(player.pos.x).toBeGreaterThan((start.tx + 3) * TILE + 11);
    expect(player.vault).toBeUndefined();
    expect(player.dashTime).toBe(0);
  });

  it('a dash with nothing in the way is a plain dash', () => {
    const start = at(2, 4);
    const { player, vaulted } = dashFrom(start.tx, start.ty, () => {});
    expect(vaulted).toBe(false);
    expect(player.pos.x).toBeGreaterThan(start.tx * TILE + TILE / 2 + 60);
  });

  it('clears a shallow stream but never deep water or one too wide', () => {
    const start = at(2, 4);
    const stream = dashFrom(start.tx, start.ty, ({ world }) => {
      for (let dy = -2; dy <= 2; dy++) {
        paint(world, start.tx + 2, start.ty + dy, 'water');
        paint(world, start.tx + 3, start.ty + dy, 'water');
      }
    });
    expect(stream.vaulted).toBe(true);
    expect(stream.player.pos.x).toBeGreaterThan((start.tx + 4) * TILE);

    const deep = dashFrom(start.tx, start.ty, ({ world }) => {
      for (let dy = -2; dy <= 2; dy++) paint(world, start.tx + 2, start.ty + dy, 'deep');
    });
    expect(deep.vaulted).toBe(false);
    expect(deep.player.pos.x).toBeLessThan((start.tx + 2) * TILE);

    const wide = dashFrom(start.tx, start.ty, ({ world }) => {
      for (let dx = 2; dx <= 7; dx++) for (let dy = -2; dy <= 2; dy++) paint(world, start.tx + dx, start.ty + dy, 'water');
    });
    expect(wide.vaulted).toBe(false);
    expect(wide.player.pos.x).toBeLessThan((start.tx + 2) * TILE);
  });

  it('is a dash to a blow: whatever swings at the player mid-leap misses', () => {
    const start = at(2, 4);
    const b = bench();
    const { world, player } = b;
    expect(placeMachine(world, player, 'furnace', start.tx + 2, start.ty, 0)).not.toBe(null);
    player.pos = { x: start.tx * TILE + TILE / 2, y: start.ty * TILE + TILE / 2 };
    player.facing = { x: 1, y: 0 };
    stepPlayerMovement(world, player, DASH_EAST, DT);
    stepPlayerMovement(world, player, EMPTY_INPUT, DT);
    expect(player.dashTime).toBeGreaterThan(0);
    expect(player.invuln).toBeGreaterThan(0);
  });
});
