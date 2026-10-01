import { describe, expect, it } from 'vitest';
import { FUEL_VALUE, GENERATOR_FUEL_SHARE, MACHINES } from '../../data/machines';
import { tileKey } from '../grid';
import { bankOf, powerNetOf, powerWires } from '../power';
import { countIn } from '../slots';
import { TERRAIN_ORDER } from '../terrain';
import type { Machine } from '../types';
import { advance, at, bench, fill, put, type Bench } from './bench';

/** A steam engine on the bench's shore, with a pond dug beside it. */
function engine(b: Bench, dx: number, dy: number, coal: number): Machine {
  const spot = at(dx, dy);
  b.world.terrain[tileKey(spot.tx, spot.ty - 1)] = TERRAIN_ORDER.indexOf('water');
  const machine = put(b, 'generator', spot.tx, spot.ty, 0) as Machine;
  if (coal > 0) fill(machine.fuel!, 'coal', coal);
  return machine;
}

/** An electric furnace with a full load of ore. */
function furnace(b: Bench, dx: number, dy: number): Machine {
  const spot = at(dx, dy);
  const machine = put(b, ['furnaceMk3', 'ironPlate'], spot.tx, spot.ty, 0) as Machine;
  const def = MACHINES.furnaceMk3;
  fill(machine.input, 'ironOre', def.inputSlots * def.slotSize, def.slotSize);
  return machine;
}

function pole(b: Bench, dx: number, dy: number): Machine {
  const spot = at(dx, dy);
  return put(b, 'pole', spot.tx, spot.ty, 0) as Machine;
}

const plates = (m: Machine): number => countIn(m.output, 'ironPlate');

describe('power', () => {
  it('leaves an electric machine idle until a pole reaches it', () => {
    const b = bench();
    const f = furnace(b, 2, 3);
    advance(b.world, 5);
    expect(plates(f)).toBe(0);
    expect(f.stalled).toBe(true);
    expect(f.unpowered).toBe(true);

    // Poles alone carry nothing: a network needs an engine on it.
    pole(b, 3, 3);
    advance(b.world, 5);
    expect(plates(f)).toBe(0);

    engine(b, 5, 3, 20);
    advance(b.world, 5);
    expect(plates(f)).toBeGreaterThan(0);
    expect(f.unpowered).toBeUndefined();
  });

  it('runs a powered machine exactly as fast as the burner tier would', () => {
    const b = bench();
    const f = furnace(b, 2, 3);
    pole(b, 3, 3);
    engine(b, 5, 3, 20);
    advance(b.world, 10);
    // Speed 4 on a two-second recipe is two plates a second, less the tick
    // each craft spends restarting.
    expect(plates(f)).toBeGreaterThan(17);
    expect(plates(f)).toBeLessThanOrEqual(20);
  });

  it('slows every machine on a network that asks for more than it has', () => {
    const full = bench();
    const alone = furnace(full, 2, 3);
    pole(full, 3, 3);
    engine(full, 5, 3, 50);
    advance(full.world, 10);

    const short = bench();
    // Six furnaces want 1080 kW from a 900 kW engine: five sixths of the pace.
    const bank = [0, 1, 2, 3, 4, 5].map((i) => furnace(short, 1 + i, i < 3 ? 2 : 4));
    pole(short, 3, 3);
    engine(short, 7, 3, 50);
    advance(short.world, 10);

    const net = powerNetOf(short.world, bank[0])!;
    expect(net.demand).toBe(6 * MACHINES.furnaceMk3.power!);
    expect(net.satisfaction).toBeCloseTo(900 / 1080, 5);
    for (const f of bank) {
      expect(plates(f)).toBeLessThan(plates(alone));
      expect(plates(f)).toBeGreaterThan(plates(alone) * 0.75);
    }
  });

  it('burns coal in proportion to the load, and none while idle', () => {
    const b = bench();
    const g = engine(b, 5, 3, 20);
    pole(b, 3, 3);
    advance(b.world, 10);
    // Nothing to power: the firebox is untouched.
    expect(countIn(g.fuel!, 'coal')).toBe(20);

    furnace(b, 2, 3);
    advance(b.world, 16);
    // One furnace is a fifth of the engine: a coal lasts five times as long.
    const burnt = 20 - countIn(g.fuel!, 'coal');
    const perCoal = FUEL_VALUE.coal! * GENERATOR_FUEL_SHARE;
    const expected = (16 * (MACHINES.furnaceMk3.power! / MACHINES.generator.generates!)) / perCoal;
    expect(burnt).toBeGreaterThanOrEqual(Math.floor(expected));
    expect(burnt).toBeLessThanOrEqual(Math.ceil(expected) + 1);
  });

  it('stops the network when the engine runs dry', () => {
    const b = bench();
    const f = furnace(b, 2, 3);
    pole(b, 3, 3);
    const g = engine(b, 5, 3, 1);
    advance(b.world, 30);
    expect(g.stalled).toBe(true);
    expect(f.unpowered).toBe(true);
    const made = plates(f);
    advance(b.world, 5);
    expect(plates(f)).toBe(made);
  });

  it('joins poles within wire reach into one network and keeps distant ones apart', () => {
    const b = bench();
    const near = furnace(b, 1, 3);
    const far = furnace(b, 27, 3);
    pole(b, 2, 3);
    engine(b, 3, 5, 20);
    const lonely = pole(b, 26, 3);
    advance(b.world, 2);
    expect(powerNetOf(b.world, near)).not.toBe(null);
    expect(powerNetOf(b.world, far)).not.toBe(powerNetOf(b.world, near));
    expect(far.unpowered).toBe(true);

    // Two poles bridge the gap, each within eight tiles of the next.
    pole(b, 10, 3);
    pole(b, 18, 3);
    advance(b.world, 2);
    expect(powerNetOf(b.world, far)).toBe(powerNetOf(b.world, near));
    expect(far.unpowered).toBeUndefined();
    // One wire per link, not one per pair in reach.
    expect(powerWires(b.world).length).toBe(3);
    expect(powerWires(b.world).flat()).toContain(lonely);
  });

  it('leaves an engine no pole reaches stalled and its coal unburnt', () => {
    const b = bench();
    const g = engine(b, 5, 3, 5);
    advance(b.world, 5);
    expect(g.stalled).toBe(true);
    expect(countIn(g.fuel!, 'coal')).toBe(5);
  });

  it('fuels an engine from a belt through an arm', () => {
    const b = bench();
    const g = engine(b, 5, 3, 0);
    // Facing up: it lifts from the chest behind it into the engine.
    put(b, 'inserter', at(5, 4).tx, at(5, 4).ty, 3);
    const chest = put(b, 'chest', at(5, 5).tx, at(5, 5).ty, 0) as Machine;
    fill(chest.input, 'coal', 10);
    advance(b.world, 10);
    expect(countIn(g.fuel!, 'coal')).toBeGreaterThan(0);
  });
});

describe('power research', () => {
  it('raises every engine\'s output with High-Pressure Steam', () => {
    const b = bench();
    const f = furnace(b, 2, 3);
    pole(b, 3, 3);
    engine(b, 5, 3, 20);
    advance(b.world, 1);
    expect(powerNetOf(b.world, f)!.supply).toBe(900);
    b.world.research.levels.steamPressure = 1;
    advance(b.world, 1);
    expect(powerNetOf(b.world, f)!.supply).toBeCloseTo(1125, 6);
  });

  it('makes a coal last longer in an engine with Firebox Design', () => {
    const burnt = (firebox: boolean): number => {
      const b = bench();
      if (firebox) b.world.research.levels.fireboxDesign = 1;
      const g = engine(b, 5, 3, 20);
      pole(b, 3, 3);
      for (const [dx, dy] of [[0, 2], [1, 4], [2, 2], [6, 2], [7, 4]]) furnace(b, dx, dy);
      advance(b.world, 20);
      return 20 - countIn(g.fuel!, 'coal');
    };
    expect(burnt(true)).toBeLessThan(burnt(false));
  });
});

describe('solar panels', () => {
  function field(b: Bench): { panel: Machine; f: Machine } {
    const f = put(b, ['assemblerMk3', 'gear'], at(2, 3).tx, at(2, 3).ty, 0) as Machine;
    fill(f.input, 'ironPlate', 100);
    pole(b, 3, 3);
    const panel = put(b, 'solar', at(4, 3).tx, at(4, 3).ty, 0) as Machine;
    return { panel, f };
  }

  it('powers a network by day with nothing to burn', () => {
    const b = bench();
    b.world.phase = 'day';
    b.world.phaseTime = 1000;
    const { panel, f } = field(b);
    advance(b.world, 5);
    expect(panel.stalled).toBe(false);
    expect(powerNetOf(b.world, f)!.supply).toBe(MACHINES.solar.generates);
    // 60 kW of a 150 kW assembler: it works, at two fifths of the pace.
    expect(powerNetOf(b.world, f)!.satisfaction).toBeCloseTo(0.4, 6);
    expect(countIn(f.output, 'gear')).toBeGreaterThan(0);
  });

  it('goes dark at night', () => {
    const b = bench();
    b.world.phase = 'night';
    b.world.phaseTime = 1000;
    const { panel, f } = field(b);
    advance(b.world, 5);
    expect(panel.stalled).toBe(true);
    expect(f.unpowered).toBe(true);
    expect(countIn(f.output, 'gear')).toBe(0);
  });
});

describe('accumulators', () => {
  const { capacity, rate } = MACHINES.accumulator.stores!;

  /** A pole with a panel, an accumulator and an assembler that can be made to ask for power. */
  function plant(b: Bench, load: boolean): { panel: Machine; bank: Machine; f: Machine } {
    const f = put(b, ['assemblerMk3', 'gear'], at(2, 3).tx, at(2, 3).ty, 0) as Machine;
    if (load) fill(f.input, 'ironPlate', 100);
    pole(b, 3, 3);
    const panel = put(b, 'solar', at(4, 3).tx, at(4, 3).ty, 0) as Machine;
    const bank = put(b, 'accumulator', at(4, 4).tx, at(4, 4).ty, 0) as Machine;
    return { panel, bank, f };
  }

  it('stores a daytime surplus, at the panel\'s surplus and no faster', () => {
    const b = bench();
    b.world.phase = 'day';
    b.world.phaseTime = 1000;
    const { bank } = plant(b, false);
    advance(b.world, 10);
    // 60 kW and nothing asking for it: 600 kJ over ten seconds, less the one
    // tick before the idle assembler first reports that it wants nothing.
    expect(bank.charge).toBeGreaterThan(590);
    expect(bank.charge).toBeLessThanOrEqual(600);
    expect(powerNetOf(b.world, bank)!.flow).toBeCloseTo(60, 6);
  });

  it('never charges past its capacity or its rate', () => {
    const b = bench();
    b.world.phase = 'day';
    b.world.phaseTime = 1e6;
    const { bank } = plant(b, false);
    for (let i = 0; i < 4; i++) put(b, 'solar', at(6 + i, 3).tx, at(6 + i, 3).ty, 0);
    advance(b.world, 1);
    // Five panels make 300 kW, which is exactly the rate it can take.
    expect(bank.charge).toBeLessThanOrEqual(rate + 1e-6);
    advance(b.world, 200);
    expect(bank.charge).toBe(capacity);
    expect(powerNetOf(b.world, bank)!.flow).toBe(0);
  });

  it('carries a load through the night, then runs dry', () => {
    const b = bench();
    b.world.phase = 'night';
    b.world.phaseTime = 1e6;
    const { bank, f } = plant(b, true);
    bank.charge = 1500;
    advance(b.world, 5);
    // The assembler asks for 150 kW and the bank gives it, all of it.
    expect(powerNetOf(b.world, f)!.satisfaction).toBe(1);
    expect(f.unpowered).toBeUndefined();
    expect(bank.charge).toBeCloseTo(1500 - 150 * 5, 1);
    expect(countIn(f.output, 'gear')).toBeGreaterThan(0);

    advance(b.world, 20);
    expect(bank.charge).toBeUndefined();
    expect(f.unpowered).toBe(true);
    expect(powerNetOf(b.world, f)!.satisfaction).toBe(0);
  });

  it('spares the engines\' coal while it can cover the load', () => {
    const coalLeft = (charge: number): number => {
      const b = bench();
      b.world.phase = 'night';
      b.world.phaseTime = 1e6;
      const { bank } = plant(b, true);
      if (charge > 0) bank.charge = charge;
      const g = engine(b, 8, 3, 20);
      pole(b, 7, 3);
      advance(b.world, 10);
      return countIn(g.fuel!, 'coal') + (g.heat ?? 0) / (FUEL_VALUE.coal! * GENERATOR_FUEL_SHARE);
    };
    expect(coalLeft(capacity)).toBeGreaterThan(coalLeft(0));
    expect(coalLeft(capacity)).toBeCloseTo(20, 6);
  });

  it('does not burn coal to charge itself', () => {
    const b = bench();
    b.world.phase = 'night';
    b.world.phaseTime = 1e6;
    const { bank } = plant(b, false);
    const g = engine(b, 8, 3, 20);
    pole(b, 7, 3);
    advance(b.world, 10);
    expect(bank.charge).toBeUndefined();
    // The same one tick of stale demand may have lit a coal, but no more.
    expect(countIn(g.fuel!, 'coal') + (g.heat ?? 0) / (FUEL_VALUE.coal! * GENERATOR_FUEL_SHARE)).toBeGreaterThan(19.9);
  });

  it('shares a flow across a row by what each can take', () => {
    const b = bench();
    b.world.phase = 'day';
    b.world.phaseTime = 1e6;
    const { bank } = plant(b, false);
    const second = put(b, 'accumulator', at(5, 4).tx, at(5, 4).ty, 0) as Machine;
    second.charge = capacity - 100;
    advance(b.world, 10);
    // 600 kJ in: the nearly full one takes 100 and the other the rest.
    expect(second.charge).toBeCloseTo(capacity, 6);
    expect(bank.charge).toBeGreaterThan(490);
    expect(bank.charge).toBeLessThanOrEqual(500);
    expect(bankOf(powerNetOf(b.world, bank)!).capacity).toBe(capacity * 2);
  });

  it('is idle with no pole to reach it', () => {
    const b = bench();
    b.world.phase = 'day';
    b.world.phaseTime = 1000;
    const bank = put(b, 'accumulator', at(4, 4).tx, at(4, 4).ty, 0) as Machine;
    advance(b.world, 5);
    expect(bank.charge).toBeUndefined();
    expect(bank.stalled).toBe(true);
  });
});
