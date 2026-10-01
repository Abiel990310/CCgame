import { FUEL_VALUE, GENERATOR_FUEL_SHARE, MACHINES } from '../data/machines';
import { tileKey } from './grid';
import { powerDraw } from './modules';
import { researchBonuses } from './research';
import { takeFromSlots } from './slots';
import type { Machine, World } from './types';

/**
 * One set of poles joined by wire, with everything they reach. Supply and
 * demand are recounted every tick; the layout only when the factory changes.
 */
export interface PowerNet {
  /** kW its generators could put out right now, fuel permitting. */
  supply: number;
  /** kW its working machines ask for. */
  demand: number;
  /** Share of the demand met, 0 to 1: every machine on it runs at this speed. */
  satisfaction: number;
  /** kW the accumulators on it are putting in (positive) or giving out (negative) this tick. */
  flow: number;
  generators: Machine[];
  accumulators: Machine[];
  consumers: Machine[];
  poles: Machine[];
}

interface Layout {
  key: number;
  nets: PowerNet[];
  /** Machine id to its net, for every pole, and every generator and consumer one reaches. */
  netOf: Map<number, PowerNet>;
  /** The wires actually strung: the shortest that join each network. */
  wires: Array<[Machine, Machine]>;
}

/**
 * Derived entirely from the machines, so it is never saved or sent: a guest
 * rebuilds the same layout from the same factory. Kept per world rather than
 * on it so a snapshot of the world never carries it.
 */
const layouts = new WeakMap<World, Layout>();

/**
 * A fingerprint of everything that shapes the networks. Ids are never reused,
 * so placing or removing any powered piece changes it, and an upgrade to an
 * electric tier changes the type it mixes in.
 */
function layoutKey(world: World): number {
  let h = 0x811c9dc5;
  for (const m of world.machines) {
    const def = MACHINES[m.type];
    if (!def.power && !def.generates && !def.stores && def.family !== 'pole') continue;
    h = Math.imul(h ^ m.id, 0x01000193);
    h = Math.imul(h ^ (m.tx * 4099 + m.ty), 0x01000193);
    h = Math.imul(h ^ (def.power ?? 0) ^ ((def.generates ?? 0) << 12), 0x01000193);
  }
  return h >>> 0;
}

function buildLayout(world: World, key: number): Layout {
  const poles = world.machines.filter((m) => MACHINES[m.type].family === 'pole');

  // Two poles are joined when each can reach the other. Joining the closest
  // pairs first (Kruskal) keeps the same networks as joining every pair, and
  // leaves one wire per link to draw instead of a web between every post.
  const pairs: Array<[number, number, number]> = [];
  for (let a = 0; a < poles.length; a++) {
    const wa = MACHINES[poles[a].type].wire ?? 0;
    for (let b = a + 1; b < poles.length; b++) {
      const reach = Math.min(wa, MACHINES[poles[b].type].wire ?? 0);
      const dx = poles[a].tx - poles[b].tx;
      const dy = poles[a].ty - poles[b].ty;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach) pairs.push([d2, a, b]);
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);

  const parent = poles.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const wires: Array<[Machine, Machine]> = [];
  for (const [, a, b] of pairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    parent[ra] = rb;
    wires.push([poles[a], poles[b]]);
  }

  const byRoot = new Map<number, PowerNet>();
  const nets: PowerNet[] = [];
  const netOf = new Map<number, PowerNet>();
  poles.forEach((pole, i) => {
    const root = find(i);
    let net = byRoot.get(root);
    if (!net) {
      net = { supply: 0, demand: 0, satisfaction: 0, flow: 0, generators: [], accumulators: [], consumers: [], poles: [] };
      byRoot.set(root, net);
      nets.push(net);
    }
    net.poles.push(pole);
    netOf.set(pole.id, net);

    // The first pole to cover a machine claims it, in placement order, so a
    // machine between two separate networks always joins the same one.
    const r = MACHINES[pole.type].supply ?? 0;
    for (let ty = pole.ty - r; ty <= pole.ty + r; ty++) {
      for (let tx = pole.tx - r; tx <= pole.tx + r; tx++) {
        const m = world.grid.get(tileKey(tx, ty));
        if (!m || !('type' in m) || netOf.has(m.id)) continue;
        const def = MACHINES[m.type];
        if (def.generates) net.generators.push(m);
        else if (def.stores) net.accumulators.push(m);
        else if (def.power) net.consumers.push(m);
        else continue;
        netOf.set(m.id, net);
      }
    }
  });

  // Tick order within a net follows the world's, whatever order poles found them.
  const order = new Map(world.machines.map((m, i) => [m.id, i]));
  for (const net of nets) {
    net.generators.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    net.accumulators.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    net.consumers.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  return { key, nets, netOf, wires };
}

function layout(world: World): Layout {
  const key = layoutKey(world);
  const cached = layouts.get(world);
  if (cached && cached.key === key) return cached;
  const fresh = buildLayout(world, key);
  layouts.set(world, fresh);
  return fresh;
}

/** Heat a generator could still spend, burning from its grid if it must. */
function hasFuel(machine: Machine): boolean {
  if ((machine.heat ?? 0) > 0) return true;
  return (machine.fuel ?? []).some((slot) => slot !== null && (FUEL_VALUE[slot.id] ?? 0) > 0);
}

function burn(machine: Machine, fuelBonus: number): boolean {
  if ((machine.heat ?? 0) > 0) return true;
  for (const slot of machine.fuel ?? []) {
    const value = slot ? FUEL_VALUE[slot.id] ?? 0 : 0;
    if (slot && value > 0) {
      takeFromSlots(machine.fuel!, slot.id, 1);
      machine.heat = (machine.heat ?? 0) + value * GENERATOR_FUEL_SHARE * fuelBonus;
      return true;
    }
  }
  return false;
}

/**
 * Balance every network for the tick ahead, and burn the fuel it costs.
 *
 * Demand is read off how machines ended the last tick: one that stalled for
 * want of work asks for nothing, one that stalled for want of power still
 * asks, so a starved network never mistakes its machines for idle ones and
 * flickers between on and off.
 */
export function stepPower(world: World, dt: number): void {
  const { nets } = layout(world);
  const bonus = researchBonuses(world);
  const daylight = world.phase === 'day';
  for (const net of nets) {
    net.demand = 0;
    for (const m of net.consumers) {
      if (!m.stalled || m.unpowered) net.demand += powerDraw(m);
    }

    // Daylight panels have no fuel to save, so they carry the load first; the
    // accumulators cover what they cannot, and only the rest burns coal.
    net.supply = 0;
    let free = 0;
    let fuelled = 0;
    for (const g of net.generators) {
      const def = MACHINES[g.type];
      // A generator with no firebox runs on daylight instead.
      const running = def.fuelSlots > 0 ? hasFuel(g) : daylight;
      g.stalled = !running;
      if (!running) continue;
      const kw = (def.generates ?? 0) * bonus.power;
      net.supply += kw;
      if (def.fuelSlots > 0) fuelled += kw;
      else free += kw;
    }

    // Only a daylight surplus charges a bank: an engine never burns coal to
    // fill one, which is what keeps a coal base from paying for power it
    // never uses.
    const surplus = Math.max(0, free - net.demand);
    const shortfall = Math.max(0, net.demand - free);
    const stored = flowAccumulators(net.accumulators, surplus, shortfall, dt);
    net.flow = stored;

    const given = Math.max(0, -stored);
    net.satisfaction = net.demand === 0 ? 1 : Math.min(1, (net.supply + given) / net.demand);
    const rest = Math.max(0, shortfall - given);
    const load = fuelled === 0 ? 0 : Math.min(1, rest / fuelled);
    if (load === 0) continue;

    // Every engine shares the load evenly, so a bank drains its coal together
    // and one full belt keeps all of them going.
    for (const g of net.generators) {
      if (g.stalled || MACHINES[g.type].fuelSlots === 0 || !burn(g, bonus.fuel)) continue;
      g.heat = (g.heat ?? 0) - dt * load;
    }
  }
}

/** What a network's accumulators hold between them, and could hold, in kJ. */
export function bankOf(net: PowerNet): { charge: number; capacity: number } {
  let charge = 0;
  let capacity = 0;
  for (const m of net.accumulators) {
    charge += m.charge ?? 0;
    capacity += MACHINES[m.type].stores!.capacity;
  }
  return { charge, capacity };
}

/**
 * Move `surplus` kW into the banks, or `shortfall` kW out of them, whichever
 * the network asks for, sharing it by what each can take or give so a row of
 * accumulators fills and drains together. Returns the net kW stored: positive
 * charging, negative discharging.
 */
function flowAccumulators(banks: Machine[], surplus: number, shortfall: number, dt: number): number {
  if (banks.length === 0 || (surplus === 0 && shortfall === 0)) return 0;
  const charging = surplus > 0;
  const room = banks.map((m) => {
    const { capacity, rate } = MACHINES[m.type].stores!;
    const charge = m.charge ?? 0;
    return Math.max(0, Math.min(rate, (charging ? capacity - charge : charge) / dt));
  });
  const total = room.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const moved = Math.min(charging ? surplus : shortfall, total);
  banks.forEach((m, i) => {
    const kj = (room[i] / total) * moved * dt;
    const next = (m.charge ?? 0) + (charging ? kj : -kj);
    // Float drift must never leave a bank a hair outside its bounds.
    const capacity = MACHINES[m.type].stores!.capacity;
    const clamped = Math.min(capacity, Math.max(0, next));
    if (clamped > 0) m.charge = clamped;
    else delete m.charge;
  });
  return charging ? moved : -moved;
}

/**
 * How fast an electric machine may work this tick, 0 to 1. Anything that
 * runs without power always gets 1.
 */
export function powerFactor(world: World, machine: Machine): number {
  if (!MACHINES[machine.type].power) return 1;
  return layout(world).netOf.get(machine.id)?.satisfaction ?? 0;
}

/** The network a pole, generator or electric machine is on. */
export function powerNetOf(world: World, machine: Machine): PowerNet | null {
  return layout(world).netOf.get(machine.id) ?? null;
}

/** The wires strung between poles, for the renderer. */
export function powerWires(world: World): ReadonlyArray<[Machine, Machine]> {
  return layout(world).wires;
}
