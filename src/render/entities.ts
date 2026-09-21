import { BUILDINGS } from '@shared/data/buildings';
import { ITEMS, RESOURCES } from '@shared/data/items';
import { MOBS } from '@shared/data/mobs';
import { WEAPONS } from '@shared/data/weapons';
import { PLAYER } from '@shared/sim/constants';
import { hash2 } from '@shared/sim/rng';
import type {
  Building,
  Mob,
  Pickup,
  Player,
  Projectile,
  ResourceNode,
  World,
} from '@shared/sim/types';
import { UI, rgba, shift } from './palette';
import { facetedBlob, meter, polygon, shadow } from './shapes';

export function drawNode(ctx: CanvasRenderingContext2D, node: ResourceNode, time: number): void {
  const { x, y } = node.pos;
  const depleted = node.charges <= 0;

  if (depleted) {
    drawStump(ctx, node);
    return;
  }

  const sway = Math.sin(time * 0.9 + node.seed) * 1.6;

  switch (node.kind) {
    case 'tree': {
      shadow(ctx, x, y + 4, 15);
      ctx.fillStyle = '#7a5334';
      ctx.fillRect(x - 3.5, y - 16, 7, 20);
      ctx.fillStyle = '#65442a';
      ctx.fillRect(x + 0.5, y - 16, 3, 20);
      facetedBlob(ctx, x + sway, y - 30, 19, 7, node.seed, '#4f8f4a', 0.3);
      facetedBlob(ctx, x + sway * 0.6 - 6, y - 40, 12, 6, node.seed + 5, '#5da055', 0.3);
      break;
    }
    case 'rock': {
      shadow(ctx, x, y + 3, 14);
      facetedBlob(ctx, x, y - 8, 16, 6, node.seed, '#98a0aa', 0.28);
      facetedBlob(ctx, x + 9, y - 2, 9, 5, node.seed + 3, '#848d98', 0.28);
      break;
    }
    case 'bush': {
      shadow(ctx, x, y + 3, 11);
      facetedBlob(ctx, x + sway * 0.5, y - 8, 13, 7, node.seed, '#5f9d54', 0.3);
      // Berries only when there is still something to pick.
      for (let i = 0; i < 3; i++) {
        const a = hash2(i, node.seed, 31) * Math.PI * 2;
        ctx.fillStyle = ITEMS.berry.color;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 7 + sway * 0.5, y - 8 + Math.sin(a) * 6, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fish': {
      // Concentric ripples — reads as "something lives here" without a sprite.
      for (let i = 0; i < 3; i++) {
        const t = (time * 0.5 + i / 3 + node.seed * 0.001) % 1;
        ctx.strokeStyle = rgba('#dff2fb', 0.5 * (1 - t));
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + t * 16, (6 + t * 16) * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
  }

  if (node.charges < node.maxCharges) {
    meter(ctx, x, y + 10, 26, 3.5, node.charges / node.maxCharges, UI.good);
  }
}

function drawStump(ctx: CanvasRenderingContext2D, node: ResourceNode): void {
  const { x, y } = node.pos;
  ctx.globalAlpha = 0.5;
  switch (node.kind) {
    case 'tree':
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(x - 4, y - 6, 8, 8);
      break;
    case 'rock':
      facetedBlob(ctx, x, y - 2, 8, 5, node.seed, '#7c848e', 0.25);
      break;
    case 'bush':
      facetedBlob(ctx, x, y - 4, 7, 6, node.seed, '#4a6f42', 0.25);
      break;
    case 'fish':
      ctx.strokeStyle = rgba('#dff2fb', 0.2);
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  ctx.globalAlpha = 1;
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  building: Building,
  time: number,
): void {
  const def = BUILDINGS[building.type];
  const { x, y } = building.pos;
  shadow(ctx, x, y + 3, def.radius);

  switch (building.type) {
    case 'campfire': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? '#7a5334' : '#8a5a33';
        ctx.save();
        ctx.translate(x + Math.cos(a) * 9, y + Math.sin(a) * 5);
        ctx.rotate(a);
        ctx.fillRect(-9, -2.5, 18, 5);
        ctx.restore();
      }
      const flicker = 1 + Math.sin(time * 9) * 0.12 + Math.sin(time * 14.3) * 0.06;
      polygon(ctx, x, y - 10 * flicker, 11 * flicker, 5, 7, 0.35, time * 0.7);
      ctx.fillStyle = '#f0a95c';
      ctx.fill();
      polygon(ctx, x, y - 8 * flicker, 6 * flicker, 5, 11, 0.3, -time * 0.9);
      ctx.fillStyle = '#ffe08a';
      ctx.fill();
      break;
    }
    case 'wall': {
      const hurt = building.level < 4;
      facetedBlob(ctx, x, y - 8, def.radius, 6, building.id, hurt ? '#8b939d' : def.color, 0.18);
      if (hurt) meter(ctx, x, y + 8, 24, 3, building.level / 4, UI.danger);
      break;
    }
    case 'chest': {
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.roundRect(x - 13, y - 14, 26, 18, 3);
      ctx.fill();
      ctx.fillStyle = shift(def.color, -25);
      ctx.fillRect(x - 13, y - 4, 26, 8);
      ctx.fillStyle = def.accent;
      ctx.fillRect(x - 3, y - 7, 6, 7);
      break;
    }
    case 'workbench': {
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.roundRect(x - 16, y - 14, 32, 10, 3);
      ctx.fill();
      ctx.fillStyle = def.accent;
      ctx.fillRect(x - 13, y - 4, 5, 10);
      ctx.fillRect(x + 8, y - 4, 5, 10);
      break;
    }
    case 'lamp': {
      ctx.fillStyle = def.color;
      ctx.fillRect(x - 2.5, y - 22, 5, 24);
      const glow = 1 + Math.sin(time * 3 + building.id) * 0.08;
      facetedBlob(ctx, x, y - 26, 7 * glow, 6, building.id, def.accent, 0.2);
      break;
    }
    case 'dryer': {
      ctx.fillStyle = def.color;
      ctx.fillRect(x - 15, y - 20, 4, 22);
      ctx.fillRect(x + 11, y - 20, 4, 22);
      ctx.fillRect(x - 15, y - 20, 30, 3);
      for (let i = 0; i < 3; i++) {
        const fx = x - 9 + i * 9;
        const bob = Math.sin(time * 2 + i) * 1.5;
        facetedBlob(ctx, fx, y - 10 + bob, 4.5, 5, building.id + i, def.accent, 0.25);
      }
      break;
    }
  }
}

export function drawMob(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS[mob.type];
  const { x, y } = mob.pos;
  const bounce = Math.abs(Math.sin(time * 5 + mob.seed)) * 3;

  shadow(ctx, x, y + def.radius * 0.5, def.radius * 0.9);

  const color = mob.hitFlash > 0 ? '#ffffff' : def.color;
  const cy = y - bounce;

  switch (mob.type) {
    case 'slime':
      facetedBlob(ctx, x, cy, def.radius, 7, mob.seed, color, 0.18);
      break;
    case 'crawler':
      for (let i = -1; i <= 1; i += 2) {
        ctx.strokeStyle = def.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x + i * def.radius * 1.3, cy + Math.sin(time * 10 + mob.seed) * 4 + 6);
        ctx.stroke();
      }
      facetedBlob(ctx, x, cy, def.radius, 6, mob.seed, color, 0.24);
      break;
    case 'wisp':
      ctx.globalAlpha = 0.35;
      facetedBlob(ctx, x, cy, def.radius * 1.6, 8, mob.seed + 2, color, 0.3);
      ctx.globalAlpha = 1;
      facetedBlob(ctx, x, cy, def.radius * 0.7, 6, mob.seed, '#e7e0ff', 0.2);
      break;
    case 'brute':
      facetedBlob(ctx, x, cy, def.radius, 6, mob.seed, color, 0.16);
      facetedBlob(ctx, x - def.radius * 0.5, cy - def.radius * 0.6, def.radius * 0.45, 5, mob.seed + 1, def.accent, 0.2);
      facetedBlob(ctx, x + def.radius * 0.5, cy - def.radius * 0.6, def.radius * 0.45, 5, mob.seed + 2, def.accent, 0.2);
      break;
  }

  // Eyes: two dots do more for readability than any amount of body detail.
  ctx.fillStyle = '#1b1f26';
  const eyeOffset = def.radius * 0.32;
  ctx.beginPath();
  ctx.arc(x - eyeOffset, cy - def.radius * 0.15, 2.2, 0, Math.PI * 2);
  ctx.arc(x + eyeOffset, cy - def.radius * 0.15, 2.2, 0, Math.PI * 2);
  ctx.fill();

  if (mob.hp < mob.maxHp) {
    meter(ctx, x, y - def.radius - 12, def.radius * 2.2, 3.5, mob.hp / mob.maxHp, UI.danger);
  }
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  time: number,
  isSelf: boolean,
): void {
  const { x, y } = player.pos;
  const moving = Math.hypot(player.vel.x, player.vel.y) > 20;
  const bob = moving ? Math.sin(time * 11) * 2 : Math.sin(time * 2) * 0.8;
  const cy = y - 6 + bob;

  shadow(ctx, x, y + 6, PLAYER.radius);

  if (player.downed > 0) {
    ctx.globalAlpha = 0.5;
    facetedBlob(ctx, x, y, PLAYER.radius * 1.1, 7, player.id, '#7a8390', 0.2);
    ctx.globalAlpha = 1;
    meter(ctx, x, y - 22, 34, 4, 1 - player.downed / 4, UI.good);
    return;
  }

  if (player.invuln > 0 && Math.floor(time * 14) % 2 === 0) ctx.globalAlpha = 0.55;

  const body = player.hitFlash > 0 ? '#ffffff' : isSelf ? '#5c8fd6' : '#d68f5c';
  // Cloak, then head, then a facing marker: three shapes, unmistakable silhouette.
  facetedBlob(ctx, x, cy + 4, PLAYER.radius, 6, player.id * 17, body, 0.16);
  facetedBlob(ctx, x, cy - 8, PLAYER.radius * 0.62, 6, player.id * 31, '#e8cba8', 0.14);

  ctx.fillStyle = shift(body, 30);
  ctx.beginPath();
  ctx.arc(x + player.facing.x * 9, cy + 4 + player.facing.y * 9, 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;

  if (player.hp < player.maxHp) {
    meter(ctx, x, y - 30, 32, 4, player.hp / player.maxHp, UI.danger);
  }
  if (player.gatherNodeId !== null && player.gatherProgress > 0) {
    meter(ctx, x, y + 14, 30, 4, player.gatherProgress, UI.gold);
  }
}

export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
  const def = WEAPONS[p.weapon];
  const angle = Math.atan2(p.vel.y, p.vel.x);
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y);
  ctx.rotate(angle);
  ctx.fillStyle = rgba(def.color, 0.3);
  ctx.beginPath();
  ctx.ellipse(-7, 0, 9, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPickup(ctx: CanvasRenderingContext2D, pickup: Pickup, time: number): void {
  const bob = Math.sin(time * 4 + pickup.id) * 2;
  const color = pickup.item ? ITEMS[pickup.item].color : UI.xp;
  shadow(ctx, pickup.pos.x, pickup.pos.y + 4, 5, 0.18);
  facetedBlob(ctx, pickup.pos.x, pickup.pos.y + bob, 5.5, 5, pickup.id, color, 0.25);
}

/**
 * When the local player slips behind a tree canopy, painter's-algorithm sorting
 * hides them completely. Redraw a soft silhouette on top so you are never lost.
 */
export function drawPlayerSilhouette(ctx: CanvasRenderingContext2D, player: Player): void {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#cfe2ff';
  ctx.beginPath();
  ctx.arc(player.pos.x, player.pos.y - 8, PLAYER.radius * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
