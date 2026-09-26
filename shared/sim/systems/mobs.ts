import { BEACON_WARD_PACE } from '../../data/beacon';
import { BUILDINGS } from '../../data/buildings';
import { RESOURCES } from '../../data/items';
import { MOBS, MOB_ORDER } from '../../data/mobs';
import { CAMP, MAP_SIZE, PLAYER, TILE, WAVES } from '../constants';
import { beaconWards } from '../beacon';
import { damp, distance, normalize } from '../math';
import { nextFloat } from '../progression';
import { isWalkable, terrainAtIndex } from '../terrain';
import type { Mob, MobTypeId, Vec2, World } from '../types';
import { perk } from '../perks';
import { damageMob, damagePlayer, tryParry } from './combat';
import { resolveMachines } from './movement';

/** Mobs head for the nearest standing player, or the camp when nobody is up. */
/** How far from its post a keeper will chase a player before turning back. */
const POST_LEASH = 340;

function findTarget(world: World, mob: Mob): { pos: Vec2; player: boolean } {
  let best: Vec2 = mob.post ?? world.camp;
  let bestDist = Infinity;
  for (const player of world.players.values()) {
    if (player.downed > 0) continue;
    if (mob.post && distance(player.pos, mob.post) > POST_LEASH) continue;
    const d = distance(player.pos, mob.pos);
    if (d < bestDist) {
      bestDist = d;
      best = player.pos;
    }
  }
  return { pos: best, player: bestDist < Infinity };
}

/** How close a player comes before a landmark's keepers wake. */
const WAKE_RANGE = TILE * 7;

/**
 * Wakes the keepers of any unsearched landmark a player has walked up to.
 * They spawn in a ring round it and hold that ground until killed.
 */
export function stepLandmarkGuards(world: World): void {
  // Twice a second is plenty for a walk-up, and spares a scan of every node each tick.
  if (world.peaceful || world.tick % 15 !== 0) return;
  for (const node of world.nodes) {
    if (node.woken || node.charges <= 0) continue;
    const guards = RESOURCES[node.kind].landmark?.guards;
    if (!guards) continue;
    let near = false;
    for (const player of world.players.values()) {
      if (player.downed === 0 && distance(player.pos, node.pos) < WAKE_RANGE) near = true;
    }
    if (!near) continue;
    node.woken = true;
    const total = guards.reduce((n, g) => n + g.count, 0);
    let k = 0;
    for (const group of guards) {
      for (let i = 0; i < group.count; i++, k++) {
        const angle = (k / total) * Math.PI * 2 + nextFloat(world) * 0.4;
        const at = { x: node.pos.x + Math.cos(angle) * 60, y: node.pos.y + Math.sin(angle) * 40 };
        const mob = spawnMob(world, group.type, at);
        mob.post = { ...at };
      }
    }
    world.events.push({ kind: 'guardsWoke', pos: { ...node.pos }, landmark: node.kind });
  }
}

/**
 * Marks a mob as covered when a living shield bearer other than itself stands
 * close enough, keeping the strongest cover if two overlap. Deleted rather than
 * left undefined when nothing covers it, so a snapshot never carries the key.
 */
function shelter(mob: Mob, bearers: Mob[]): void {
  let take = 1;
  for (const b of bearers) {
    const s = MOBS[b.type].shields!;
    if (b !== mob && s.take < take && distance(b.pos, mob.pos) < s.radius) take = s.take;
  }
  if (take < 1) mob.shield = take;
  else if (mob.shield !== undefined) delete mob.shield;
}

/** How much frost holds a mob back, as a share of its speed. */
const CHILLED = 0.45;

export function stepMobs(world: World, dt: number): void {
  const wards = world.mobs.length > 0 ? beaconWards(world) : [];
  const bearers = world.mobs.filter((m) => m.hp > 0 && MOBS[m.type].shields);
  for (let i = world.mobs.length - 1; i >= 0; i--) {
    const mob = world.mobs[i];
    if (mob.hp <= 0) {
      world.mobs.splice(i, 1);
      continue;
    }

    const def = MOBS[mob.type];
    shelter(mob, bearers);
    mob.attackCd = Math.max(0, mob.attackCd - dt);
    mob.hitFlash = Math.max(0, mob.hitFlash - dt);

    const target = findTarget(world, mob);
    const dir = normalize({ x: target.pos.x - mob.pos.x, y: target.pos.y - mob.pos.y });
    let speed = def.speed;
    if (mob.chill && mob.chill > 0) {
      mob.chill = Math.max(0, mob.chill - dt);
      speed *= CHILLED;
    }
    if (wards.some((w) => distance(w.pos, mob.pos) < w.radius)) speed *= BEACON_WARD_PACE;
    let pace = 1;
    if (def.spit && target.player) {
      pace = spit(world, mob, target.pos, dt);
      mob.look = Math.atan2(target.pos.y - mob.pos.y, target.pos.x - mob.pos.x);
    } else mob.look = undefined;
    if (def.summons) summon(world, mob, dt);

    mob.vel.x = damp(mob.vel.x, dir.x * speed * pace, 8, dt);
    mob.vel.y = damp(mob.vel.y, dir.y * speed * pace, 8, dt);

    stepMobPosition(world, mob, def.radius, dt);
    separate(world, mob, def.radius);
    // After separation, so a crowd pressing on a furnace cannot shove one of
    // its own members through it.
    resolveMachines(world, mob.pos, def.radius);
    attackNearby(world, mob, def.radius, def.damage);
  }
}

/**
 * A spitter holds at the edge of its range and fires from there, backing off
 * when a player walks in on it. Returns how hard it should keep closing in:
 * negative to retreat.
 */
function spit(world: World, mob: Mob, at: Vec2, dt: number): number {
  const shot = MOBS[mob.type].spit!;
  mob.spitCd = Math.max(0, (mob.spitCd ?? shot.interval * nextFloat(world)) - dt);
  const d = distance(mob.pos, at);
  if (d <= shot.range && mob.spitCd === 0) {
    mob.spitCd = shot.interval;
    const dir = normalize({ x: at.x - mob.pos.x, y: at.y - mob.pos.y });
    world.projectiles.push({
      id: world.nextId++,
      pos: { ...mob.pos },
      vel: { x: dir.x * shot.speed, y: dir.y * shot.speed },
      damage: shot.damage,
      life: shot.range / shot.speed + 0.4,
      ownerId: mob.id,
      weapon: 'spit',
      pierce: 0,
    });
    world.events.push({ kind: 'spit', pos: { ...mob.pos } });
  }
  if (d > shot.range * 0.85) return 1;
  if (d < shot.range * 0.55) return -0.6;
  return 0;
}

/** Most a caller can have on the field at once, so an unkilled queen cannot flood a night. */
const SUMMON_CAP = 60;

function summon(world: World, mob: Mob, dt: number): void {
  const call = MOBS[mob.type].summons!;
  mob.summonCd = Math.max(0, (mob.summonCd ?? call.interval * 0.5) - dt);
  if (mob.summonCd > 0) return;
  mob.summonCd = call.interval;
  if (world.mobs.length >= SUMMON_CAP) return;
  const radius = MOBS[mob.type].radius;
  for (let i = 0; i < call.count; i++) {
    const angle = (i / call.count) * Math.PI * 2 + nextFloat(world);
    const child = spawnMob(world, call.into, {
      x: mob.pos.x + Math.cos(angle) * radius,
      y: mob.pos.y + Math.sin(angle) * radius,
    });
    child.vel = { x: Math.cos(angle) * 140, y: Math.sin(angle) * 140 };
    child.brood = true;
  }
  world.events.push({ kind: 'summon', pos: { ...mob.pos } });
}

function stepMobPosition(world: World, mob: Mob, radius: number, dt: number): void {
  const tryAxis = (axis: 'x' | 'y', amount: number): void => {
    if (amount === 0) return;
    const value = mob.pos[axis] + amount;
    const probe: Vec2 =
      axis === 'x'
        ? { x: value + Math.sign(amount) * radius, y: mob.pos.y }
        : { x: mob.pos.x, y: value + Math.sign(amount) * radius };
    const t = terrainAtIndex(world.terrain, Math.floor(probe.x / TILE), Math.floor(probe.y / TILE));
    if (isWalkable(t)) mob.pos[axis] = value;
    else mob.vel[axis] = 0;
  };

  tryAxis('x', mob.vel.x * dt);
  tryAxis('y', mob.vel.y * dt);

  mob.pos.x = Math.max(radius, Math.min(MAP_SIZE - radius, mob.pos.x));
  mob.pos.y = Math.max(radius, Math.min(MAP_SIZE - radius, mob.pos.y));
}

/** Gentle push-apart so a wave reads as a crowd, not a single stacked blob. */
function separate(world: World, mob: Mob, radius: number): void {
  for (const other of world.mobs) {
    if (other === mob) continue;
    const dx = mob.pos.x - other.pos.x;
    const dy = mob.pos.y - other.pos.y;
    const min = radius + MOBS[other.type].radius;
    const distSq = dx * dx + dy * dy;
    if (distSq >= min * min || distSq < 1e-6) continue;
    const dist = Math.sqrt(distSq);
    const push = (min - dist) * 0.5;
    mob.pos.x += (dx / dist) * push;
    mob.pos.y += (dy / dist) * push;
  }
}

function attackNearby(world: World, mob: Mob, radius: number, damage: number): void {
  if (mob.attackCd > 0) return;

  for (const player of world.players.values()) {
    if (player.downed > 0) continue;
    if (distance(player.pos, mob.pos) > radius + PLAYER.radius) continue;
    if (tryParry(world, player, mob.pos, mob)) return;
    damagePlayer(world, player, damage);
    mob.attackCd = 1;
    const thorns = perk(player, 'bramble');
    if (thorns > 0) damageMob(world, mob, 8 * thorns, player.id);
    return;
  }

  // Nothing to bite: chew on walls instead, so defences actually matter.
  for (let i = world.buildings.length - 1; i >= 0; i--) {
    const building = world.buildings[i];
    if (building.type !== 'wall') continue;
    if (distance(building.pos, mob.pos) > radius + BUILDINGS.wall.radius) continue;
    building.level -= 1;
    mob.attackCd = 1.4;
    if (building.level <= 0) world.buildings.splice(i, 1);
    return;
  }
}

/** Pick the strongest affordable type available on this night. */
function pickMobType(world: World, budget: number): MobTypeId | null {
  const eligible = MOB_ORDER.filter(
    (id) => MOBS[id].minNight <= world.nightIndex && MOBS[id].cost <= budget && !MOBS[id].bossEvery,
  );
  if (eligible.length === 0) return null;
  // Bias toward the tougher end as nights progress, but keep the mix varied.
  const roll = nextFloat(world);
  const index = Math.floor(Math.pow(roll, 1.6) * eligible.length);
  return eligible[Math.min(index, eligible.length - 1)];
}

function edgeSpawn(world: World): Vec2 {
  for (let attempt = 0; attempt < 48; attempt++) {
    const angle = nextFloat(world) * Math.PI * 2;
    // Spawn on a ring beyond the camp but inside the island where possible.
    const radius = 520 + nextFloat(world) * 420;
    const pos = {
      x: world.camp.x + Math.cos(angle) * radius,
      y: world.camp.y + Math.sin(angle) * radius,
    };
    const t = terrainAtIndex(world.terrain, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE));
    if (isWalkable(t)) return pos;
  }
  return {
    x: world.camp.x + (nextFloat(world) - 0.5) * CAMP.defendRadius * 2,
    y: world.camp.y - CAMP.defendRadius * 2,
  };
}

export function spawnMob(world: World, type: MobTypeId, pos: Vec2): Mob {
  const def = MOBS[type];
  const hp = Math.round(def.hp * toughness(world, type));
  const mob: Mob = {
    id: world.nextId++,
    type,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    hp,
    maxHp: hp,
    attackCd: 0,
    seed: Math.floor(nextFloat(world) * 65536),
    hitFlash: 0,
  };
  world.mobs.push(mob);
  return mob;
}

/** Whatever boss this night is owed walks in from the edge as it falls. */
export function spawnBosses(world: World): void {
  for (const id of Object.keys(MOBS) as MobTypeId[]) {
    const def = MOBS[id];
    if (!def.bossEvery || world.nightIndex < def.minNight) continue;
    if ((world.nightIndex - (def.bossPhase ?? 0)) % def.bossEvery !== 0) continue;
    const mob = spawnMob(world, id, edgeSpawn(world));
    world.events.push({ kind: 'boss', pos: { ...mob.pos }, type: id });
  }
}

/** Release the night's spawn budget in pulses rather than one dump. */
export function stepWaves(world: World, dt: number): void {
  if (world.phase !== 'night' || world.waveBudget <= 0) return;

  world.wavePulse -= dt;
  if (world.wavePulse > 0) return;
  world.wavePulse = WAVES.pulseInterval;

  const pulseBudget = Math.max(2, Math.ceil(world.waveBudget / 4));
  let spent = 0;

  while (spent < pulseBudget && world.waveBudget > 0) {
    const type = pickMobType(world, world.waveBudget);
    if (!type) break;
    spawnMob(world, type, edgeSpawn(world));
    const cost = MOBS[type].cost;
    world.waveBudget -= cost;
    spent += cost;
  }
}

export function nightBudget(world: World): number {
  const players = Math.max(1, world.players.size);
  const n = world.nightIndex;
  return Math.round(
    WAVES.baseBudget +
      WAVES.budgetPerNight * n +
      WAVES.budgetPerNightSq * n * n +
      WAVES.budgetPerExtraPlayer * (players - 1),
  );
}

/**
 * How much tougher than its table row a creature born tonight is. Only
 * nights count, never the clock, so it is the same for host and guest. A
 * returning boss grows by visit rather than by night, so the fifth-night
 * Warden stays the fight it was tuned as.
 */
export function toughness(world: World, type: MobTypeId): number {
  const def = MOBS[type];
  if (def.bossEvery) {
    const phase = def.bossPhase ?? 0;
    const visits = Math.floor((world.nightIndex - phase) / def.bossEvery) - Math.floor((def.minNight - phase) / def.bossEvery);
    return 1 + WAVES.bossReturnHp * Math.max(0, visits);
  }
  return 1 + WAVES.hardenPerNight * Math.max(0, world.nightIndex - WAVES.hardenFrom);
}
