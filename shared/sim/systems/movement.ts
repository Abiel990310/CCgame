import { BUILDINGS } from '../../data/buildings';
import { DASH, MAP_SIZE, PLAYER, TILE } from '../constants';
import { clamp, damp, length, normalize } from '../math';
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

export function stepPlayerMovement(
  world: World,
  player: Player,
  input: PlayerInput,
  dt: number,
): void {
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.hitFlash = Math.max(0, player.hitFlash - dt);

  const dir = normalize(input.move);
  if (length(dir) > 0) player.facing = dir;

  if (player.dashTime > 0) {
    player.dashTime = Math.max(0, player.dashTime - dt);
    player.vel.x = player.facing.x * DASH.speed;
    player.vel.y = player.facing.y * DASH.speed;
  } else {
    if (input.dash && player.dashCd <= 0) {
      player.dashTime = DASH.duration;
      player.dashCd = DASH.cooldown;
      player.invuln = Math.max(player.invuln, DASH.duration + 0.1);
    }
    const speed = PLAYER.speed * player.stats.moveSpeed;
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
}
