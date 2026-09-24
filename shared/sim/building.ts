import { BUILDINGS } from '../data/buildings';
import { CAMP, TILE } from './constants';
import { clamp, distance } from './math';
import { inBounds, tileKey } from './grid';
import { giveOrDrop, payAll, hasAll } from './inventory';
import { clearFelledNodes } from './nodes';
import { isWalkable, terrainAtIndex } from './terrain';
import type { Building, BuildingId, ItemStack, Player, Vec2, World } from './types';

export type PlacementError = 'range' | 'terrain' | 'overlap' | 'factory' | 'cost' | null;

/**
 * Camp pieces are circles in world units while factory pieces own whole tiles,
 * so the two build systems can only see each other through an overlap test.
 * The slack keeps a wide piece like the campfire from claiming the ring of
 * tiles its edge merely grazes.
 */
const TILE_SLACK = 4;

function overlapsTile(pos: Vec2, radius: number, tx: number, ty: number): boolean {
  const reach = radius - TILE_SLACK;
  if (reach <= 0) return false;

  const dx = pos.x - clamp(pos.x, tx * TILE, (tx + 1) * TILE);
  const dy = pos.y - clamp(pos.y, ty * TILE, (ty + 1) * TILE);
  return dx * dx + dy * dy < reach * reach;
}

/** The camp piece standing on a factory tile, so belts cannot run through it. */
export function buildingOnTile(world: World, tx: number, ty: number): Building | null {
  for (const b of world.buildings) {
    if (overlapsTile(b.pos, BUILDINGS[b.type].radius, tx, ty)) return b;
  }
  return null;
}

/** Whether a camp piece of this size would come down on top of the factory. */
function coversFactory(world: World, pos: Vec2, radius: number): boolean {
  const minTx = Math.floor((pos.x - radius) / TILE);
  const maxTx = Math.floor((pos.x + radius) / TILE);
  const minTy = Math.floor((pos.y - radius) / TILE);
  const maxTy = Math.floor((pos.y + radius) / TILE);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!inBounds(tx, ty)) continue;
      if (!world.grid.has(tileKey(tx, ty))) continue;
      if (overlapsTile(pos, radius, tx, ty)) return true;
    }
  }
  return false;
}

/** Why a placement would fail, or null when it is legal. Drives the ghost preview. */
export function placementError(
  world: World,
  player: Player,
  type: BuildingId,
  pos: Vec2,
): PlacementError {
  const def = BUILDINGS[type];

  if (distance(pos, world.camp) > CAMP.buildRadius) return 'range';

  const t = terrainAtIndex(world.terrain, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE));
  if (!isWalkable(t)) return 'terrain';

  for (const b of world.buildings) {
    if (distance(b.pos, pos) < def.radius + BUILDINGS[b.type].radius) return 'overlap';
  }
  for (const node of world.nodes) {
    if (node.charges > 0 && distance(node.pos, pos) < def.radius + 14) return 'overlap';
  }
  if (coversFactory(world, pos, def.radius)) return 'factory';

  if (!hasAll(player, def.cost)) return 'cost';
  return null;
}

export function placeBuilding(
  world: World,
  player: Player,
  type: BuildingId,
  pos: Vec2,
): boolean {
  if (placementError(world, player, type, pos) !== null) return false;
  if (!payAll(player, BUILDINGS[type].cost)) return false;

  world.buildings.push({
    id: world.nextId++,
    type,
    // Walls take chip damage from mobs; level doubles as their hit points.
    level: type === 'wall' ? CAMP.wallHp : 1,
    pos: { ...pos },
  });
  world.events.push({ kind: 'built', pos: { ...pos }, type });
  clearFelledNodes(world);
  return true;
}

/** The camp piece under a point, nearest first — what a click is pointing at. */
export function buildingAt(world: World, pos: Vec2): Building | null {
  let best: Building | null = null;
  let bestDist = Infinity;

  for (const b of world.buildings) {
    const d = distance(b.pos, pos);
    // A little slack, so clicking the edge of a wall still counts as clicking it.
    if (d > BUILDINGS[b.type].radius + 4 || d >= bestDist) continue;
    best = b;
    bestDist = d;
  }
  return best;
}

export type RemovalResult = 'removed' | 'campfire' | 'none';

/**
 * What taking a piece down gives back. A wall returns only the share of its
 * cost it still has in hit points, rounded down: otherwise pulling a chipped
 * wall and putting it back would be a free repair.
 */
export function removalRefund(building: Building): ItemStack[] {
  const cost = BUILDINGS[building.type].cost;
  if (building.type !== 'wall') return cost.map((entry) => ({ ...entry }));

  const share = clamp(building.level / CAMP.wallHp, 0, 1);
  return cost
    .map((entry) => ({ id: entry.id, count: Math.floor(entry.count * share) }))
    .filter((entry) => entry.count > 0);
}

/** Take a camp piece back down, refunding what it has left of its cost. */
export function removeBuildingAt(world: World, player: Player, pos: Vec2): RemovalResult {
  const target = buildingAt(world, pos);
  if (!target) return 'none';
  // The campfire is what the camp is; mobs path to it and the island is built
  // around it, so it is the one piece that does not come back down.
  if (target.type === 'campfire') return 'campfire';

  world.buildings.splice(world.buildings.indexOf(target), 1);
  world.events.push({ kind: 'removed', pos: { ...target.pos } });
  for (const entry of removalRefund(target)) {
    giveOrDrop(world, player, entry.id, entry.count);
  }
  return 'removed';
}
