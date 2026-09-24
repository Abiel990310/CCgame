import { describe, expect, it } from 'vitest';
import { WORLDGEN, createWorld } from '../world';
import type { World } from '../types';

/** FNV-1a over everything worldgen decides, so any change to it shows up. */
function fingerprint(world: World): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (n >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const t of world.terrain) mix(t);
  for (const o of world.ore) mix(o);
  for (const o of world.oreMax) mix(o);
  mix(world.nodes.length);
  for (const n of world.nodes) {
    mix(n.id);
    for (let i = 0; i < n.kind.length; i++) mix(n.kind.charCodeAt(i));
    mix(Math.round(n.pos.x * 16));
    mix(Math.round(n.pos.y * 16));
    mix(n.seed);
    mix(n.charges);
  }
  for (const b of world.buildings) mix(Math.round(b.pos.x) + Math.round(b.pos.y) * 65536);
  mix(world.nextId);
  return h.toString(16);
}

/**
 * What each seed generated at the current `WORLDGEN`. Saves store only what
 * play changed on top of this, so if the island a seed grows moves, every
 * existing island moves with it. When this fails on purpose, raise `WORLDGEN`
 * in `shared/sim/world.ts` and then update these.
 */
const EXPECTED: { worldgen: number; islands: Record<number, string> } = {
  worldgen: 1,
  islands: { 1: '27970376', 4242: 'f113de12', 65535: 'fff3a353' },
};

describe('worldgen', () => {
  it('builds the same island from a seed until WORLDGEN is raised', () => {
    const actual: Record<number, string> = {};
    for (const seed of Object.keys(EXPECTED.islands).map(Number)) {
      actual[seed] = fingerprint(createWorld(seed));
    }
    expect({ worldgen: WORLDGEN, islands: actual }).toEqual(EXPECTED);
  });

  it('does not depend on whether the island is peaceful', () => {
    expect(fingerprint(createWorld(4242, true))).toBe(fingerprint(createWorld(4242, false)));
  });
});
