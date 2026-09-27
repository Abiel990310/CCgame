import { MACHINES } from '../data/machines';
import { MODULE_FLOOR, MODULES, isModule } from '../data/modules';
import { normalizeSlots } from './slots';
import type { Machine, Slot } from './types';

export interface ModuleEffects {
  /** Multiplies the machine's work rate. */
  speed: number;
  /** Share of a free craft each finished craft banks. */
  output: number;
  /** Multiplies the power it draws. */
  power: number;
}

const NONE: ModuleEffects = { speed: 1, output: 0, power: 1 };

/** What the modules in a machine add up to. A machine without any gets 1, 0, 1. */
export function moduleEffects(machine: Machine): ModuleEffects {
  if (!machine.modules) return NONE;
  let speed = 1;
  let output = 0;
  let power = 1;
  for (const slot of machine.modules) {
    const def = slot && MODULES[slot.id];
    if (!def) continue;
    speed += def.speed;
    output += def.output;
    power += def.power;
  }
  return {
    speed: Math.max(MODULE_FLOOR, speed),
    output: Math.max(0, output),
    power: Math.max(MODULE_FLOOR, power),
  };
}

/** Power a machine draws while working, in kW, after its modules. */
export function powerDraw(machine: Machine): number {
  const base = MACHINES[machine.type].power ?? 0;
  return base === 0 ? 0 : base * moduleEffects(machine).power;
}

/**
 * Bank one finished craft's worth of output bonus and say how many free
 * crafts it has paid for. Kept on the machine so the bonus survives a save and
 * comes out the same on every copy of the island.
 */
export function bankBonus(machine: Machine, output: number): number {
  if (output <= 0) return 0;
  const banked = (machine.bonus ?? 0) + output;
  const whole = Math.floor(banked + 1e-9);
  machine.bonus = banked - whole;
  return whole;
}

/**
 * A module grid sized to the table, one module per slot. Anything that is not
 * a module has no business in it and is not honoured.
 */
export function normalizeModules(raw: unknown, size: number): Slot[] {
  return normalizeSlots(raw, size, 1).map((slot) => (slot && isModule(slot.id) ? slot : null));
}
