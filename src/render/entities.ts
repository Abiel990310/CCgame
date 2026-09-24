import { RESOURCES } from '@shared/data/items';
import { WEAPONS } from '@shared/data/weapons';
import type { Building, Pickup, Player, Projectile, ResourceNode, World } from '@shared/sim/types';
import { drawCampBuilding } from './camp';
import { drawMob, drawMobGlow, drawPlayer, type Tool } from './characters';
import { drawItemSprite } from './items';
import { drawNature } from './nature';
import { fillInk, litFill, softShadow } from './paint';
import { UI, rgba, shift } from './palette';

export function drawNode(ctx: CanvasRenderingContext2D, node: ResourceNode, time: number): void {
  drawNature(ctx, node, time);
}

export function drawBuilding(ctx: CanvasRenderingContext2D, building: Building, time: number): void {
  drawCampBuilding(ctx, building, time);
}

export { drawMob, drawMobGlow, drawPlayer };
export type { Tool };

export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
  const def = WEAPONS[p.weapon];
  const angle = Math.atan2(p.vel.y, p.vel.x);
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.rotate(angle);
  // A streak of light: a fading tail, a hot core, added onto the scene.
  ctx.globalCompositeOperation = 'lighter';
  const tail = ctx.createLinearGradient(4, 0, -18, 0);
  tail.addColorStop(0, rgba(def.color, 0.75));
  tail.addColorStop(1, rgba(def.color, 0));
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(-18, -2.2);
  ctx.lineTo(-18, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(def.color, 0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = shift(def.color, 70);
  ctx.beginPath();
  ctx.ellipse(0.5, 0, 4.2, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPickup(ctx: CanvasRenderingContext2D, pickup: Pickup, time: number): void {
  const bob = Math.sin(time * 4 + pickup.id) * 2;
  softShadow(ctx, pickup.pos.x, pickup.pos.y + 4, 5, 0.3);
  // An XP orb is not an item and has no row in the table: a small cut gem.
  if (!pickup.item) {
    const x = pickup.pos.x;
    const y = pickup.pos.y + bob - 1;
    const spin = Math.cos(time * 3 + pickup.id);
    const w = 3.6 * (0.55 + Math.abs(spin) * 0.45);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
    g.addColorStop(0, rgba(UI.xp, 0.5));
    g.addColorStop(1, rgba(UI.xp, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - 10, y - 10, 20, 20);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(x, y - 5.5);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x, y + 5.5);
    ctx.lineTo(x - w, y);
    ctx.closePath();
    fillInk(ctx, litFill(ctx, UI.xp, x - w, y - 5, x + w, y + 5, 0.45, -0.35), 0.9);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(x, y - 4.5);
    ctx.lineTo(x - w * 0.55, y - 0.3);
    ctx.lineTo(x, y - 1);
    ctx.closePath();
    ctx.fill();
    return;
  }
  drawItemSprite(ctx, pickup.pos.x, pickup.pos.y + bob, 6, pickup.item);
}

/**
 * When the local player slips behind a tree canopy, painter's-algorithm sorting
 * hides them completely. Draw them again, see-through, over whatever covers
 * them: the character itself is what locates you, so nothing stands in for it.
 */
export function drawPlayerSilhouette(
  ctx: CanvasRenderingContext2D,
  player: Player,
  time: number,
  tool: Tool,
): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  drawPlayer(ctx, player, time, true, tool);
  ctx.restore();
}

/** Ghosted ring marking where the camp's defended area ends. */
export function drawCampRing(ctx: CanvasRenderingContext2D, world: World, radius: number): void {
  ctx.save();
  ctx.strokeStyle = rgba(UI.gold, 0.16);
  ctx.setLineDash([12, 14]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(world.camp.x, world.camp.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export { RESOURCES };
