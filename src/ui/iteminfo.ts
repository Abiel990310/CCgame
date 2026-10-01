import { BUILDINGS } from '@shared/data/buildings';
import { CRAFTS } from '@shared/data/crafting';
import { ITEMS, RESOURCES } from '@shared/data/items';
import { FUEL_VALUE, MACHINES, TURRET_AMMO } from '@shared/data/machines';
import { MODULES } from '@shared/data/modules';
import { RECIPES } from '@shared/data/recipes';
import { TECHS } from '@shared/data/techs';
import { ORE_ORDER } from '@shared/sim/ore';
import type { ItemId, MachineId, ToolKind } from '@shared/sim/types';

/**
 * What the item card says about an item: what it is, what it does, where it
 * comes from and what it goes into. All of it is read off the data tables, so
 * a new recipe or machine row shows up here without anyone writing a line of
 * copy, and the card can never promise a use the island does not have.
 */
export interface ItemInfo {
  name: string;
  kind: string;
  effect: string[];
  from: string[];
  uses: string[];
}

const GATHERS: Record<ToolKind, string> = {
  axe: 'Chops trees',
  pick: 'Mines rock',
  hand: 'Picks bushes',
  rod: 'Fishes',
};

/** Most uses worth listing before the card only counts the rest. */
const USES_SHOWN = 5;

const cache = new Map<ItemId, ItemInfo>();

export function itemInfo(id: ItemId): ItemInfo {
  let info = cache.get(id);
  if (!info) {
    info = build(id);
    cache.set(id, info);
  }
  return info;
}

function build(id: ItemId): ItemInfo {
  const def = ITEMS[id];
  const machine = id in MACHINES ? MACHINES[id as MachineId] : null;
  const module = MODULES[id];
  const ammo = (TURRET_AMMO as Partial<Record<ItemId, { damage: number; pierce: number }>>)[id];
  const fuel = FUEL_VALUE[id] ?? 0;
  const ore = (ORE_ORDER as Array<ItemId | null>).includes(id);
  const science = TECHS.some((t) => t.inputs.some((i) => i.id === id));

  const effect: string[] = [];
  if (machine) effect.push(machine.description);
  if (def.tool) effect.push(`${GATHERS[def.tool.kind]} ${def.tool.speed}× as fast. Works from anywhere in the bag.`);
  if (def.bag) effect.push('Sewn onto your bag the moment it is made, for more slots.');
  if (def.leap) effect.push(`Carried, a dash can leap up to ${Math.round(def.leap / 32)} tiles, across water too.`);
  if (def.food) effect.push(`Eat with H for +${def.food} health.`);
  if (fuel > 0) effect.push(`Fuel: one keeps a burner working for ${fuel} s.`);
  if (ammo) effect.push(`Turret ammo: ${ammo.damage} damage${ammo.pierce ? `, pierces ${ammo.pierce}` : ''}.`);
  if (module) effect.push(moduleLine(module));
  if (science) effect.push('Research: labs consume it to finish techs.');

  const from = new Set<string>();
  if (ore) from.add('A miner on an ore patch');
  for (const node of Object.values(RESOURCES)) {
    if (node.drops.some((d) => d.item === id)) from.add(node.name);
  }
  if (RESOURCES.fish.drops.some((d) => d.item === id)) from.add(MACHINES.fishTrap.name);
  if (id === 'essence') from.add('Creatures');
  for (const r of RECIPES) {
    if (r.outputs.some((o) => o.id === id)) from.add(MACHINES[r.machine].name);
  }
  if (CRAFTS.some((c) => c.output === id)) from.add('Workbench');

  const uses = new Set<string>();
  for (const r of RECIPES) {
    if (r.inputs.some((i) => i.id === id)) uses.add(r.name);
  }
  for (const c of CRAFTS) {
    if (c.cost.some((p) => p.id === id)) uses.add(ITEMS[c.output].name);
  }
  for (const m of Object.values(MACHINES)) {
    if (!m.crafted && m.cost.some((p) => p.id === id)) uses.add(m.name);
  }
  for (const b of Object.values(BUILDINGS)) {
    if (b.cost.some((p) => p.id === id)) uses.add(b.name);
  }
  uses.delete(def.name);
  const list = [...uses];
  const shown = list.length > USES_SHOWN + 1 ? [...list.slice(0, USES_SHOWN), `${list.length - USES_SHOWN} more`] : list;

  return { name: def.name, kind: kindOf(id, { machine: !!machine, module: !!module, ammo: !!ammo, ore, science }), effect, from: [...from], uses: shown };
}

function kindOf(
  id: ItemId,
  is: { machine: boolean; module: boolean; ammo: boolean; ore: boolean; science: boolean },
): string {
  const def = ITEMS[id];
  if (is.machine) return 'Machine';
  if (def.tool) return 'Tool';
  if (def.bag) return 'Bag';
  if (def.leap) return 'Gear';
  if (def.food) return 'Food';
  if (is.module) return 'Module';
  if (is.ammo) return 'Ammo';
  if (is.science) return 'Science';
  if (is.ore) return 'Ore';
  if (RECIPES.some((r) => r.outputs.some((o) => o.id === id))) return 'Material';
  return 'Resource';
}

function moduleLine(m: { speed: number; output: number; power: number }): string {
  const pct = (v: number): string => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
  const parts: string[] = [];
  if (m.speed) parts.push(`${pct(m.speed)} speed`);
  if (m.output) parts.push(`${pct(m.output)} free output`);
  if (m.power) parts.push(`${pct(m.power)} power`);
  return `In a machine's module slot: ${parts.join(', ')}.`;
}
