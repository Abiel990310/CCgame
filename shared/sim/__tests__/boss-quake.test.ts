import { describe, expect, it } from 'vitest';
import { MOBS } from '../../data/mobs';
import { spawnMob, stepMobs } from '../systems/mobs';
import type { Mob, Player, World } from '../types';
import { addPlayer, createWorld } from '../world';

const DT = 1 / 30;
const QUAKE = MOBS.warden.quake!;

function arena(): { world: World; player: Player } {
  const world = createWorld(37);
  world.mobs.length = 0;
  const player = addPlayer(world, 'test');
  return { world, player };
}

/** A warden past its turn, a little way off the player, ready to slam. */
function angryWarden(world: World, player: Player): Mob {
  const warden = spawnMob(world, 'warden', { x: player.pos.x + 70, y: player.pos.y });
  warden.enraged = true;
  warden.quakeCd = 0;
  return warden;
}

/** Keep the player where the test put them, so only the quake moves them. */
function hold(player: Player, at: { x: number; y: number }): void {
  player.pos = { ...at };
  player.invuln = 0;
}

describe("an enraged warden's quake", () => {
  it('rears up over a ring, then hurts and throws back whoever is still in it', () => {
    const { world, player } = arena();
    const warden = angryWarden(world, player);
    const spot = { ...player.pos };
    world.events.length = 0;
    stepMobs(world, DT);
    expect(world.events.some((e) => e.kind === 'quakeWind')).toBe(true);
    expect(warden.quake).toBeGreaterThan(0);

    const hp = player.hp;
    for (let t = 0; t < QUAKE.windup && !world.events.some((e) => e.kind === 'quake'); t += DT) {
      hold(player, spot);
      stepMobs(world, DT);
    }
    const landed = world.events.find((e) => e.kind === 'quake');
    expect(landed && landed.kind === 'quake' && landed.hits).toBe(1);
    expect(player.hp).toBe(hp - QUAKE.damage);
    // Thrown away from the warden, which stands to the east.
    expect(player.vel.x).toBeLessThan(-QUAKE.knock * 0.9);
  });

  it('misses a player who walks out of the ring before it lands', () => {
    const { world, player } = arena();
    const warden = angryWarden(world, player);
    stepMobs(world, DT);
    expect(warden.quake).toBeGreaterThan(0);
    const hp = player.hp;
    const away = { x: warden.pos.x - QUAKE.radius - 60, y: warden.pos.y };
    for (let t = 0; t < QUAKE.windup + 0.2; t += DT) {
      hold(player, away);
      stepMobs(world, DT);
    }
    expect(player.hp).toBe(hp);
  });

  it('is a second-phase move: a calm warden never quakes', () => {
    const { world, player } = arena();
    const warden = angryWarden(world, player);
    warden.enraged = false;
    for (let t = 0; t < 4; t += DT) stepMobs(world, DT);
    expect(world.events.some((e) => e.kind === 'quakeWind')).toBe(false);
    expect(warden.quake ?? 0).toBe(0);
  });
});

describe("an enraged queen's brood", () => {
  it('comes twice as many at a time', () => {
    const count = (enraged: boolean): number => {
      const { world, player } = arena();
      const queen = spawnMob(world, 'queen', { x: player.pos.x + 400, y: player.pos.y });
      queen.enraged = enraged;
      queen.summonCd = 0;
      stepMobs(world, DT);
      return world.mobs.filter((m) => m.brood).length;
    };
    expect(count(false)).toBe(MOBS.queen.summons!.count);
    expect(count(true)).toBe(MOBS.queen.summons!.rageCount);
  });
});
