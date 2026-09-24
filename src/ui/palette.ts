import { BUILDINGS, BUILD_ORDER } from '@shared/data/buildings';
import { BELT_COST, MACHINES, MACHINE_ORDER } from '@shared/data/machines';
import { UNLOCKED_BY, type TechDef } from '@shared/data/techs';
import { isUnlocked } from '@shared/sim/research';
import type { BuildingId, ItemStack, MachineId, World } from '@shared/sim/types';

/** What the player currently has selected in build mode. */
export type BuildSelection =
  | { kind: 'belt' }
  | { kind: 'machine'; id: MachineId }
  | { kind: 'building'; id: BuildingId };

export interface PaletteEntry {
  selection: BuildSelection;
  name: string;
  description: string;
  cost: ItemStack[];
}

export type PaletteTab = 'factory' | 'camp';

export const TABS: Array<{ id: PaletteTab; label: string }> = [
  { id: 'factory', label: 'Factory' },
  { id: 'camp', label: 'Camp' },
];

const FACTORY: PaletteEntry[] = [
  {
    selection: { kind: 'belt' },
    name: 'Belt',
    description: 'Carries items one tile at a time, in the direction it faces.',
    cost: BELT_COST,
  },
  ...MACHINE_ORDER.map((id) => ({
    selection: { kind: 'machine' as const, id },
    name: MACHINES[id].name,
    description: MACHINES[id].description,
    cost: MACHINES[id].cost,
  })),
];

const CAMP: PaletteEntry[] = BUILD_ORDER.map((id) => ({
  selection: { kind: 'building' as const, id },
  name: BUILDINGS[id].name,
  description: BUILDINGS[id].description,
  cost: BUILDINGS[id].cost,
}));

export function entriesFor(tab: PaletteTab): PaletteEntry[] {
  return tab === 'factory' ? FACTORY : CAMP;
}

export function selectionKey(selection: BuildSelection): string {
  return selection.kind === 'belt' ? 'belt' : `${selection.kind}:${selection.id}`;
}

const BY_KEY = new Map<string, PaletteEntry>(
  [...FACTORY, ...CAMP].map((entry) => [selectionKey(entry.selection), entry]),
);

/** The palette row a selection came from, whichever tab it lives on. */
export function entryFor(selection: BuildSelection): PaletteEntry | undefined {
  return BY_KEY.get(selectionKey(selection));
}

/** Which tab holds a selection, so picking one from the hotbar can show it. */
export function tabOf(selection: BuildSelection): PaletteTab {
  return selection.kind === 'building' ? 'camp' : 'factory';
}

/**
 * The tech this island still has to finish before it may build a selection,
 * or null when it may. Locked pieces stay on the palette rather than vanishing:
 * seeing the next tier is most of the reason to feed a lab.
 */
export function lockedBy(world: World, selection: BuildSelection): TechDef | null {
  if (selection.kind !== 'machine' || isUnlocked(world, selection.id)) return null;
  return UNLOCKED_BY.get(selection.id) ?? null;
}
