import type { Player, WeaponId } from './types';

/**
 * How many times a player has taken a level-up perk. Perks are counted rather
 * than folded into `stats` so each system can ask for exactly the one it
 * cares about, and so an island saved before them simply has none.
 */
export function perk(player: Player, id: string): number {
  return player.perks?.[id] ?? 0;
}

export function addPerk(player: Player, id: string): void {
  (player.perks ??= {})[id] = perk(player, id) + 1;
}

export const masteryId = (weapon: WeaponId): string => `master:${weapon}`;
