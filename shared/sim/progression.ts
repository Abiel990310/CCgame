import { UPGRADES, toOffer } from '../data/upgrades';
import { XP } from './constants';
import type { Player, UpgradeOffer, World } from './types';

export function xpForLevel(level: number): number {
  return Math.round(XP.base * Math.pow(level, XP.exponent));
}

export function grantXp(world: World, player: Player, amount: number): void {
  player.xp += amount * player.stats.xpGain;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level += 1;
    player.xpToNext = xpForLevel(player.level);
    player.pendingUpgrades += 1;
    world.events.push({ kind: 'levelUp', playerId: player.id, level: player.level });
  }
  if (player.pendingUpgrades > 0 && player.offers.length === 0) {
    player.offers = rollOffers(world, player);
  }
}

/** Draw a distinct set of currently-applicable upgrades, without replacement. */
export function rollOffers(world: World, player: Player): UpgradeOffer[] {
  const pool = UPGRADES.filter((u) => u.available(player));
  const offers: UpgradeOffer[] = [];
  const taken = new Set<string>();

  let guard = 0;
  while (offers.length < XP.upgradeChoices && taken.size < pool.length && guard++ < 200) {
    const index = Math.floor(nextFloat(world) * pool.length);
    const def = pool[index];
    if (!def || taken.has(def.id)) continue;
    taken.add(def.id);
    offers.push(toOffer(def, player));
  }
  return offers;
}

export function chooseUpgrade(world: World, player: Player, upgradeId: string): boolean {
  if (player.pendingUpgrades <= 0) return false;
  if (!player.offers.some((o) => o.id === upgradeId)) return false;

  const def = UPGRADES.find((u) => u.id === upgradeId);
  if (!def) return false;

  def.apply(player);
  player.pendingUpgrades -= 1;
  player.offers = player.pendingUpgrades > 0 ? rollOffers(world, player) : [];
  return true;
}

/** Advance the world's own RNG stream. Kept here to avoid a circular import. */
export function nextFloat(world: World): number {
  let t = (world.rngState + 0x6d2b79f5) | 0;
  world.rngState = t;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}
