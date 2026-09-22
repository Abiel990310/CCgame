import { createWorld } from '@shared/sim/world';
import { MACHINES } from '@shared/data/machines';
import { tileKey } from '@shared/sim/grid';
import { clearBuriedNodes } from '@shared/sim/nodes';
import { INVENTORY_SLOTS } from '@shared/sim/inventory';
import { asStack, normalizeSlots } from '@shared/sim/slots';
import type { Machine, Player, World } from '@shared/sim/types';
import { slotKey } from './saves';

const VERSION = 3;

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
 * Phase 2 persistence: the whole island in localStorage, one entry per save
 * slot. Deliberately stores only durable state — mobs, projectiles and loose
 * pickups are transient and are regenerated on load, which also stops a save
 * from resurrecting a night.
 */
export function saveWorld(world: World, slot: string): boolean {
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
    localStorage.setItem(slotKey(slot), JSON.stringify(file));
    return true;
  } catch {
    // A full or blocked storage quota must never take the game down.
    return false;
  }
}

export function loadWorld(slot: string): World | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(slotKey(slot));
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const file = JSON.parse(raw) as SaveFile;
    // Older saves are read, not thrown away: every field the factory added is
    // optional below, so a version 1 island loads with an empty factory rather
    // than dropping someone's world on the floor. A save from a future version
    // is the only one we refuse, since we cannot know what it means.
    if (!(file.version >= 1 && file.version <= VERSION)) return null;

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
    // A machine whose type no longer exists is dropped rather than taken as a
    // reason to refuse the whole island.
    world.machines = (file.machines ?? []).filter((m) => m.type in MACHINES).map(loadMachine);
    // The tile index is derived state, so rebuild it rather than storing it.
    rebuildGrid(world);
    // Older islands were built before scenery blocked placement, so they can
    // hold a tree standing inside a belt. The grid has to exist to spot them.
    clearBuriedNodes(world);
    world.players = new Map(file.players.map((p) => [p.id, p]));
    for (const player of world.players.values()) {
      player.downed = 0;
      player.hp = Math.max(player.hp, player.maxHp * 0.5);
      player.gatherNodeId = null;
      player.gatherProgress = 0;
      // Version 3 turned the bag into a fixed grid. Saves before it stored a
      // compacted list, which reads back as the first N slots of the grid.
      player.inventory = normalizeSlots(player.inventory, INVENTORY_SLOTS);
      player.cursor = asStack(player.cursor);
    }
    return world;
  } catch {
    return null;
  }
}

/** Machine storage is a fixed grid too, sized by the machine's own definition. */
function loadMachine(machine: Machine): Machine {
  const def = MACHINES[machine.type];
  return {
    ...machine,
    input: normalizeSlots(machine.input, def.inputSlots, def.slotSize),
    output: normalizeSlots(machine.output, def.outputSlots, def.slotSize),
  };
}

function rebuildGrid(world: World): void {
  world.grid.clear();
  for (const belt of world.belts) world.grid.set(tileKey(belt.tx, belt.ty), belt);
  for (const machine of world.machines) world.grid.set(tileKey(machine.tx, machine.ty), machine);
}
