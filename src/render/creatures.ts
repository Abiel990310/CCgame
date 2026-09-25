import { MOBS } from '@shared/data/mobs';
import type { Mob } from '@shared/sim/types';
import { INK, capsule, fillInk, litFill, rand, softShadow, tint, tone } from './paint';

/**
 * The creatures that only come later in a run: each has to read at a glance
 * as what it does. The spitter carries its sac, the shellback its armour, the
 * warden its size.
 */

function heading(mob: Mob): { x: number; y: number } {
  const len = Math.hypot(mob.vel.x, mob.vel.y);
  if (len > 1) return { x: mob.vel.x / len, y: mob.vel.y / len };
  const a = rand(mob.seed, 3) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** A squat frog-like thing with a swollen throat sac that pulses before it spits. */
export function drawSpitter(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS.spitter;
  const r = def.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const feet = y + r * 0.45;
  const interval = def.spit!.interval;
  // The sac fills as the next shot comes due.
  const charge = 1 - Math.min(1, (mob.spitCd ?? interval) / interval);
  const hop = Math.abs(Math.sin(time * 5 + mob.seed)) * (Math.hypot(mob.vel.x, mob.vel.y) > 5 ? 3 : 0.6);

  softShadow(ctx, x, feet, r * 1.1, 0.36);
  ctx.translate(x, feet - hop);
  if (face.x < 0) ctx.scale(-1, 1);

  // Back legs folded under.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.62, -r * 0.2, r * 0.36, r * 0.24, side * 0.3, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, tone(def.accent, side < 0 ? -0.15 : -0.3), -r, -r * 0.5, r, 0), 1.1);
  }

  // Body: a low dome, belly paler.
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.62, r * 0.95, r * 0.72, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, def.color, -r, -r * 1.3, r, 0, 0.3, -0.35), 1.3);
  ctx.fillStyle = tint(tone(def.color, -0.35));
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc((rand(mob.seed, i) - 0.5) * r * 1.3, -r * (0.7 + rand(mob.seed, i + 7) * 0.5), r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  // The sac under the chin, glowing through when full.
  const sac = r * (0.34 + charge * 0.22);
  ctx.beginPath();
  ctx.ellipse(r * 0.55, -r * 0.35, sac, sac * 0.85, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(r * 0.5, -r * 0.45, 0, r * 0.55, -r * 0.35, sac);
  g.addColorStop(0, tint(tone('#e8ff9a', charge * 0.3)));
  g.addColorStop(1, tint('#9cc23a'));
  fillInk(ctx, g, 1);

  // Bulging eyes on top.
  for (const side of [-1, 1]) {
    const ex = r * 0.3 + side * r * 0.28;
    const ey = -r * 1.22;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.22, 0, Math.PI * 2);
    fillInk(ctx, tint(tone(def.color, 0.15)), 1);
    ctx.fillStyle = tint('#1c2410');
    ctx.beginPath();
    ctx.ellipse(ex + r * 0.05, ey, r * 0.09, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mouth line.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(r * 0.2, -r * 0.62);
  ctx.quadraticCurveTo(r * 0.6, -r * 0.5, r * 0.9, -r * 0.72);
  ctx.stroke();
}

/** A beetle under a heavy domed plate: the plate is what soaks the damage. */
export function drawShellback(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS.shellback;
  const r = def.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const moving = Math.hypot(mob.vel.x, mob.vel.y) > 5;
  const gait = time * (moving ? 12 : 2) + mob.seed;

  softShadow(ctx, x, y + r * 0.4, r * 1.25, 0.4);
  ctx.translate(x, y - r * 0.25);
  ctx.scale(1, 0.78);
  ctx.rotate(Math.atan2(face.y, face.x));

  // Stubby legs peeking out from under the plate.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const bx = (0.35 - i * 0.4) * r;
      const step = Math.sin(gait + i * 2 + (side > 0 ? Math.PI : 0)) * r * 0.12;
      capsule(ctx, bx, side * r * 0.5, bx + step, side * r * 1.08, 3, tint(tone(def.accent, -0.4)), INK, 1);
    }
  }

  // Head in front.
  ctx.beginPath();
  ctx.ellipse(r * 0.95, 0, r * 0.32, r * 0.36, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, tone(def.accent, -0.3), r * 0.6, -r * 0.4, r * 1.3, r * 0.4), 1.1);
  ctx.fillStyle = tint('#ffd070');
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 1.1, side * r * 0.16, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  // The plate: a thick dome with a raised rim and riveted-looking bosses.
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, 0, r * 1.02, r * 0.86, 0, 0, Math.PI * 2);
  fillInk(ctx, tint(tone(def.accent, -0.2)), 1.4);
  ctx.beginPath();
  ctx.ellipse(-r * 0.1, -r * 0.05, r * 0.86, r * 0.7, 0, 0, Math.PI * 2);
  const dome = ctx.createRadialGradient(-r * 0.4, -r * 0.35, r * 0.05, -r * 0.1, 0, r * 0.9);
  dome.addColorStop(0, tint(tone(def.color, 0.45)));
  dome.addColorStop(0.55, tint(def.color));
  dome.addColorStop(1, tint(tone(def.color, -0.4)));
  fillInk(ctx, dome, 1.1);
  ctx.strokeStyle = tint(tone(def.accent, -0.35));
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, 0);
  ctx.lineTo(r * 0.75, 0);
  ctx.moveTo(-r * 0.1, -r * 0.7);
  ctx.lineTo(-r * 0.1, r * 0.7);
  ctx.stroke();
  ctx.fillStyle = tint(tone(def.color, 0.3));
  for (const [bx, by] of [[-0.5, -0.35], [0.3, -0.35], [-0.5, 0.35], [0.3, 0.35]]) {
    ctx.beginPath();
    ctx.arc(bx * r, by * r, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.45, -r * 0.4, r * 0.3, r * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The boss: a walking cairn of stone held together by something burning
 * inside. Cracks glow brighter as it takes damage.
 */
export function drawWarden(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS.warden;
  const r = def.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const moving = Math.hypot(mob.vel.x, mob.vel.y) > 3;
  const gait = time * (moving ? 3.2 : 1) + mob.seed;
  const stomp = moving ? Math.abs(Math.sin(gait)) * 3 : 0;
  const feet = y + r * 0.4;
  const hurt = 1 - mob.hp / mob.maxHp;
  const stone = def.color;
  const ember = def.accent;

  softShadow(ctx, x, feet, r * 1.5, 0.5);
  ctx.translate(x, feet);
  if (face.x < 0) ctx.scale(-1, 1);

  // Pillar legs.
  for (const side of [-1, 1]) {
    const lift = moving ? Math.max(0, Math.sin(gait) * side) * 5 : 0;
    ctx.beginPath();
    ctx.roundRect(side * r * 0.45 - r * 0.24, -r * 0.7 - lift, r * 0.48, r * 0.7, r * 0.1);
    fillInk(ctx, litFill(ctx, tone(stone, side < 0 ? -0.15 : -0.3), -r, -r, r, 0), 1.4);
  }

  const by = -stomp;
  // Arms: stacked boulders hanging to the ground.
  for (const side of [-1, 1]) {
    const sx = side * r * 1.0;
    const sway = Math.sin(gait + (side > 0 ? Math.PI : 0)) * r * 0.1;
    for (let i = 0; i < 3; i++) {
      const cy = by - r * (1.7 - i * 0.5);
      const cr = r * (0.34 - i * 0.02) * (i === 2 ? 1.25 : 1);
      ctx.beginPath();
      ctx.arc(sx + sway * i * 0.5, cy, cr, 0, Math.PI * 2);
      fillInk(ctx, litFill(ctx, tone(stone, side < 0 ? -0.25 : -0.05), sx - cr, cy - cr, sx + cr, cy + cr), 1.3);
    }
  }

  // Torso: a heaped cairn of three slabs.
  const slabs: Array<[number, number, number, number]> = [
    [0, -0.95, 0.95, 0.5],
    [0.05, -1.55, 0.82, 0.42],
    [0.1, -2.05, 0.6, 0.36],
  ];
  for (const [ox, oy, w, h] of slabs) {
    ctx.beginPath();
    ctx.ellipse(ox * r, by + oy * r, w * r, h * r, ox * 0.4, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, stone, -w * r, by + (oy - h) * r, w * r, by + (oy + h) * r, 0.3, -0.4), 1.5);
  }
  // Moss on the shoulders.
  ctx.fillStyle = tint('#6f8a4a');
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.5 + i * r * 0.32, by - r * 1.9 + Math.abs(i - 1.5) * r * 0.08, r * 0.16, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Burning cracks, brighter the more it is hurt.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const heat = 0.45 + hurt * 0.55 + Math.sin(time * 4) * 0.08;
  ctx.strokeStyle = `rgba(255, 170, 60, ${heat})`;
  ctx.lineWidth = 1.6 + hurt * 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, by - r * 0.9);
  ctx.lineTo(-r * 0.15, by - r * 1.15);
  ctx.lineTo(r * 0.05, by - r * 0.85);
  ctx.lineTo(r * 0.45, by - r * 1.05);
  ctx.moveTo(-r * 0.2, by - r * 1.45);
  ctx.lineTo(r * 0.1, by - r * 1.65);
  ctx.lineTo(r * 0.35, by - r * 1.5);
  ctx.stroke();
  // The core, showing through the chest.
  const core = ctx.createRadialGradient(r * 0.05, by - r * 1.25, 0, r * 0.05, by - r * 1.25, r * 0.6);
  core.addColorStop(0, `rgba(255, 210, 120, ${0.5 * heat})`);
  core.addColorStop(1, 'rgba(255, 140, 40, 0)');
  ctx.fillStyle = core;
  ctx.fillRect(-r * 0.6, by - r * 1.9, r * 1.3, r * 1.3);
  ctx.restore();

  // Head: a small stone set forward, with two ember eyes.
  const hx = r * 0.35;
  const hy = by - r * 2.45;
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.34, r * 0.26, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, tone(stone, -0.05), hx - r * 0.3, hy - r * 0.3, hx + r * 0.3, hy + r * 0.3), 1.3);
  ctx.fillStyle = tint(tone(ember, 0.3));
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + r * 0.1 + side * r * 0.12, hy, r * 0.06, r * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The mother slime: a slime, bigger, with its brood visible inside. */
export function drawBrood(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const r = MOBS[mob.type].radius;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 3; i++) {
    const a = time * 0.8 + (i / 3) * Math.PI * 2 + mob.seed;
    const bx = Math.cos(a) * r * 0.35;
    const by = -r * 0.6 + Math.sin(a) * r * 0.2;
    ctx.beginPath();
    ctx.ellipse(bx, by, r * 0.18, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = tint(tone(MOBS.slime.color, -0.1));
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The Swarm Queen: a great hovering wasp-mother, her banded abdomen swollen
 * with brood. She floats a body's height off the ground, so her shadow sits
 * apart from her, and the abdomen throbs as the next call comes due.
 */
export function drawQueen(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS.queen;
  const r = def.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const hover = r * 1.1 + Math.sin(time * 2.4 + mob.seed) * 3;
  const interval = def.summons!.interval;
  const swell = 1 - Math.min(1, (mob.summonCd ?? interval) / interval);
  const body = def.color;
  const gold = def.accent;

  softShadow(ctx, x, y + r * 0.35, r * 1.2, 0.34);
  ctx.translate(x, y + r * 0.35 - hover);
  if (face.x < 0) ctx.scale(-1, 1);

  // Wings: two pairs, a blur of beats.
  const beat = Math.sin(time * 40 + mob.seed) * 0.18;
  for (const [ang, len, alpha] of [
    [-2.2 + beat, 1.7, 0.4],
    [-1.6 - beat, 1.45, 0.32],
  ] as const) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.rotate(side < 0 ? ang : -Math.PI - ang);
      ctx.beginPath();
      ctx.ellipse(r * len * 0.5, 0, r * len * 0.5, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(214, 226, 255, ${alpha})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40, 36, 60, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Abdomen trailing behind and below, banded, swelling before she calls.
  const ax = -r * 0.85;
  const ay = r * 0.25;
  const aw = r * (0.78 + swell * 0.1);
  const ah = r * (0.52 + swell * 0.08);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, aw, ah, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, body, -aw, -ah, aw, ah, 0.25, -0.4), 1.4);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = tint(gold);
  for (let i = 0; i < 3; i++) ctx.fillRect(-aw * 0.55 + i * aw * 0.45, -ah, aw * 0.16, ah * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, 0, aw, ah, 0, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Stinger.
  ctx.beginPath();
  ctx.moveTo(-aw * 0.95, -ah * 0.12);
  ctx.lineTo(-aw * 1.35, 0);
  ctx.lineTo(-aw * 0.95, ah * 0.12);
  fillInk(ctx, tint(tone(body, -0.5)), 1);
  ctx.restore();

  // Legs dangling from the thorax.
  for (let i = 0; i < 3; i++) {
    const lx = -r * 0.2 + i * r * 0.22;
    const sway = Math.sin(time * 3 + i + mob.seed) * r * 0.06;
    capsule(ctx, lx, r * 0.2, lx - r * 0.12 + sway, r * 0.72, 2.2, tint(tone(body, -0.45)));
  }

  // Thorax.
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.5, r * 0.42, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, tone(body, 0.08), -r * 0.5, -r * 0.4, r * 0.5, r * 0.4), 1.4);
  ctx.fillStyle = tint(tone(gold, -0.1));
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, -r * 0.18, r * 0.22, r * 0.09, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Head, forward, with a crown of antennae and gold compound eyes.
  const hx = r * 0.62;
  const hy = -r * 0.12;
  for (const side of [-1, 1]) {
    ctx.strokeStyle = tint(tone(body, -0.5));
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hx + r * 0.1, hy - r * 0.22);
    ctx.quadraticCurveTo(hx + r * 0.35 + side * r * 0.1, hy - r * 0.75, hx + r * 0.6 + side * r * 0.12, hy - r * 0.7);
    ctx.stroke();
    ctx.fillStyle = tint(gold);
    ctx.beginPath();
    ctx.arc(hx + r * 0.6 + side * r * 0.12, hy - r * 0.7, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.34, r * 0.3, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, tone(body, 0.12), hx - r * 0.3, hy - r * 0.3, hx + r * 0.3, hy + r * 0.3), 1.3);
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.14, hy - r * 0.04, r * 0.14, r * 0.17, 0.2, 0, Math.PI * 2);
  fillInk(ctx, tint(gold), 1);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(hx + r * 0.1, hy - r * 0.1, 1.6, 0, Math.PI * 2);
  ctx.fill();
}
