import { PLAYER } from '../constants';
import { damp, distance } from '../math';
import { addItem } from '../inventory';
import { grantXp } from '../progression';
import type { World } from '../types';

/**
 * Orbs scatter, settle, then get vacuumed in. The delay is what makes a kill
 * feel like it dropped something rather than silently crediting you.
 */
export function stepPickups(world: World, dt: number): void {
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const pickup = world.pickups[i];
    pickup.settle = Math.max(0, pickup.settle - dt);

    pickup.vel.x = damp(pickup.vel.x, 0, 6, dt);
    pickup.vel.y = damp(pickup.vel.y, 0, 6, dt);
    pickup.pos.x += pickup.vel.x * dt;
    pickup.pos.y += pickup.vel.y * dt;

    if (pickup.settle > 0) continue;

    let claimed = false;
    for (const player of world.players.values()) {
      if (player.downed > 0) continue;
      const radius = PLAYER.pickupRadius * player.stats.pickupRadius;
      const dist = distance(player.pos, pickup.pos);
      if (dist > radius) continue;

      if (dist > 14) {
        // Accelerate toward the player so the vacuum reads as magnetic.
        const pull = 620 * dt;
        pickup.vel.x += ((player.pos.x - pickup.pos.x) / dist) * pull;
        pickup.vel.y += ((player.pos.y - pickup.pos.y) / dist) * pull;
        continue;
      }

      if (pickup.item) addItem(player, pickup.item, pickup.count);
      if (pickup.xp > 0) grantXp(world, player, pickup.xp);
      else grantXp(world, player, 1);
      claimed = true;
      break;
    }

    if (claimed) world.pickups.splice(i, 1);
  }
}
