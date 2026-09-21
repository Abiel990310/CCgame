import type { BuildingId, ItemStack } from '../sim/types';

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  cost: ItemStack[];
  radius: number;
  color: string;
  accent: string;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  campfire: {
    id: 'campfire',
    name: 'Campfire',
    description: 'The heart of the camp. Mobs come for this.',
    cost: [{ id: 'wood', count: 10 }],
    radius: 18,
    color: '#8a5a33',
    accent: '#f0a95c',
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    description: 'Blocks mobs. Cheap, stackable, satisfying.',
    cost: [
      { id: 'wood', count: 4 },
      { id: 'stone', count: 2 },
    ],
    radius: 15,
    color: '#9aa4ae',
    accent: '#6f7985',
  },
  chest: {
    id: 'chest',
    name: 'Chest',
    description: 'Overflow storage for the hoard.',
    cost: [{ id: 'wood', count: 12 }],
    radius: 14,
    color: '#a4713d',
    accent: '#e8b64c',
  },
  workbench: {
    id: 'workbench',
    name: 'Workbench',
    description: 'Unlocks better gear. (Crafting arrives in a later phase.)',
    cost: [
      { id: 'wood', count: 20 },
      { id: 'stone', count: 10 },
    ],
    radius: 16,
    color: '#b08155',
    accent: '#7d5937',
  },
  lamp: {
    id: 'lamp',
    name: 'Lamp',
    description: 'Pushes back the dark. Purely lovely.',
    cost: [
      { id: 'stone', count: 6 },
      { id: 'essence', count: 1 },
    ],
    radius: 10,
    color: '#7d8894',
    accent: '#ffd98a',
  },
  dryer: {
    id: 'dryer',
    name: 'Drying Rack',
    description: 'For the fish you will absolutely catch too many of.',
    cost: [
      { id: 'wood', count: 8 },
      { id: 'fiber', count: 6 },
    ],
    radius: 15,
    color: '#a4713d',
    accent: '#5fb8d8',
  },
};

/** Order shown in the build bar. */
export const BUILD_ORDER: BuildingId[] = ['wall', 'lamp', 'chest', 'dryer', 'workbench'];
