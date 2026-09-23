import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../constants';
import { placeBuilding, removeBuildingAt } from '../building';
import { removeAt } from '../factory';
import { tileCenter } from '../grid';
import { addItem } from '../inventory';
import { EMPTY_INPUT, step } from '../step';
import { spawnMob } from '../systems/mobs';
import type { PlayerInput, SimEvent, World } from '../types';
import { addPlayer, createWorld } from '../world';
import { at, bench, lay, plantOre, put } from './bench';

/**
 * Events are what the client hears — every sound in the game is one of these.
 * They are cleared at the top of every tick, so a test has to collect them as
 * it goes rather than read them at the end.
 */
function collect(world: World, seconds: number, inputs = new Map<number, PlayerInput>()): SimEvent[] {
  const ticks = Math.round(seconds / TICK_DT);
  const seen: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(world, inputs);
    seen.push(...world.events);
  }
  return seen;
}

function kinds(events: SimEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe('production events', () => {
  it('announces every ore a miner pulls out, at the miner\'s tile', () => {
    const b = bench();
    const tile = at(0, 0);
    plantOre(b.world, 'ironOre', tile.tx, tile.ty);
    put(b, 'miner', tile.tx, tile.ty, 0);

    const produced = collect(b.world, 6).filter((e) => e.kind === 'produced');
    expect(produced.length).toBeGreaterThan(0);
    for (const event of produced) {
      expect(event).toMatchObject({ machine: 'miner', item: 'ironOre' });
      expect(event.kind === 'produced' && event.pos).toEqual(tileCenter(tile.tx, tile.ty));
    }
  });

  it('announces a smelt with the plate that came out, not the ore that went in', () => {
    const b = bench();
    const start = at(0, 0);
    const [, furnace] = lay(b, start.tx, start.ty, 0, ['belt', ['furnace', 'ironPlate']]);
    expect('input' in furnace).toBe(true);
    if (!('input' in furnace)) return;

    furnace.input[0] = { id: 'ironOre', count: 8 };
    const produced = collect(b.world, 12).filter(
      (e) => e.kind === 'produced' && e.machine === 'furnace',
    );
    expect(produced.length).toBeGreaterThan(0);
    expect(produced.every((e) => e.kind === 'produced' && e.item === 'ironPlate')).toBe(true);
  });

  it('stays quiet while a machine has nothing to make', () => {
    const b = bench();
    const tile = at(2, 2);
    put(b, ['furnace', 'ironPlate'], tile.tx, tile.ty, 0);
    expect(collect(b.world, 8).filter((e) => e.kind === 'produced')).toHaveLength(0);
  });
});

describe('building events', () => {
  it('announces a factory piece going up and coming back down', () => {
    const b = bench();
    const tile = at(4, 4);

    put(b, 'belt', tile.tx, tile.ty, 0);
    expect(b.world.events).toContainEqual({
      kind: 'placed',
      pos: tileCenter(tile.tx, tile.ty),
      what: 'belt',
    });

    b.world.events.length = 0;
    expect(removeAt(b.world, b.player, tile.tx, tile.ty)).toBe(true);
    expect(b.world.events).toContainEqual({
      kind: 'removed',
      pos: tileCenter(tile.tx, tile.ty),
    });
  });

  it('names the machine that was placed', () => {
    const b = bench();
    const tile = at(6, 4);
    put(b, 'chest', tile.tx, tile.ty, 0);
    expect(b.world.events).toContainEqual({
      kind: 'placed',
      pos: tileCenter(tile.tx, tile.ty),
      what: 'chest',
    });
  });

  it('announces a camp piece coming back down as well as going up', () => {
    const world = createWorld(11, true);
    const player = addPlayer(world, 'builder');
    addItem(player, 'wood', 200);
    addItem(player, 'stone', 200);
    addItem(player, 'fiber', 200);

    const pos = { x: world.camp.x + 70, y: world.camp.y };
    expect(placeBuilding(world, player, 'chest', pos)).toBe(true);
    expect(kinds(world.events)).toContain('built');

    world.events.length = 0;
    expect(removeBuildingAt(world, player, pos)).toBe('removed');
    expect(kinds(world.events)).toContain('removed');
  });

  it('says nothing when the campfire refuses to move', () => {
    const world = createWorld(11, true);
    const player = addPlayer(world, 'builder');
    expect(removeBuildingAt(world, player, world.camp)).toBe('campfire');
    expect(world.events).toHaveLength(0);
  });
});

describe('combat and pickup events', () => {
  it('announces one shot per volley, however many projectiles it fires', () => {
    const world = createWorld(5);
    const player = addPlayer(world, 'shooter');
    player.stats.multishot = 3;
    // Far enough that nothing lands, and short enough that the sling only gets
    // one volley off, so every projectile fired is still in the air to count.
    spawnMob(world, 'slime', { x: player.pos.x + 200, y: player.pos.y });

    const shots = collect(world, 0.2).filter((e) => e.kind === 'shot');
    expect(shots).toHaveLength(1);
    expect(world.projectiles).toHaveLength(1 + player.stats.multishot);
    expect(shots[0]).toMatchObject({ kind: 'shot', weapon: 'sling' });
  });

  it('announces a drop reaching the player', () => {
    const world = createWorld(5, true);
    const player = addPlayer(world, 'collector');
    world.pickups.push({
      id: world.nextId++,
      pos: { ...player.pos },
      vel: { x: 0, y: 0 },
      item: 'essence',
      count: 1,
      xp: 0,
      settle: 0,
    });

    const collected = collect(world, 1).filter((e) => e.kind === 'collected');
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ item: 'essence' });
  });
});

describe('the event buffer', () => {
  it('is emptied every tick, so a long session cannot grow one', () => {
    const b = bench();
    const tile = at(8, 2);
    plantOre(b.world, 'coal', tile.tx, tile.ty);
    put(b, 'miner', tile.tx, tile.ty, 0);

    const inputs = new Map([...b.world.players.keys()].map((id) => [id, EMPTY_INPUT]));
    for (let i = 0; i < 600; i++) {
      step(b.world, inputs);
      expect(b.world.events.length).toBeLessThan(32);
    }
  });
});
