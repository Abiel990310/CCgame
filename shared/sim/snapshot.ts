import { tileKey } from './grid';
import type { Belt, Machine, Player, World } from './types';
import { createWorld } from './world';
import { packExplored, unpackExplored } from './explore';

/**
 * The whole live state of an island, as plain data a guest can rebuild it from.
 *
 * Unlike a save this keeps everything that moves — mobs mid-stride, arrows in
 * flight, the RNG — because a guest has to continue from exactly the host's
 * world, not from something close to it. Only the starting ore is left out:
 * it grows from the seed, and a guest runs the same worldgen.
 */
export interface Snapshot {
  seed: number;
  /** Which generator grew the island, which is also how big it is. */
  worldgen: number;
  peaceful: boolean;
  tick: number;
  time: number;
  phase: World['phase'];
  phaseTime: number;
  nightIndex: number;
  /** Sent whole, small as it is, so ground reshaped after worldgen still matches. */
  terrain: number[];
  /** Run-length text, as a save stores it. */
  explored: string;
  /** In the host's iteration order: players are stepped in it. */
  players: Player[];
  mobs: World['mobs'];
  projectiles: World['projectiles'];
  pickups: World['pickups'];
  nodes: World['nodes'];
  buildings: World['buildings'];
  camp: World['camp'];
  ore: number[];
  oreLeft: number[];
  belts: Belt[];
  machines: Machine[];
  research: World['research'];
  waveBudget: number;
  wavePulse: number;
  nextId: number;
  rngState: number;
}

export function takeSnapshot(world: World): Snapshot {
  return {
    seed: world.seed,
    worldgen: world.worldgen,
    peaceful: world.peaceful,
    tick: world.tick,
    time: world.time,
    phase: world.phase,
    phaseTime: world.phaseTime,
    nightIndex: world.nightIndex,
    terrain: Array.from(world.terrain),
    explored: packExplored(world.explored),
    players: [...world.players.values()],
    mobs: world.mobs,
    projectiles: world.projectiles,
    pickups: world.pickups,
    nodes: world.nodes,
    buildings: world.buildings,
    camp: world.camp,
    ore: Array.from(world.ore),
    oreLeft: Array.from(world.oreLeft),
    belts: world.belts,
    machines: world.machines,
    research: world.research,
    waveBudget: world.waveBudget,
    wavePulse: world.wavePulse,
    nextId: world.nextId,
    rngState: world.rngState,
  };
}

/**
 * Build a world from a snapshot. The snapshot must already be a private copy
 * (it is, when it has come through `encode` and `decode`): its objects become
 * the world's own.
 */
export function restoreSnapshot(snap: Snapshot): World {
  const world = createWorld(snap.seed, snap.peaceful, snap.worldgen);
  world.tick = snap.tick;
  world.time = snap.time;
  world.phase = snap.phase;
  world.phaseTime = snap.phaseTime;
  world.nightIndex = snap.nightIndex;
  world.terrain = Uint8Array.from(snap.terrain);
  world.explored = unpackExplored(snap.explored ?? '', world.terrain.length);
  world.players = new Map(snap.players.map((p) => [p.id, p]));
  world.mobs = snap.mobs;
  world.projectiles = snap.projectiles;
  world.pickups = snap.pickups;
  world.nodes = snap.nodes;
  world.buildings = snap.buildings;
  world.camp = snap.camp;
  world.ore = Uint8Array.from(snap.ore);
  world.oreLeft = Uint16Array.from(snap.oreLeft);
  world.belts = snap.belts;
  world.machines = snap.machines;
  world.research = snap.research;
  world.waveBudget = snap.waveBudget;
  world.wavePulse = snap.wavePulse;
  world.nextId = snap.nextId;
  world.rngState = snap.rngState;
  world.grid = new Map();
  for (const belt of world.belts) world.grid.set(tileKey(belt.tx, belt.ty), belt);
  for (const machine of world.machines) world.grid.set(tileKey(machine.tx, machine.ty), machine);
  return world;
}

/**
 * JSON that round-trips every number the sim can hold. Plain JSON turns -0
 * into 0 and Infinity into null, and either is enough to send a guest's world
 * down a different branch from the host's a few thousand ticks later.
 */
export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== 'number') return v;
    if (Object.is(v, -0)) return '\u0000-0';
    if (!Number.isFinite(v)) return `\u0000${v}`;
    return v;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (typeof v !== 'string' || v.charCodeAt(0) !== 0) return v;
    return Number(v.slice(1));
  }) as T;
}

/**
 * A cheap fingerprint of the state that drifts first when two copies of a
 * world disagree. Host and guests compare it every so often; a mismatch sends
 * the guest a fresh snapshot rather than letting it wander off on its own.
 */
export function checksum(world: World): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    F64[0] = n;
    h = Math.imul(h ^ U32[0], 0x01000193);
    h = Math.imul(h ^ U32[1], 0x01000193);
  };

  mix(world.tick);
  mix(world.rngState);
  mix(world.nextId);
  mix(world.phaseTime);
  for (const p of world.players.values()) {
    mix(p.id);
    mix(p.pos.x);
    mix(p.pos.y);
    mix(p.hp);
    mix(p.xp);
    for (const slot of p.inventory) mix(slot ? slot.count : -1);
  }
  for (const m of world.mobs) {
    mix(m.id);
    mix(m.pos.x);
    mix(m.pos.y);
    mix(m.hp);
  }
  mix(world.projectiles.length);
  mix(world.pickups.length);
  for (const m of world.machines) {
    mix(m.id);
    mix(m.progress);
    for (const slot of m.output) mix(slot ? slot.count : -1);
  }
  for (const b of world.belts) {
    mix(b.items.length);
    for (const item of b.items) mix(item.offset);
  }
  for (const n of world.nodes) mix(n.charges);
  return h >>> 0;
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
