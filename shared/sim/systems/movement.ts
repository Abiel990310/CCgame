import { BUILDINGS } from '../../data/buildings';
import { MACHINES } from '../../data/machines';
import { DASH, MAP_SIZE, PLAYER, TILE, VAULT } from '../constants';
import { clamp, damp, length, normalize } from '../math';
import { tileKey } from '../grid';
import { perk } from '../perks';
import { isWalkable, terrainAtIndex } from '../terrain';
import type { Player, PlayerInput, Vec2, World } from '../types';

/** Slide along blocked tiles instead of sticking, tested per axis. */
function moveWithCollision(world: World, pos: Vec2, delta: Vec2, radius: number): void {
  const tryAxis = (axis: 'x' | 'y', amount: number): void => {
    if (amount === 0) return;
    const next = { ...pos, [axis]: pos[axis] + amount };
    const probe = axis === 'x' ? { x: next.x + Math.sign(amount) * radius, y: next.y } : { x: next.x, y: next.y + Math.sign(amount) * radius };
    const t = terrainAtIndex(world.terrain, Math.floor(probe.x / TILE), Math.floor(probe.y / TILE));
    if (isWalkable(t)) pos[axis] = next[axis];
  };

  tryAxis('x', delta.x);
  tryAxis('y', delta.y);

  pos.x = clamp(pos.x, radius, MAP_SIZE - radius);
  pos.y = clamp(pos.y, radius, MAP_SIZE - radius);
}

/** Walls are solid; everything else in camp is decorative and walk-through. */
function resolveBuildings(world: World, pos: Vec2, radius: number): void {
  for (const b of world.buildings) {
    if (b.type !== 'wall') continue;
    const def = BUILDINGS[b.type];
    const dx = pos.x - b.pos.x;
    const dy = pos.y - b.pos.y;
    const min = def.radius + radius;
    const dist = Math.hypot(dx, dy);
    if (dist >= min || dist < 1e-4) continue;
    pos.x = b.pos.x + (dx / dist) * min;
    pos.y = b.pos.y + (dy / dist) * min;
  }
}

/**
 * Half the side of a machine's footprint. The whole tile rather than the body
 * drawn, so a row of machines is one flat face: with a gap between boxes a
 * body walking along the row settles into the notch and sticks.
 */
const MACHINE_HALF = TILE / 2;

/**
 * Push a body out of any solid machine it overlaps. Machines sit on the grid,
 * so only the tiles around the body can hold one. Resolving against the
 * nearest point of the box, rather than blocking the tile, lets a body slide
 * round a corner instead of catching on it.
 *
 * One tick of movement, dash included, is shorter than the depth of a box
 * plus a body's radius, so a body can never cross a machine's centre in one
 * step and be pushed out of the far side.
 */
export function resolveMachines(world: World, pos: Vec2, radius: number): void {
  const cx = Math.floor(pos.x / TILE);
  const cy = Math.floor(pos.y / TILE);
  for (let ty = cy - 1; ty <= cy + 1; ty++) {
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      const found = world.grid.get(tileKey(tx, ty));
      if (!found || !('type' in found) || !MACHINES[found.type].solid) continue;
      const mx = tx * TILE + TILE / 2;
      const my = ty * TILE + TILE / 2;
      const nx = clamp(pos.x, mx - MACHINE_HALF, mx + MACHINE_HALF);
      const ny = clamp(pos.y, my - MACHINE_HALF, my + MACHINE_HALF);
      const dx = pos.x - nx;
      const dy = pos.y - ny;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radius * radius) continue;
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        pos.x = nx + (dx / dist) * radius;
        pos.y = ny + (dy / dist) * radius;
        continue;
      }
      // The centre is inside the box, which only happens when a machine is
      // placed on top of someone: leave by the nearest face.
      const ox = pos.x - mx;
      const oy = pos.y - my;
      if (MACHINE_HALF - Math.abs(ox) < MACHINE_HALF - Math.abs(oy)) {
        pos.x = mx + (ox < 0 ? -1 : 1) * (MACHINE_HALF + radius);
      } else {
        pos.y = my + (oy < 0 ? -1 : 1) * (MACHINE_HALF + radius);
      }
    }
  }
}

/**
 * Whether a body could stand at `pos` heading `dir`: the same tests the
 * collision above makes, the ground under it and ahead of it, and no machine
 * or wall overlapping it.
 */
function clearAt(world: World, pos: Vec2, dir: Vec2, radius: number): boolean {
  if (pos.x < radius || pos.y < radius || pos.x > MAP_SIZE - radius || pos.y > MAP_SIZE - radius) return false;
  const ground = (x: number, y: number): boolean => isWalkable(terrainAtIndex(world.terrain, Math.floor(x / TILE), Math.floor(y / TILE)));
  if (!ground(pos.x, pos.y) || !ground(pos.x + dir.x * radius, pos.y + dir.y * radius)) return false;
  const cx = Math.floor(pos.x / TILE);
  const cy = Math.floor(pos.y / TILE);
  for (let ty = cy - 1; ty <= cy + 1; ty++) {
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      const found = world.grid.get(tileKey(tx, ty));
      if (!found || !('type' in found) || !MACHINES[found.type].solid) continue;
      const mx = tx * TILE + TILE / 2;
      const my = ty * TILE + TILE / 2;
      const dx = pos.x - clamp(pos.x, mx - MACHINE_HALF, mx + MACHINE_HALF);
      const dy = pos.y - clamp(pos.y, my - MACHINE_HALF, my + MACHINE_HALF);
      if (dx * dx + dy * dy < radius * radius) return false;
    }
  }
  for (const b of world.buildings) {
    if (b.type !== 'wall') continue;
    if (Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y) < BUILDINGS[b.type].radius + radius) return false;
  }
  return true;
}

/**
 * Where a dash from `from` would land if it leapt what is in its way, or null
 * when its path is clear (a plain dash) or nothing on the far side is in reach.
 */
export function findVault(world: World, from: Vec2, dir: Vec2): Vec2 | null {
  const STEP = 4;
  const dash = DASH.speed * DASH.duration;
  const at = (s: number): Vec2 => ({ x: from.x + dir.x * s, y: from.y + dir.y * s });
  let blocked = -1;
  for (let s = STEP; s <= dash; s += STEP) {
    if (!clearAt(world, at(s), dir, PLAYER.radius)) {
      blocked = s;
      break;
    }
  }
  if (blocked < 0) return null;
  for (let s = blocked; s <= VAULT.reach; s += STEP) {
    const p = at(s);
    if (terrainAtIndex(world.terrain, Math.floor(p.x / TILE), Math.floor(p.y / TILE)) === 'deep') return null;
    if (clearAt(world, p, dir, PLAYER.radius)) return p;
  }
  return null;
}

export function stepPlayerMovement(
  world: World,
  player: Player,
  input: PlayerInput,
  dt: number,
): void {
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.hitFlash = Math.max(0, player.hitFlash - dt);

  if (player.vault) {
    // In the air nothing collides: the landing was checked before leaving.
    const v = player.vault;
    v.t = Math.min(VAULT.duration, v.t + dt);
    const k = v.t / VAULT.duration;
    player.pos.x = v.from.x + (v.to.x - v.from.x) * k;
    player.pos.y = v.from.y + (v.to.y - v.from.y) * k;
    player.vel.x = (v.to.x - v.from.x) / VAULT.duration;
    player.vel.y = (v.to.y - v.from.y) / VAULT.duration;
    player.dashTime = VAULT.duration - v.t;
    if (v.t >= VAULT.duration) {
      player.vault = undefined;
      player.dashTime = 0;
      player.vel.x *= 0.3;
      player.vel.y *= 0.3;
    }
    return;
  }

  const dir = normalize(input.move);
  if (length(dir) > 0) player.facing = dir;

  if (player.dashTime > 0) {
    player.dashTime = Math.max(0, player.dashTime - dt);
    player.vel.x = player.facing.x * DASH.speed;
    player.vel.y = player.facing.y * DASH.speed;
  } else {
    if (input.dash && player.dashCd <= 0) {
      player.dashCd = DASH.cooldown * Math.pow(0.85, perk(player, 'recovery'));
      const landing = findVault(world, player.pos, player.facing);
      if (landing) {
        player.vault = { from: { ...player.pos }, to: landing, t: 0 };
        player.dashTime = VAULT.duration;
        player.invuln = Math.max(player.invuln, VAULT.duration + 0.1);
        world.events.push({ kind: 'vault', playerId: player.id, from: { ...player.pos }, to: { ...landing } });
        return;
      }
      player.dashTime = DASH.duration;
      player.invuln = Math.max(player.invuln, DASH.duration + 0.1);
    }
    const daytime = world.phase === 'day' ? 1 + 0.12 * perk(player, 'pathfinder') : 1;
    const speed = PLAYER.speed * player.stats.moveSpeed * daytime;
    const target = { x: dir.x * speed, y: dir.y * speed };
    player.vel.x = damp(player.vel.x, target.x, PLAYER.accel, dt);
    player.vel.y = damp(player.vel.y, target.y, PLAYER.accel, dt);
  }

  moveWithCollision(
    world,
    player.pos,
    { x: player.vel.x * dt, y: player.vel.y * dt },
    PLAYER.radius,
  );
  resolveBuildings(world, player.pos, PLAYER.radius);
  resolveMachines(world, player.pos, PLAYER.radius);
}
