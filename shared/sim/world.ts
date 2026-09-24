import { RESOURCES } from '../data/items';
import { CYCLE, MAP_CENTER, MAP_TILES, PLAYER, TILE, setMapTiles } from './constants';
import { makeRng } from './rng';
import { isShore, isWalkable, terrainAtIndex, generateTerrain } from './terrain';
import { generateOre, oreAt } from './ore';
import type { Player, ResourceKind, Vec2, World } from './types';
import { xpForLevel } from './progression';
import { newResearch } from './research';
import { newInventory } from './inventory';
import { EXPLORE_RADIUS, reveal } from './explore';

export function createPlayer(id: number, name: string, pos: Vec2): Player {
  return {
    id,
    name,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    pendingUpgrades: 0,
    offers: [],
    goal: 0,
    inventory: newInventory(),
    cursor: null,
    weapons: [{ id: 'sling', level: 1, cooldown: 0 }],
    stats: {
      damage: 1,
      fireRate: 1,
      moveSpeed: 1,
      gatherSpeed: 1,
      pickupRadius: 1,
      maxHp: PLAYER.maxHp,
      multishot: 0,
      regen: 0,
      xpGain: 1,
    },
    dashCd: 0,
    dashTime: 0,
    invuln: 0,
    downed: 0,
    gatherNodeId: null,
    gatherProgress: 0,
    hitFlash: 0,
  };
}

/**
 * Which generation of worldgen built an island. Terrain, ore and scenery are
 * never saved, only regenerated from the seed, so a save's deltas only mean
 * something against the generator that produced them. Raise this whenever
 * `createWorld` would build a different island from the same seed — the
 * worldgen fingerprint test fails until you do — and the loader will then
 * stop applying an older island's scenery and ore deltas to ground they no
 * longer describe.
 */
export const WORLDGEN = 2;

/**
 * How many tiles across each generation's island is. Generation 1 is the
 * first small island; an island keeps its generation, so it keeps its size.
 */
export const WORLDGEN_TILES: Record<number, number> = { 1: 96, 2: 256 };

export function createWorld(seed = 12345, peaceful = false, worldgen = WORLDGEN): World {
  setMapTiles(WORLDGEN_TILES[worldgen] ?? WORLDGEN_TILES[WORLDGEN]);
  const terrain = generateTerrain(seed, worldgen);
  const camp: Vec2 = { x: MAP_CENTER, y: MAP_CENTER };
  const ore = generateOre(terrain, seed, worldgen);

  const world: World = {
    tick: 0,
    time: 0,
    seed,
    worldgen,
    terrain,
    explored: new Uint8Array(terrain.length),
    phase: 'day',
    // Start past the dawn blend so a new island opens in clear daylight.
    phaseTime: CYCLE.daySeconds - CYCLE.twilightSeconds,
    nightIndex: 0,
    players: new Map(),
    mobs: [],
    projectiles: [],
    pickups: [],
    nodes: [],
    buildings: [],
    camp,
    ore: ore.kind,
    oreLeft: ore.left,
    // The baseline the save diffs against, so only mined tiles are written out.
    oreMax: Uint16Array.from(ore.left),
    belts: [],
    machines: [],
    grid: new Map(),
    research: newResearch(),
    peaceful,
    waveBudget: 0,
    wavePulse: 0,
    nextId: 1,
    rngState: seed ^ 0x9e3779b9,
    events: [],
  };

  world.buildings.push({ id: world.nextId++, type: 'campfire', pos: { ...camp }, level: 1 });
  populateNodes(world);
  // The home clearing is known from the start, so the map is never blank.
  reveal(world, camp.x, camp.y, EXPLORE_RADIUS + 4);
  return world;
}

/**
 * Scatter resource nodes by terrain type. Runs once at world creation; nodes
 * regrow in place rather than respawning elsewhere, so the island stays legible.
 */
function populateNodes(world: World): void {
  const rng = makeRng(world.seed ^ 0x51ed2701);
  const { terrain } = world;

  const place = (kind: ResourceKind, tx: number, ty: number): void => {
    const def = RESOURCES[kind];
    const pos = {
      x: (tx + 0.2 + rng() * 0.6) * TILE,
      y: (ty + 0.2 + rng() * 0.6) * TILE,
    };
    // Keep the camp clearing free of clutter so building has room.
    if (Math.hypot(pos.x - world.camp.x, pos.y - world.camp.y) < 120) return;
    // Never bury an ore tile under scenery — miners need the tile itself.
    if (oreAt(world.ore, tx, ty) !== null) return;
    world.nodes.push({
      id: world.nextId++,
      kind,
      pos,
      seed: Math.floor(rng() * 65536),
      charges: def.charges,
      maxCharges: def.charges,
      regrow: 0,
    });
  };

  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const t = terrainAtIndex(terrain, tx, ty);
      if (!isWalkable(t)) continue;
      const roll = rng();

      if (isShore(terrain, tx, ty) && roll < 0.1) {
        place('fish', tx, ty);
        continue;
      }
      if (t === 'forest' && roll < 0.42) place('tree', tx, ty);
      else if (t === 'grass' && roll < 0.07) place('tree', tx, ty);
      else if (t === 'grass' && roll < 0.13) place('bush', tx, ty);
      else if (t === 'rock' && roll < 0.3) place('rock', tx, ty);
      else if (t === 'forest' && roll < 0.5) place('bush', tx, ty);
    }
  }
}

/** A walkable spawn point near the camp, used when a player joins or revives. */
export function spawnPoint(world: World): Vec2 {
  const rng = makeRng(world.tick + world.seed);
  for (let i = 0; i < 64; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 30 + rng() * 90;
    const pos = {
      x: world.camp.x + Math.cos(angle) * radius,
      y: world.camp.y + Math.sin(angle) * radius,
    };
    const t = terrainAtIndex(world.terrain, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE));
    if (isWalkable(t)) return pos;
  }
  return { ...world.camp };
}

export function addPlayer(world: World, name: string): Player {
  const player = createPlayer(world.nextId++, name, spawnPoint(world));
  world.players.set(player.id, player);
  return player;
}
