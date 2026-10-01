import { describe, expect, it } from 'vitest';
import { CRAFT_BY_ID } from '../../data/crafting';
import { applyOrder, type Order } from '../commands';
import { spellPerk } from '../../data/spells';
import { addItem } from '../inventory';
import { addPerk } from '../perks';
import { makeRng } from '../rng';
import { checksum, decode, encode, restoreSnapshot, takeSnapshot, type Snapshot } from '../snapshot';
import { step } from '../step';
import type { PlayerInput, World } from '../types';
import { createPlayer, spawnPoint } from '../world';
import { at, bench, plantOre } from './bench';

/**
 * Co-op works by every guest replaying the host's ticks: the same orders and
 * inputs, applied at the same points, to a copy of the same world. These tests
 * play a host and a guest side by side and fail the moment the two copies
 * disagree — which is the bug that would otherwise surface as a friend seeing
 * a belt the host never built.
 */

interface Tick {
  orders: Order[];
  inputs: [number, PlayerInput][];
  hash: number;
}

function wander(rng: () => number): PlayerInput {
  const angle = rng() * Math.PI * 2;
  return {
    move: { x: Math.cos(angle), y: Math.sin(angle) },
    dash: rng() < 0.02,
    interact: rng() < 0.5,
    attack: rng() < 0.2,
  };
}

/** Run the host one tick the way `Game` does: orders first, then the step. */
function hostTick(world: World, orders: Order[], inputs: Map<number, PlayerInput>): Tick {
  for (const order of orders) applyOrder(world, order);
  step(world, inputs);
  return { orders, inputs: [...inputs], hash: checksum(world) };
}

function guestTick(world: World, tick: Tick): void {
  // Orders cross the wire as text, like everything else a guest is sent.
  const { orders, inputs } = decode<Tick>(encode(tick));
  for (const order of orders) applyOrder(world, order);
  step(world, new Map(inputs));
}

describe('co-op replay', () => {
  it('keeps a guest in step with the host through building, raids and a join', () => {
    const { world: host, player } = bench();
    host.peaceful = false;
    // Bring the first night close, so the run covers a raid as well as a factory.
    host.phaseTime = 20;
    const rng = makeRng(99);

    const orders: Order[][] = [];
    const ore = at(2, 2);
    plantOre(host, 'ironOre', ore.tx, ore.ty);
    orders[5] = [
      { p: player.id, c: { k: 'machine', what: 'miner', tx: ore.tx, ty: ore.ty, dir: 0 } },
      { p: player.id, c: { k: 'belt', tx: ore.tx + 1, ty: ore.ty, dir: 0 } },
      { p: player.id, c: { k: 'belt', tx: ore.tx + 2, ty: ore.ty, dir: 0 } },
      { p: player.id, c: { k: 'machine', what: 'chest', tx: ore.tx + 3, ty: ore.ty, dir: 0 } },
    ];

    // The guest arrives from a snapshot taken between two ticks, then joins.
    for (let t = 0; t < 60; t++) {
      hostTick(host, orders[t] ?? [], new Map([[player.id, wander(rng)]]));
    }
    // A workbench at the player's feet and what a satchel costs, so the run
    // covers a bag being sewn on as well.
    host.buildings.push({ id: host.nextId++, type: 'workbench', pos: { ...player.pos }, level: 1 });
    for (const c of CRAFT_BY_ID.get('satchel')!.cost) addItem(player, c.id, c.count);
    // Two spells, cast every so often and swapped once, so casting is covered too.
    addPerk(player, spellPerk('fireball'));
    addPerk(player, spellPerk('frostNova'));
    player.spell = 'fireball';
    // Food and a wound, so eating is covered too.
    addItem(player, 'fish', 3);
    player.hp = 40;
    // Modules to fit into a tier 3 furnace built mid-run.
    addItem(player, 'speedModule', 2);
    const snap = decode<Snapshot>(encode(takeSnapshot(host)));
    const guest = restoreSnapshot(snap);
    expect(checksum(guest)).toBe(checksum(host));

    const friend = createPlayer(host.nextId, 'Friend', spawnPoint(host));
    let pending: Order[] = [{ p: friend.id, c: { k: 'join', player: friend } }];

    for (let t = 60; t < 60 + 30 * 90; t++) {
      const inputs = new Map([
        [player.id, { ...wander(rng), cast: t % 40 < 2 }],
        [friend.id, wander(rng)],
      ]);
      if (t === 300) pending.push({ p: player.id, c: { k: 'spell', id: 'frostNova' } });
      if (t === 61) pending.push({ p: player.id, c: { k: 'craft', id: 'satchel' } });
      if (t === 62) pending.push({ p: player.id, c: { k: 'eat' } });
      if (t === 120) {
        pending.push({ p: friend.id, c: { k: 'queue', tech: 'roboticArms', op: 'add' } });
        pending.push({ p: player.id, c: { k: 'queue', tech: 'angling', op: 'add' } });
        pending.push({ p: player.id, c: { k: 'queue', tech: 'angling', op: 'up' } });
      }
      if (t === 400) {
        pending.push({ p: friend.id, c: { k: 'belt', tx: ore.tx + 1, ty: ore.ty + 1, dir: 1 } });
        pending.push({ p: player.id, c: { k: 'remove', tx: ore.tx + 2, ty: ore.ty } });
        // An underground belt's second piece decides for itself that it is the
        // exit, which a guest has to decide the same way.
        pending.push({ p: player.id, c: { k: 'machine', what: 'tunnel', tx: ore.tx, ty: ore.ty + 3, dir: 0 } });
        pending.push({ p: player.id, c: { k: 'machine', what: 'tunnel', tx: ore.tx + 4, ty: ore.ty + 3, dir: 0 } });
        pending.push({ p: player.id, c: { k: 'machine', what: 'furnaceMk3', tx: ore.tx + 6, ty: ore.ty, dir: 0 } });
        pending.push({ p: player.id, c: { k: 'machine', what: 'turret', tx: ore.tx + 9, ty: ore.ty, dir: 0 } });
      }
      if (t === 410) {
        // Faster belts laid over standing ones: a new belt born Mk3, one upgraded
        // in place with ore riding it, and a plain one bumped Mk2 then refused Mk2 again.
        pending.push({ p: player.id, c: { k: 'belt', tx: ore.tx + 1, ty: ore.ty + 1, dir: 1, tier: 3 } });
        pending.push({ p: player.id, c: { k: 'belt', tx: ore.tx + 1, ty: ore.ty, dir: 0, tier: 2 } });
        pending.push({ p: player.id, c: { k: 'belt', tx: ore.tx + 1, ty: ore.ty, dir: 0, tier: 2 } });
        // The gap the removal above left in the miner's line, closed again.
        pending.push({ p: player.id, c: { k: 'belt', tx: ore.tx + 2, ty: ore.ty, dir: 0 } });
      }
      if (t === 420) {
        // The chest at the end of the miner's line makes way for a long-haul
        // pair, which a guest has to pair the same way the host does.
        pending.push({ p: player.id, c: { k: 'remove', tx: ore.tx + 3, ty: ore.ty } });
      }
      if (t === 421) {
        pending.push({ p: player.id, c: { k: 'machine', what: 'haul', tx: ore.tx + 3, ty: ore.ty, dir: 0 } });
        pending.push({ p: player.id, c: { k: 'machine', what: 'haul', tx: ore.tx + 3, ty: ore.ty + 4, dir: 0 } });
        pending.push({ p: player.id, c: { k: 'belt', tx: ore.tx + 4, ty: ore.ty + 4, dir: 0 } });
        pending.push({ p: player.id, c: { k: 'machine', what: 'chest', tx: ore.tx + 5, ty: ore.ty + 4, dir: 0 } });
      }
      if (t === 700) {
        // Taking the receiving end up mid-run turns the sender back into one
        // waiting, and puts a new port beside it to pair again.
        pending.push({ p: player.id, c: { k: 'remove', tx: ore.tx + 3, ty: ore.ty + 4 } });
      }
      if (t === 710) {
        pending.push({ p: player.id, c: { k: 'machine', what: 'haul', tx: ore.tx + 3, ty: ore.ty + 4, dir: 0 } });
      }
      if (t === 402) {
        // Bitten the same on both copies, so the mend below is what is replayed.
        for (const world of [host, guest]) world.machines.find((m) => m.type === 'turret')!.wear = 100;
        pending.push({ p: player.id, c: { k: 'mend', machine: host.machines.find((m) => m.type === 'turret')!.id } });
      }
      if (t === 401) {
        const mk3 = host.machines.find((m) => m.type === 'furnaceMk3')!;
        const index = player.inventory.findIndex((s) => s?.id === 'speedModule');
        pending.push({ p: player.id, c: { k: 'quick', machine: mk3.id, ref: { area: 'bag', index } } });
      }
      const tick = hostTick(host, pending, inputs);
      pending = [];
      guestTick(guest, tick);
      if (checksum(guest) !== tick.hash) {
        throw new Error(`guest drifted from the host at tick ${host.tick}`);
      }
    }

    expect(host.machines.filter((m) => m.type === 'tunnelExit')).toHaveLength(1);
    const beltAtTile = (world: World, dx: number, dy: number) =>
      world.belts.find((b) => b.tx === ore.tx + dx && b.ty === ore.ty + dy)!;
    for (const world of [host, guest]) {
      expect(beltAtTile(world, 1, 1).tier).toBe(3);
      expect(beltAtTile(world, 1, 0).tier).toBe(2);
      expect(world.belts.filter((b) => b.tier === 2)).toHaveLength(1);
      const sender = world.machines.find((m) => m.type === 'haul' && m.tx === ore.tx + 3 && m.ty === ore.ty)!;
      const receiver = world.machines.find((m) => m.type === 'haulExit')!;
      expect(sender.link).toBe(receiver.id);
      expect(receiver.link).toBe(sender.id);
    }
    // What came through the pipe before the pair was broken and remade is in the chest.
    const far = guest.machines.find((m) => m.type === 'chest' && m.tx === ore.tx + 5 && m.ty === ore.ty + 4)!;
    expect(far.input.some((slot) => slot && slot.count > 0)).toBe(true);
    expect(guest.machines.find((m) => m.type === 'turret')!.wear).toBeUndefined();
    expect(guest.machines.find((m) => m.type === 'furnaceMk3')!.modules).toEqual([
      { id: 'speedModule', count: 1 },
      { id: 'speedModule', count: 1 },
    ]);
    expect(host.nightIndex).toBeGreaterThan(0);
    expect(host.players.size).toBe(2);
    expect(player.bag).toBe(1);
    expect(player.spell).toBe('frostNova');
    expect(guest.research.queue).toEqual(['beltLogistics', 'angling', 'roboticArms']);
    expect(guest.players.get(player.id)!.inventory).toHaveLength(player.inventory.length);
    expect(encode(takeSnapshot(guest))).toBe(encode(takeSnapshot(host)));
  });

  it('round-trips numbers plain JSON would change', () => {
    const text = encode({ a: -0, b: Infinity, c: -Infinity, d: 0.1 + 0.2 });
    const back = decode<{ a: number; b: number; c: number; d: number }>(text);
    expect(Object.is(back.a, -0)).toBe(true);
    expect(back.b).toBe(Infinity);
    expect(back.c).toBe(-Infinity);
    expect(back.d).toBe(0.1 + 0.2);
  });

  it('refuses malformed orders instead of throwing', () => {
    const { world, player } = bench();
    const junk = [
      { k: 'machine', what: 'reactor', tx: 1, ty: 1, dir: 0 },
      { k: 'belt', tx: 1.5, ty: 1, dir: 9 },
      { k: 'belt', tx: 1, ty: 1, dir: 0, tier: 9 },
      { k: 'belt', tx: 1, ty: 1, dir: 0, tier: 'beltMk3' },
      { k: 'click', machine: null, ref: { area: 'bag', index: 999 }, button: 'left' },
      { k: 'click', machine: 12345, ref: { area: 'input', index: 0 }, button: 'left' },
      { k: 'building', type: 'castle', x: 0, y: 0 },
      { k: 'spell', id: 'meteor' },
      { k: 'spell', id: 'mend' },
      { k: 'mend', machine: 'turret' },
      { k: 'mend', machine: 999999 },
      { k: 'nonsense' },
    ] as unknown as Order['c'][];
    const bag = player.inventory.length;
    for (const c of junk) expect(applyOrder(world, { p: player.id, c })).toBe(false);
    expect(player.inventory.length).toBe(bag);
    expect(applyOrder(world, { p: 424242, c: { k: 'stow' } })).toBe(false);
  });
});
