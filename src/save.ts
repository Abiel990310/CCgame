import { createWorld } from '@shared/sim/world';
import { tileKey } from '@shared/sim/grid';
import type { Player, World } from '@shared/sim/types';

const KEY = 'ccgame.save.v1';
const VERSION = 2;

interface SaveFile {
  version: number;
  savedAt: number;
  seed: number;
  tick: number;
  time: number;
  phase: World['phase'];
  phaseTime: number;
  nightIndex: number;
  nextId: number;
  rngState: number;
  players: Player[];
  nodes: World['nodes'];
  buildings: World['buildings'];
  belts: World['belts'];
  machines: World['machines'];
  peaceful: boolean;
}

/**
 * Phase 2 persistence: the whole island in localStorage. Deliberately stores
 * only durable state — mobs, projectiles and loose pickups are transient and
 * are regenerated on load, which also stops a save from resurrecting a night.
 */
export function saveWorld(world: World): void {
  const file: SaveFile = {
    version: VERSION,
    savedAt: Date.now(),
    seed: world.seed,
    tick: world.tick,
    time: world.time,
    phase: world.phase,
    phaseTime: world.phaseTime,
    nightIndex: world.nightIndex,
    nextId: world.nextId,
    rngState: world.rngState,
    players: [...world.players.values()],
    nodes: world.nodes,
    buildings: world.buildings,
    belts: world.belts,
    machines: world.machines,
    peaceful: world.peaceful,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    // A full or blocked storage quota must never take the game down.
  }
}

export function loadWorld(): World | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const file = JSON.parse(raw) as SaveFile;
    if (file.version !== VERSION) return null;

    // Terrain is regenerated from the seed rather than stored — it is large,
    // and it is a pure function of the seed anyway.
    const world = createWorld(file.seed, file.peaceful ?? false);
    world.tick = file.tick;
    world.time = file.time;
    // Always wake up in daylight, however the session ended.
    world.phase = 'day';
    world.phaseTime = file.phase === 'day' ? file.phaseTime : 60;
    world.nightIndex = file.nightIndex;
    world.nextId = file.nextId;
    world.rngState = file.rngState;
    world.nodes = file.nodes;
    world.buildings = file.buildings;
    world.belts = file.belts ?? [];
    world.machines = file.machines ?? [];
    // The tile index is derived state, so rebuild it rather than storing it.
    rebuildGrid(world);
    world.players = new Map(file.players.map((p) => [p.id, p]));
    for (const player of world.players.values()) {
      player.downed = 0;
      player.hp = Math.max(player.hp, player.maxHp * 0.5);
      player.gatherNodeId = null;
      player.gatherProgress = 0;
    }
    return world;
  } catch {
    return null;
  }
}

function rebuildGrid(world: World): void {
  world.grid.clear();
  for (const belt of world.belts) world.grid.set(tileKey(belt.tx, belt.ty), belt.id);
  for (const machine of world.machines) world.grid.set(tileKey(machine.tx, machine.ty), machine.id);
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — a failed clear just leaves the old save in place.
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
