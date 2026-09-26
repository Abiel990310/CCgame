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

/** A mob's spit: a wobbling green glob, so it never reads as the player's own fire. */
function drawSpit(ctx: CanvasRenderingContext2D, p: Projectile): void {
  const wob = Math.sin(p.life * 30) * 0.6;
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(190, 230, 90, 0.35)';
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.ellipse(0, 0, 4.6 + wob, 4.6 - wob, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, '#a6cc3e', -4, -4, 4, 4, 0.4, -0.3), 1);
  ctx.restore();
}

/**
 * A cast fireball: bigger and hotter than anything a weapon throws, with a
 * flickering tail, so a pressed spell reads apart from the automatic fire.
 */
function drawFireball(ctx: CanvasRenderingContext2D, p: Projectile): void {
  const angle = Math.atan2(p.vel.y, p.vel.x);
  const t = p.life * 40;
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
  glow.addColorStop(0, 'rgba(255, 170, 70, 0.55)');
  glow.addColorStop(1, 'rgba(255, 90, 30, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-26, -26, 52, 52);
  ctx.rotate(angle);
  // The tail: blobs shrinking and reddening behind the head, each flickering.
  for (let i = 5; i >= 1; i--) {
    const k = i / 5;
    const r = 6.5 * (1 - k * 0.7) + Math.sin(t + i * 2.1) * 0.8;
    const wob = Math.sin(t * 0.7 + i * 1.7) * 2.2 * k;
    ctx.fillStyle = `rgba(255, ${Math.round(200 - 140 * k)}, ${Math.round(80 - 60 * k)}, ${0.75 - 0.5 * k})`;
    ctx.beginPath();
    ctx.arc(-i * 4.2, wob, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ff7a2a';
  ctx.beginPath();
  ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd36a';
  ctx.beginPath();
  ctx.arc(0.8, -0.4, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  ctx.arc(1.4, -0.8, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
  if (p.weapon === 'spit') {
    drawSpit(ctx, p);
    return;
  }
  if (p.weapon === 'fireball') {
    drawFireball(ctx, p);
    return;
  }
  const def = WEAPONS[p.weapon];
  const angle = Math.atan2(p.vel.y, p.vel.x);
  // A pot of coals is a lobbed lump, not a streak.
  if (def.splash) {
    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
    glow.addColorStop(0, rgba(def.color, 0.6));
    glow.addColorStop(1, rgba(def.color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-12, -12, 24, 24);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, '#6a4a3a', -4, -4, 4, 4, 0.3, -0.3), 1);
    ctx.fillStyle = shift(def.color, 40);
    ctx.beginPath();
    ctx.arc(0, -2.4, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Longer, heavier weapons leave a longer streak.
  const long = def.pierce >= 5 ? 1.8 : 1;
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.rotate(angle);
  // A streak of light: a fading tail, a hot core, added onto the scene.
  ctx.globalCompositeOperation = 'lighter';
  const tail = ctx.createLinearGradient(4, 0, -18 * long, 0);
  tail.addColorStop(0, rgba(def.color, 0.75));
  tail.addColorStop(1, rgba(def.color, 0));
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(-18 * long, -2.2);
  ctx.lineTo(-18 * long, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(def.color, 0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = shift(def.color, 70);
  ctx.beginPath();
  ctx.ellipse(0.5, 0, 4.2 * long, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPickup(ctx: CanvasRenderingContext2D, pickup: Pickup, time: number): void {
  // Thrown clear of what dropped it: an arc up and a bounce down while it
  // settles, so a drop is seen to leave the tree rather than appear beside it.
  const hop = pickup.settle > 0 && pickup.settle < 0.45 ? Math.sin((pickup.settle / 0.45) * Math.PI) * 14 : 0;
  const bob = Math.sin(time * 4 + pickup.id) * 2 - hop;
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
