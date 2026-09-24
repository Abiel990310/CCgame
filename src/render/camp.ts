import { BUILDINGS } from '@shared/data/buildings';
import { CAMP } from '@shared/sim/constants';
import type { Building } from '@shared/sim/types';
import { INK, blitCached, capsule, fillInk, litFill, rand, softShadow, tone } from './paint';

/**
 * The camp: fire, walls, storage and the few comforts around them. Timber and
 * stone, built by hand, with only the moving parts (flame, lantern glow,
 * whatever is hung up to dry) drawn live over a baked body.
 */

const WOOD = '#8a6040';
const PLANK = '#b0845a';
const IRON = '#4e5560';
const STONE = '#8e959f';
const ROPE = '#c9b07a';

export function drawCampBuilding(ctx: CanvasRenderingContext2D, building: Building, time: number): void {
  const { x, y } = building.pos;
  switch (building.type) {
    case 'campfire':
      blitCached(ctx, 'camp:campfire', x, y, { left: 24, right: 26, top: 16, bottom: 12 }, drawFirePit);
      drawFlame(ctx, x, y - 4, time, building.id);
      break;
    case 'wall': {
      const hurt = building.level < CAMP.wallHp;
      const v = building.id % 3;
      blitCached(ctx, `camp:wall:${v}:${hurt ? 1 : 0}`, x, y, { left: 22, right: 24, top: 34, bottom: 10 }, (c) =>
        drawPalisade(c, v, hurt),
      );
      if (hurt) {
        const f = building.level / CAMP.wallHp;
        ctx.fillStyle = 'rgba(14, 16, 24, 0.7)';
        ctx.beginPath();
        ctx.roundRect(x - 13, y + 7, 26, 5, 2.5);
        ctx.fill();
        ctx.fillStyle = '#e0576b';
        ctx.beginPath();
        ctx.roundRect(x - 12, y + 8, 24 * f, 3, 1.5);
        ctx.fill();
      }
      break;
    }
    case 'chest':
      blitCached(ctx, 'camp:chest', x, y, { left: 20, right: 22, top: 26, bottom: 8 }, drawChest);
      break;
    case 'workbench':
      blitCached(ctx, 'camp:workbench', x, y, { left: 24, right: 26, top: 28, bottom: 8 }, drawWorkbench);
      break;
    case 'lamp':
      blitCached(ctx, 'camp:lamp', x, y, { left: 14, right: 18, top: 42, bottom: 8 }, drawLampPost);
      drawLampGlow(ctx, x, y, time, building.id);
      break;
    case 'dryer':
      blitCached(ctx, 'camp:dryer', x, y, { left: 22, right: 24, top: 30, bottom: 8 }, drawDryerFrame);
      drawDryerLine(ctx, x, y, time, building.id);
      break;
  }
}

function drawFirePit(ctx: CanvasRenderingContext2D): void {
  softShadow(ctx, 2, 1, 20, 0.3, 8);
  // Scorched earth, then a ring of stones.
  const ash = ctx.createRadialGradient(0, -2, 1, 0, -2, 14);
  ash.addColorStop(0, '#2a211c');
  ash.addColorStop(1, 'rgba(42, 33, 28, 0)');
  ctx.fillStyle = ash;
  ctx.beginPath();
  ctx.ellipse(0, -2, 14, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const stones = 9;
  const ring = (front: boolean): void => {
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2 + 0.2;
      const sy = Math.sin(a);
      if (sy >= 0 !== front) continue;
      const sx = Math.cos(a) * 13;
      const py = -2 + sy * 6.5;
      ctx.beginPath();
      ctx.ellipse(sx, py, 3.6 + rand(i, 3), 2.8, a * 0.3, 0, Math.PI * 2);
      fillInk(ctx, litFill(ctx, STONE, sx - 3, py - 3, sx + 3, py + 3, 0.25, -0.35), 1);
    }
  };
  ring(false);

  // Logs laid in a tent, ends charred.
  const log = (x0: number, y0: number, x1: number, y1: number): void => {
    capsule(ctx, x0, y0, x1, y1, 3.6, litFill(ctx, WOOD, x0, y0 - 3, x1, y1 + 3));
    ctx.fillStyle = '#2b1d16';
    ctx.beginPath();
    ctx.arc(x1, y1, 1.8, 0, Math.PI * 2);
    ctx.fill();
  };
  log(-9, 0, -1, -5);
  log(9, 0, 1, -5);
  log(-5, 3, 1, -4);
  log(6, 3, -1, -4);
  // Embers in the bed.
  ctx.fillStyle = '#ff9a3c';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(-4 + rand(i, 8) * 8, -3 + rand(i, 9) * 3, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ring(true);
}

/** Three tongues of fire, layered hot to cool, and sparks lifting off. */
function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, id: number): void {
  const tongue = (dx: number, h: number, w: number, lean: number, inner: string, outer: string): void => {
    const tip = y - h;
    ctx.beginPath();
    ctx.moveTo(x + dx - w, y);
    ctx.bezierCurveTo(x + dx - w * 1.1, y - h * 0.45, x + dx + lean - w * 0.3, y - h * 0.7, x + dx + lean, tip);
    ctx.bezierCurveTo(x + dx + lean + w * 0.3, y - h * 0.7, x + dx + w * 1.1, y - h * 0.45, x + dx + w, y);
    ctx.quadraticCurveTo(x + dx, y + w * 0.5, x + dx - w, y);
    ctx.closePath();
    const g = ctx.createLinearGradient(x, y, x, tip);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fill();
  };

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(x, y - 4, 0, x, y - 4, 22);
  glow.addColorStop(0, 'rgba(255, 170, 70, 0.4)');
  glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 22, y - 26, 44, 44);
  ctx.restore();

  const f = (k: number): number => Math.sin(time * (7 + k) + id * 1.7 + k * 2.1);
  tongue(-3.5, 12 + f(1) * 2.5, 4, -1.5 + f(2), '#e8552a', 'rgba(200, 50, 20, 0)');
  tongue(3.5, 13 + f(3) * 2.5, 4, 1.5 + f(4), '#e8552a', 'rgba(200, 50, 20, 0)');
  tongue(0, 19 + f(5) * 3, 5.5, f(6) * 2, '#ff8a2a', 'rgba(255, 110, 30, 0.1)');
  tongue(0, 12 + f(7) * 2, 3.4, f(8) * 1.2, '#ffd15c', 'rgba(255, 200, 80, 0.3)');
  tongue(0, 6 + f(9), 2, 0, '#fff6d0', 'rgba(255, 240, 200, 0.5)');

  // Sparks drifting up and fading.
  for (let i = 0; i < 4; i++) {
    const t = (time * 0.7 + i / 4 + id * 0.13) % 1;
    const sx = x + Math.sin(t * 6 + i * 2) * 4 + (rand(id, i) - 0.5) * 6;
    const sy = y - 8 - t * 26;
    ctx.fillStyle = `rgba(255, ${Math.round(200 - t * 80)}, 90, ${1 - t})`;
    ctx.fillRect(sx - 0.7, sy - 0.7, 1.4, 1.4);
  }
}

/** Sharpened stakes lashed together on an earth bank. */
function drawPalisade(ctx: CanvasRenderingContext2D, v: number, hurt: boolean): void {
  softShadow(ctx, 3, 1, 20, 0.34, 7);
  ctx.beginPath();
  ctx.ellipse(0, -1, 17, 5.5, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, '#7a6247', -16, -6, 16, 4, 0.1, -0.3), 1.1);

  const stakes = 5;
  for (let i = 0; i < stakes; i++) {
    const sx = -12 + i * 6;
    const h = 22 + rand(v * 7 + i, 1) * 6 - (hurt && i === 1 + (v % 3) ? 8 : 0);
    const base = -1 + Math.abs(i - 2) * -0.6;
    const lean = (rand(v, i + 4) - 0.5) * 1.6;
    const wood = hurt ? tone(WOOD, -0.18) : WOOD;
    ctx.beginPath();
    ctx.moveTo(sx - 2.9, base);
    ctx.lineTo(sx - 2.9 + lean, base - h);
    ctx.lineTo(sx + lean, base - h - 5);
    ctx.lineTo(sx + 2.9 + lean, base - h);
    ctx.lineTo(sx + 2.9, base);
    ctx.closePath();
    fillInk(ctx, litFill(ctx, wood, sx - 3, base - h, sx + 3, base, 0.25, -0.35), 1.1);
    // The cut face at the point catches the light.
    ctx.beginPath();
    ctx.moveTo(sx - 2.9 + lean, base - h);
    ctx.lineTo(sx + lean, base - h - 5);
    ctx.lineTo(sx + lean, base - h + 1);
    ctx.closePath();
    ctx.fillStyle = '#d6b48a';
    ctx.fill();
    ctx.strokeStyle = tone(wood, -0.4);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sx + 0.8, base - h + 4);
    ctx.lineTo(sx + 0.6, base - 3);
    ctx.stroke();
  }
  // Two rope lashings across.
  for (const ly of [-8, -17]) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-15, ly + 1);
    ctx.quadraticCurveTo(0, ly + 2.2, 15, ly + 1);
    ctx.stroke();
    ctx.strokeStyle = ROPE;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  if (hurt) {
    ctx.strokeStyle = '#2b1d16';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.lineTo(-4, -14);
    ctx.lineTo(-6.5, -9);
    ctx.moveTo(7, -18);
    ctx.lineTo(5, -12);
    ctx.stroke();
  }
}

/** A plank chest with iron bands and a brass lock, seen from above and in front. */
function drawChest(ctx: CanvasRenderingContext2D): void {
  softShadow(ctx, 3, 1, 18, 0.36, 6);
  const w = 13;
  // Front face.
  ctx.beginPath();
  ctx.roundRect(-w, -12, w * 2, 13, [1, 1, 2, 2]);
  fillInk(ctx, litFill(ctx, tone(PLANK, -0.1), -w, -12, w, 1, 0.1, -0.35), 1.2);
  ctx.strokeStyle = tone(PLANK, -0.45);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-w, -7.5);
  ctx.lineTo(w, -7.5);
  ctx.moveTo(-w, -3);
  ctx.lineTo(w, -3);
  ctx.stroke();
  // Lid, curved and lighter.
  ctx.beginPath();
  ctx.moveTo(-w, -12);
  ctx.quadraticCurveTo(-w, -21, 0, -21);
  ctx.quadraticCurveTo(w, -21, w, -12);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, PLANK, -w, -21, w, -12, 0.25, -0.2), 1.2);
  ctx.strokeStyle = tone(PLANK, -0.35);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-w + 2, -16.5);
  ctx.lineTo(w - 2, -16.5);
  ctx.stroke();
  // Iron bands over lid and front.
  for (const bx of [-8.5, 8.5]) {
    ctx.beginPath();
    ctx.moveTo(bx - 1.6, 1);
    ctx.lineTo(bx - 1.6, -12);
    ctx.quadraticCurveTo(bx - 1.6, -20.4, bx, -20.6);
    ctx.quadraticCurveTo(bx + 1.6, -20.4, bx + 1.6, -12);
    ctx.lineTo(bx + 1.6, 1);
    ctx.closePath();
    fillInk(ctx, litFill(ctx, IRON, bx - 2, -20, bx + 2, 1, 0.3, -0.2), 0.8);
    ctx.fillStyle = '#9aa3ad';
    for (const ry of [-17, -9, -3]) {
      ctx.beginPath();
      ctx.arc(bx, ry, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Lock plate.
  ctx.beginPath();
  ctx.roundRect(-2.6, -14, 5.2, 6, 1);
  fillInk(ctx, litFill(ctx, '#e2b25a', -3, -14, 3, -8, 0.35, -0.3), 0.8);
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.arc(0, -11.6, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-0.4, -11.4, 0.8, 1.8);
}

/** A sturdy bench with a vise, a saw and a mallet on it. */
function drawWorkbench(ctx: CanvasRenderingContext2D): void {
  softShadow(ctx, 3, 1, 21, 0.34, 7);
  // Legs, back pair first.
  for (const lx of [-13, 11]) {
    ctx.beginPath();
    ctx.rect(lx, -14, 3, 12);
    fillInk(ctx, tone(WOOD, -0.3), 1);
  }
  // Stretcher rail.
  ctx.beginPath();
  ctx.rect(-12, -6, 24, 2);
  fillInk(ctx, tone(WOOD, -0.25), 0.8);
  for (const lx of [-15.5, 12.5]) {
    ctx.beginPath();
    ctx.rect(lx, -10, 3.2, 11);
    fillInk(ctx, litFill(ctx, WOOD, lx, -10, lx + 3, 1), 1);
  }
  // Top: thick planks, lit face and front edge.
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.lineTo(-15, -21);
  ctx.lineTo(17, -21);
  ctx.lineTo(19, -12);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, PLANK, -18, -21, 19, -12, 0.25, -0.15), 1.1);
  ctx.strokeStyle = tone(PLANK, -0.3);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-16.8, -15);
  ctx.lineTo(18, -15);
  ctx.moveTo(-15.8, -18);
  ctx.lineTo(17.5, -18);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-18, -12, 37, 3);
  fillInk(ctx, tone(PLANK, -0.3), 1);

  // Vise on the left end.
  ctx.beginPath();
  ctx.rect(-17, -16, 6, 5);
  fillInk(ctx, litFill(ctx, IRON, -17, -16, -11, -11, 0.35, -0.2), 0.9);
  capsule(ctx, -19, -12, -13, -12, 1, '#9aa3ad', INK, 0.6);
  // Saw lying across the top.
  ctx.beginPath();
  ctx.moveTo(-6, -19.5);
  ctx.lineTo(8, -17.5);
  ctx.lineTo(8, -15.2);
  ctx.lineTo(-6, -16.5);
  ctx.closePath();
  fillInk(ctx, '#c3ccd6', 0.8);
  ctx.beginPath();
  ctx.roundRect(8, -19, 4, 4.4, 1);
  fillInk(ctx, '#8a4b30', 0.8);
  // Mallet.
  capsule(ctx, 11, -14.5, 15, -18.8, 1.2, '#8a6038', INK, 0.6);
  ctx.beginPath();
  ctx.roundRect(13.2, -21.5, 4.6, 3, 0.8);
  fillInk(ctx, '#a07048', 0.8);
}

function drawLampPost(ctx: CanvasRenderingContext2D): void {
  softShadow(ctx, 2, 1, 10, 0.34, 4);
  // Stone footing.
  ctx.beginPath();
  ctx.ellipse(0, -1, 6, 3, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, STONE, -6, -4, 6, 2), 1);
  // Iron post with a hook arm.
  ctx.beginPath();
  ctx.rect(-1.6, -32, 3.2, 31);
  fillInk(ctx, litFill(ctx, IRON, -2, -30, 2, 0, 0.35, -0.3), 1);
  capsule(ctx, 0, -31, 7, -31, 1.4, IRON, INK, 0.8);
  // The lantern frame: cap, glass, base.
  ctx.beginPath();
  ctx.moveTo(4, -29);
  ctx.lineTo(7, -32);
  ctx.lineTo(10, -29);
  ctx.closePath();
  fillInk(ctx, IRON, 0.9);
  ctx.beginPath();
  ctx.roundRect(4.2, -29, 5.6, 8, 1);
  fillInk(ctx, '#f6d98a', 0.9);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(7, -29);
  ctx.lineTo(7, -21);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(4, -21.5, 6, 1.6);
  fillInk(ctx, IRON, 0.8);
}

function drawLampGlow(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, id: number): void {
  const k = 1 + Math.sin(time * 3 + id) * 0.08;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x + 7, y - 25, 0, x + 7, y - 25, 12 * k);
  g.addColorStop(0, 'rgba(255, 220, 140, 0.55)');
  g.addColorStop(1, 'rgba(255, 200, 110, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 6, y - 38, 26, 26);
  ctx.restore();
  ctx.fillStyle = '#fff4c8';
  ctx.beginPath();
  ctx.ellipse(x + 7, y - 24.5, 1.2, 2 * k, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDryerFrame(ctx: CanvasRenderingContext2D): void {
  softShadow(ctx, 3, 1, 20, 0.3, 6);
  for (const side of [-1, 1]) {
    const bx = side * 14;
    capsule(ctx, bx - side * 3, 1, bx + side * 1, -24, 2.4, litFill(ctx, WOOD, bx - 3, -24, bx + 3, 1));
    capsule(ctx, bx + side * 3, 1, bx + side * 1, -24, 2.2, tone(WOOD, -0.2));
  }
  capsule(ctx, -16, -23, 16, -23, 2.2, litFill(ctx, PLANK, 0, -25, 0, -21));
  // Lashings at the joints.
  ctx.fillStyle = ROPE;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 14, -23, 2, 2.4, 0, 0, Math.PI * 2);
    fillInk(ctx, ROPE, 0.7);
  }
}

/** Fish and herbs hung from the bar, turning in the breeze. */
function drawDryerLine(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, id: number): void {
  const def = BUILDINGS.dryer;
  for (let i = 0; i < 4; i++) {
    const hx = x - 10 + i * 6.6;
    const swing = Math.sin(time * 1.8 + i * 1.3 + id) * 0.18;
    const len = 5;
    const ex = hx + Math.sin(swing) * len;
    const ey = y - 22 + Math.cos(swing) * len;
    ctx.strokeStyle = '#5a4432';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(hx, y - 22);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(swing);
    if (i % 2 === 0) {
      // A fish, head down.
      ctx.beginPath();
      ctx.ellipse(0, 4.2, 2, 4.4, 0, 0, Math.PI * 2);
      fillInk(ctx, litFill(ctx, def.accent, -2, 0, 2, 8, 0.3, -0.35), 0.8);
      ctx.beginPath();
      ctx.moveTo(0, 0.4);
      ctx.lineTo(-2, -1.4);
      ctx.lineTo(2, -1.4);
      ctx.closePath();
      fillInk(ctx, tone(def.accent, -0.2), 0.7);
    } else {
      // A bundle of herbs.
      ctx.fillStyle = '#6f9a52';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.ellipse(k * 1.4, 4.5, 1.2, 3.6, k * 0.25, 0, Math.PI * 2);
        fillInk(ctx, k === 0 ? '#86b062' : '#5f8a48', 0.6);
      }
      ctx.fillStyle = ROPE;
      ctx.fillRect(-1.6, 0.5, 3.2, 1.2);
    }
    ctx.restore();
  }
}
