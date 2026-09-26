import { MOBS } from '@shared/data/mobs';
import { SPELLS } from '@shared/data/spells';
import { CAST_POSE } from '@shared/sim/systems/spells';
import type { Mob, Player } from '@shared/sim/types';
import {
  INK,
  around,
  blitCached,
  capsule,
  fillInk,
  litFill,
  paintFlash,
  rand,
  setFlash,
  softShadow,
  tint,
  tone,
} from './paint';
import { BITE, DASH, MELEE } from '@shared/sim/constants';
import { rgba } from './palette';
import { SWING_FRAMES, WALK_FRAMES, drawPixelDowned, drawPixelPlayer, drawPixelRoll } from './pixelplayer';
import {
  BRUTE_WALK,
  CRAWLER_STEPS as PIXEL_CRAWLER_STEPS,
  CRAWLER_TURNS as PIXEL_CRAWLER_TURNS,
  SLIME_HOPS as PIXEL_SLIME_HOPS,
  drawPixelBrute,
  drawPixelCrawler,
  drawPixelSlime,
  drawPixelWisp,
  WISP_LOOKS as PIXEL_WISP_LOOKS,
  mobAct,
  pixelSprites,
} from './pixelmobs';
import { drawBrood, drawBulwark, drawQueen, drawShellback, drawShield, drawSpitter, drawWarden } from './creatures';

/**
 * The people and creatures of the island.
 *
 * These are drawn live rather than baked, because every one of them animates
 * and there are only ever a few dozen on screen. The brute is the exception
 * (see `drawBrute`): it costs as much as the rest put together. Each is built from limbs and
 * shaded masses the way a sprite artist would block one out: a dark outline,
 * light from the upper left, and a pose that changes with what it is doing.
 */

/** What the player has in hand while harvesting, chosen from what they are working. */
export type Tool = 'axe' | 'pick' | 'hand' | 'rod' | null;

interface Outfit {
  jacket: string;
  scarf: string;
  cap: string;
}

const SELF: Outfit = { jacket: '#3e6db0', scarf: '#e8a93a', cap: '#2b3442' };
const OTHER: Outfit = { jacket: '#b8643a', scarf: '#d8d2c0', cap: '#3a2f2a' };

const SKIN = '#e6bd95';
const HAIR = '#4a3326';
const TROUSERS = '#353b49';
const BOOTS = '#2e241e';
const PACK = '#7f5634';
const BEDROLL = '#8f9a62';
const LEATHER = '#3a2a20';
const BRASS = '#e2b25a';
const LENS = '#8fd0e8';
const STEEL = '#c3ccd6';
const HANDLE = '#8a6038';

type View = 'down' | 'up' | 'side';

/** Four readable views from a facing vector; side views mirror for left. */
function viewOf(fx: number, fy: number): { view: View; flip: number } {
  if (Math.abs(fx) > Math.abs(fy) * 0.9) return { view: 'side', flip: fx < 0 ? -1 : 1 };
  return { view: fy < 0 ? 'up' : 'down', flip: 1 };
}

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  time: number,
  isSelf: boolean,
  tool: Tool = null,
): void {
  const { x, y } = player.pos;
  const feet = y + 7;
  const outfit = isSelf ? SELF : OTHER;

  if (player.downed > 0) {
    if (pixelSprites()) {
      softShadow(ctx, x, feet - 2, 16, 0.3);
      drawPixelDowned(ctx, x, feet, outfit, Math.floor(time * 1.2) % 2);
    } else drawDowned(ctx, x, feet, outfit, time);
    return;
  }

  const speed = Math.hypot(player.vel.x, player.vel.y);
  const moving = speed > 20;
  const dashing = player.dashTime > 0;
  const working = tool !== null && player.gatherProgress > 0;
  const phase = time * (dashing ? 16 : 10.5) + player.id;

  softShadow(ctx, x, feet, 10.5, 0.38);

  if (dashing) drawDashTrail(ctx, x, feet, player.vel.x, player.vel.y, outfit);

  ctx.save();
  if (player.invuln > 0 && !dashing && Math.floor(time * 14) % 2 === 0) ctx.globalAlpha *= 0.55;

  // Winding up the slam: a ring gathers at the feet, and flashes once it is ready.
  const charge = player.charge ?? 0;
  if (charge > 0.12 && player.downed <= 0) {
    const ready = charge >= MELEE.chargeTime;
    const k = Math.min(1, charge / MELEE.chargeTime);
    ctx.save();
    ctx.globalAlpha = ready ? 0.55 + 0.45 * Math.abs(Math.sin(time * 18)) : 0.25 + 0.4 * k;
    ctx.strokeStyle = ready ? '#ffd46a' : '#fff1d0';
    ctx.lineWidth = ready ? 3 : 2;
    ctx.beginPath();
    ctx.ellipse(x, feet, 8 + (MELEE.slamRadius - 8) * k, (8 + (MELEE.slamRadius - 8) * k) * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // A dodge earned a counter: a gold glint at the feet until the swing comes.
  if ((player.riposte ?? 0) > 0 && player.downed <= 0) {
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(time * 20));
    ctx.strokeStyle = '#ffd46a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, feet, 13, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (pixelSprites() && dashing) {
    // The dash is a forward roll, four quarter turns over its length.
    const through = 1 - player.dashTime / DASH.duration;
    drawPixelRoll(ctx, x, feet, outfit, Math.min(3, Math.floor(through * 4)), player.facing.x < 0);
    ctx.restore();
    return;
  }

  if (pixelSprites()) {
    // A tool or blade is swung side-on whichever way the player faces, so it reads.
    const striking = (player.strike ?? 0) > 0;
    const winding = charge > 0.12 && !striking;
    const casting = (player.casting ?? 0) > 0 && !striking && !winding;
    const facing = viewOf(player.facing.x, player.facing.y);
    const sideOn = working || striking || winding || casting;
    const view = sideOn ? 'side' : facing.view;
    const flip = sideOn ? player.facing.x < 0 : facing.flip < 0;
    // The blade enters at the top of the chop and follows through; the second
    // hit of the combo runs the other way, an upswing.
    const through = 1 - (player.strike ?? 0) / MELEE.duration;
    const cut = player.combo === 1 ? 0.95 - through * 0.35 : 0.6 + through * 0.38;
    const turn = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    drawPixelPlayer(
      ctx,
      x,
      feet,
      outfit,
      {
        view,
        flip,
        walk: moving || dashing ? Math.floor(turn * WALK_FRAMES) : -1,
        idle: Math.floor(time * 1.6 + player.id * 0.3) % 2,
        swing: striking
          ? Math.min(SWING_FRAMES - 1, Math.floor(cut * SWING_FRAMES))
          : winding
            ? 8 + (Math.floor(time * 12) % 2)
            : casting
              ? CAST_FRAME
              : working
              ? Math.floor(swingPhase(player, time) * SWING_FRAMES)
              : -1,
        tool: striking || winding ? 'blade' : working ? tool : null,
        dash: dashing,
        // A white flash for the first beat of a hit, then the recoil shows.
        flash: player.hitFlash > 0.1,
        recoil: player.hitFlash > 0 && player.hitFlash <= 0.1,
        blink: !moving && ((time * 0.35 + player.id * 0.27) % 1) < 0.035,
      },
      swingAngle,
    );
    if (casting && player.spell) drawCastGlow(ctx, x, feet, player.facing.x < 0 ? -1 : 1, player.casting ?? 0, SPELLS[player.spell].color);
    ctx.restore();
    return;
  }

  setFlash(player.hitFlash > 0 ? 1 : 0);

  const { view, flip } = viewOf(player.facing.x, player.facing.y);
  ctx.translate(x, feet);
  if (flip < 0) ctx.scale(-1, 1);
  // The whole body gives a little as the tool bites, then springs back: the
  // strike is felt in the character, not only in what it hits.
  if (working) {
    const since = swingPhase(player, time) - SWING_IMPACT;
    if (since >= 0 && since < 0.12) {
      const k = 1 - since / 0.12;
      ctx.scale(1 + 0.07 * k, 1 - 0.06 * k);
    }
  }

  const pose: Pose = {
    phase,
    moving,
    bob: moving ? -Math.abs(Math.cos(phase)) * 1.4 : Math.sin(time * 2.1 + player.id) * 0.35,
    lean: dashing ? 0.22 : moving && view === 'side' ? 0.08 : 0,
    work: working ? swingPhase(player, time) : -1,
    tool: working ? tool : null,
    time,
  };

  if (view === 'side') drawSide(ctx, outfit, pose);
  else drawFrontBack(ctx, outfit, pose, view === 'up');

  setFlash(0);
  ctx.restore();
}


interface Pose {
  phase: number;
  moving: boolean;
  bob: number;
  /** Forward lean in radians: a stride leans a little, a dash a lot. */
  lean: number;
  /** 0..1 through a tool swing, or -1 when not working. */
  work: number;
  tool: Tool;
  time: number;
}

/** Swings a second while working; the strike lands at `SWING_IMPACT` of each. */
const SWING_RATE = 2.4;
/** Where in a swing the tool meets the tree, as a fraction of the swing. */
export const SWING_IMPACT = 0.78;

/** How far through its current swing a working player is, 0..1. */
export function swingPhase(player: Player, time: number): number {
  return (time * SWING_RATE + player.id * 0.37) % 1;
}

/**
 * A chop in three beats, the way an animator would time it: a wind-up over
 * the shoulder, a held beat at the top so the strike is anticipated, a fast
 * strike that follows through past rest, and a short recovery. Returned as
 * the arm's angle from hanging straight down, forward positive.
 */
function swingAngle(t: number): number {
  const rest = 0.5;
  const top = 3.35;
  const through = 0.15;
  if (t < 0.5) {
    const k = t / 0.5;
    return rest + (top - rest) * (1 - (1 - k) * (1 - k));
  }
  if (t < 0.62) return top + 0.12 * Math.sin(((t - 0.5) / 0.12) * Math.PI * 0.5);
  if (t < SWING_IMPACT) {
    const k = (t - 0.62) / (SWING_IMPACT - 0.62);
    return top + 0.12 - (top + 0.12 - through) * k * k;
  }
  const k = (t - SWING_IMPACT) / (1 - SWING_IMPACT);
  return through + (rest - through) * (1 - (1 - k) * (1 - k));
}

// ─── Side view ──────────────────────────────────────────────────────────────

function drawSide(ctx: CanvasRenderingContext2D, outfit: Outfit, pose: Pose): void {
  const { phase, moving, bob } = pose;
  const stride = moving ? Math.sin(phase) * 0.62 : 0;
  const hipY = -10.5 + bob;

  // Far leg and far arm sit behind the body, a shade darker.
  drawSideLeg(ctx, 0, hipY, -stride, true);

  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(pose.lean);
  ctx.translate(0, -hipY);

  const shoulderY = -19.6 + bob;
  const farArm = moving ? -Math.sin(phase) * 0.75 : 0.12;
  drawSideArm(ctx, 0.2, shoulderY, farArm, outfit, true, null);

  // Backpack behind, then the bedroll strapped on top of it.
  ctx.beginPath();
  ctx.roundRect(-9, -21.5 + bob, 6.4, 11.5, 2.2);
  fillInk(ctx, litFill(ctx, PACK, -9, -21, -2.6, -10));
  ctx.fillStyle = tint(tone(PACK, -0.3));
  ctx.fillRect(-8.2, -15.5 + bob, 4.8, 1.3);
  ctx.beginPath();
  ctx.ellipse(-6.4, -22.4 + bob, 3.1, 2.6, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, BEDROLL, -9, -25, -3.5, -20));
  ctx.strokeStyle = tint(tone(BEDROLL, -0.35));
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(-6.4, -22.4 + bob, 1.4, 0.4, Math.PI * 1.7);
  ctx.stroke();

  // Torso.
  ctx.beginPath();
  ctx.moveTo(-3.6, -21 + bob);
  ctx.quadraticCurveTo(1, -23 + bob, 4.4, -20.4 + bob);
  ctx.lineTo(4.6, -10.4 + bob);
  ctx.quadraticCurveTo(0.4, -8.8 + bob, -3.9, -10.2 + bob);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, outfit.jacket, -4, -22, 5, -9));
  // Pocket flap and belt.
  ctx.fillStyle = tint(tone(outfit.jacket, -0.22));
  ctx.fillRect(0.6, -16.4 + bob, 3, 2.2);
  ctx.fillStyle = tint(LEATHER);
  ctx.fillRect(-3.9, -12.4 + bob, 8.5, 2.1);
  ctx.fillStyle = tint(BRASS);
  ctx.fillRect(2.6, -12.2 + bob, 1.7, 1.7);
  // Pack strap over the shoulder.
  capsule(ctx, -1.8, -20.6 + bob, 0.2, -12.8 + bob, 1.3, tint(LEATHER), null);

  drawScarf(ctx, outfit, pose, 'side');
  drawSideHead(ctx, outfit, bob);

  const nearArm = pose.work >= 0 ? swingAngle(pose.work) : moving ? Math.sin(phase) * 0.75 : 0.1;
  drawSideArm(ctx, 0.4, shoulderY, nearArm, outfit, false, pose.tool);

  ctx.restore();

  drawSideLeg(ctx, 0.4, hipY, stride, false);
}

function drawSideLeg(ctx: CanvasRenderingContext2D, x: number, hipY: number, angle: number, far: boolean): void {
  const len = 9.2;
  // The leg swinging back lifts its foot, which is what makes a stride read.
  const lift = angle < 0 ? -angle * 2.2 : 0;
  const fx = x + Math.sin(angle) * len * 0.8;
  const fy = Math.min(0, hipY + Math.cos(angle) * len) - lift;
  const cloth = far ? tone(TROUSERS, -0.25) : TROUSERS;
  capsule(ctx, x, hipY, fx, fy - 2.4, 3.9, tint(cloth));
  ctx.beginPath();
  ctx.roundRect(fx - 2.4, fy - 3.8, 6, 3.8, [1.4, 2, 1.2, 1.2]);
  fillInk(ctx, tint(far ? tone(BOOTS, -0.2) : BOOTS));
  ctx.fillStyle = tint(tone(BOOTS, 0.25));
  ctx.fillRect(fx - 2.2, fy - 1, 5.6, 0.9);
}

function drawSideArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  angle: number,
  outfit: Outfit,
  far: boolean,
  tool: Tool,
): void {
  const len = 8.4;
  const hx = sx + Math.sin(angle) * len;
  const hy = sy + Math.cos(angle) * len;
  if (tool && tool !== 'hand') drawTool(ctx, hx, hy, angle, tool);
  const sleeve = far ? tone(outfit.jacket, -0.32) : tone(outfit.jacket, -0.08);
  capsule(ctx, sx, sy, sx + (hx - sx) * 0.82, sy + (hy - sy) * 0.82, 3.4, tint(sleeve));
  ctx.beginPath();
  ctx.arc(hx, hy, 1.9, 0, Math.PI * 2);
  fillInk(ctx, tint(far ? tone(SKIN, -0.18) : SKIN), 1);
}

function drawSideHead(ctx: CanvasRenderingContext2D, outfit: Outfit, bob: number): void {
  const cx = 0.8;
  const cy = -27.6 + bob;
  // Hair at the nape, under the cap.
  ctx.beginPath();
  ctx.ellipse(cx - 2.6, cy + 0.6, 3.4, 4, 0, 0, Math.PI * 2);
  fillInk(ctx, tint(HAIR));
  ctx.beginPath();
  ctx.ellipse(cx, cy, 5.3, 5.5, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, SKIN, cx - 5, cy - 5, cx + 5, cy + 5, 0.15, -0.2));
  // Nose and ear.
  ctx.fillStyle = tint(tone(SKIN, -0.12));
  ctx.beginPath();
  ctx.ellipse(cx + 5.2, cy + 0.9, 1.1, 1.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - 1.4, cy + 0.9, 1.2, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eye.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(cx + 2.9, cy + 0.4, 0.8, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  drawCap(ctx, outfit, cx, cy, 'side');
}

// ─── Front and back views ───────────────────────────────────────────────────

function drawFrontBack(ctx: CanvasRenderingContext2D, outfit: Outfit, pose: Pose, back: boolean): void {
  const { phase, moving, bob } = pose;
  const hipY = -10.2 + bob;

  for (const side of [-1, 1]) {
    const lift = moving ? Math.max(0, Math.sin(phase) * side) * 2.6 : 0;
    const fx = side * 2.8;
    capsule(ctx, side * 2.5, hipY, fx, -2.4 - lift, 3.9, tint(side < 0 ? TROUSERS : tone(TROUSERS, -0.12)));
    ctx.beginPath();
    ctx.roundRect(fx - 2.9, -3.8 - lift, 5.8, 3.8, 1.6);
    fillInk(ctx, tint(BOOTS));
    ctx.fillStyle = tint(tone(BOOTS, 0.25));
    ctx.fillRect(fx - 2.5, -1 - lift, 5, 0.9);
  }

  // From the front the pack shows only at the shoulders, behind everything.
  if (!back) {
    ctx.beginPath();
    ctx.roundRect(-7.4, -21.2 + bob, 14.8, 8, 2.5);
    fillInk(ctx, tint(tone(PACK, -0.25)));
  }

  const shoulderY = -19.4 + bob;
  const swing = moving ? Math.sin(phase) * 1.8 : 0;

  // Torso.
  ctx.beginPath();
  ctx.moveTo(-6.3, -20.4 + bob);
  ctx.quadraticCurveTo(0, -23.2 + bob, 6.3, -20.4 + bob);
  ctx.lineTo(5.7, -10 + bob);
  ctx.quadraticCurveTo(0, -8.3 + bob, -5.7, -10 + bob);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, outfit.jacket, -6, -22, 6, -9));

  if (back) {
    // Pack, flap, and the bedroll across its top.
    ctx.beginPath();
    ctx.roundRect(-4.9, -20 + bob, 9.8, 10.2, 2.2);
    fillInk(ctx, litFill(ctx, PACK, -5, -20, 5, -10));
    ctx.beginPath();
    ctx.roundRect(-4.9, -20 + bob, 9.8, 4.2, [2.2, 2.2, 1, 1]);
    fillInk(ctx, tint(tone(PACK, 0.12)), 0.9);
    ctx.fillStyle = tint(BRASS);
    ctx.fillRect(-0.8, -16.6 + bob, 1.6, 1.6);
    capsule(ctx, -6.2, -21.2 + bob, 6.2, -21.2 + bob, 3.4, litFill(ctx, BEDROLL, 0, -23, 0, -19));
  } else {
    // Zip, pack straps and belt.
    ctx.strokeStyle = tint(tone(outfit.jacket, -0.35));
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -20 + bob);
    ctx.lineTo(0, -10.6 + bob);
    ctx.stroke();
    capsule(ctx, -3.6, -20.8 + bob, -3.3, -12.6 + bob, 1.4, tint(LEATHER), null);
    capsule(ctx, 3.6, -20.8 + bob, 3.3, -12.6 + bob, 1.4, tint(LEATHER), null);
    ctx.fillStyle = tint(LEATHER);
    ctx.fillRect(-5.7, -12.2 + bob, 11.4, 2.1);
    ctx.fillStyle = tint(BRASS);
    ctx.fillRect(-1, -12.1 + bob, 2, 1.9);
  }

  drawScarf(ctx, outfit, pose, back ? 'up' : 'down');

  // Arms at the sides; the right one carries the tool.
  const work = pose.work >= 0 ? swingAngle(pose.work) : -1;
  for (const side of [-1, 1]) {
    const sx = side * 6.1;
    const sleeve = tone(outfit.jacket, side < 0 ? -0.04 : -0.2);
    let hx = sx + side * 0.9;
    let hy = shoulderY + 8 + (back ? -swing : swing) * side * 0.5;
    const holding = side > 0 && work >= 0;
    if (holding) {
      // Seen head-on, a chop is the hand rising and falling.
      hy = shoulderY + Math.cos(work) * 8;
      hx = sx + Math.sin(work) * 1.5;
      if (pose.tool && pose.tool !== 'hand' && !back) drawTool(ctx, hx, hy, Math.PI - work * 0.35, pose.tool);
    }
    capsule(ctx, sx, shoulderY, hx, hy - 1, 3.4, tint(sleeve));
    ctx.beginPath();
    ctx.arc(hx, hy, 1.9, 0, Math.PI * 2);
    fillInk(ctx, tint(SKIN), 1);
    if (holding && back && pose.tool && pose.tool !== 'hand') drawTool(ctx, hx, hy, Math.PI - work * 0.35, pose.tool);
  }

  const cy = -27.6 + bob;
  if (back) {
    ctx.beginPath();
    ctx.ellipse(0, cy, 5.8, 5.6, 0, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, HAIR, -5, cy - 5, 5, cy + 5, 0.12, -0.3));
  } else {
    ctx.beginPath();
    ctx.ellipse(0, cy, 5.7, 5.6, 0, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, SKIN, -5, cy - 5, 5, cy + 5, 0.15, -0.22));
    // Hair showing at the temples.
    ctx.fillStyle = tint(HAIR);
    ctx.beginPath();
    ctx.ellipse(-4.6, cy - 0.5, 1.5, 2.4, 0.2, 0, Math.PI * 2);
    ctx.ellipse(4.6, cy - 0.5, 1.5, 2.4, -0.2, 0, Math.PI * 2);
    ctx.fill();
    // Eyes, with a catchlight so they read as looking at you.
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(-2.1, cy + 0.8, 0.85, 1.25, 0, 0, Math.PI * 2);
    ctx.ellipse(2.1, cy + 0.8, 0.85, 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(-2.4, cy + 0.1, 0.55, 0.55);
    ctx.fillRect(1.8, cy + 0.1, 0.55, 0.55);
    ctx.fillStyle = tint('#d98c78');
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    ctx.ellipse(-3.3, cy + 2.4, 1.2, 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(3.3, cy + 2.4, 1.2, 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha /= 0.35;
  }
  drawCap(ctx, outfit, 0, cy, back ? 'up' : 'down');
}

function drawScarf(ctx: CanvasRenderingContext2D, outfit: Outfit, pose: Pose, view: View): void {
  const y = -21 + pose.bob;
  const flutter = Math.sin(pose.time * (pose.moving ? 12 : 3)) * (pose.moving ? 1.2 : 0.4);
  const scarf = outfit.scarf;
  if (view === 'side') {
    // The tail streams out behind when moving.
    const trail = pose.moving ? 5.5 : 2;
    ctx.beginPath();
    ctx.moveTo(-2.4, y - 0.8);
    ctx.quadraticCurveTo(-2.4 - trail * 0.6, y + 1 + flutter, -2.8 - trail, y + 3 + flutter);
    ctx.lineTo(-1.6 - trail, y + 4.8 + flutter);
    ctx.quadraticCurveTo(-1.8, y + 3, -0.6, y + 1.4);
    ctx.closePath();
    fillInk(ctx, tint(tone(scarf, -0.15)), 0.9);
  }
  ctx.beginPath();
  ctx.ellipse(view === 'side' ? 0.6 : 0, y, view === 'side' ? 3.8 : 4.8, 2.1, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, scarf, -4, y - 2, 4, y + 2), 0.9);
  if (view === 'down') {
    ctx.beginPath();
    ctx.moveTo(1.2, y + 1);
    ctx.lineTo(3.2 + flutter * 0.3, y + 6);
    ctx.lineTo(1.2 + flutter * 0.3, y + 6.4);
    ctx.lineTo(0, y + 1.4);
    ctx.closePath();
    fillInk(ctx, tint(tone(scarf, -0.12)), 0.9);
  }
}

/** A work cap with brass-rimmed goggles pushed up on it: the engineer's badge. */
function drawCap(ctx: CanvasRenderingContext2D, outfit: Outfit, cx: number, cy: number, view: View): void {
  const cap = outfit.cap;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1.4, 6.1, 5.1, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, cap, cx - 6, cy - 7, cx + 6, cy - 1, 0.28, -0.25));

  if (view === 'side') {
    ctx.beginPath();
    ctx.ellipse(cx + 5.6, cy - 1.7, 3.6, 1.1, 0.1, 0, Math.PI * 2);
    fillInk(ctx, tint(tone(cap, -0.2)), 0.9);
    ctx.fillStyle = tint(LEATHER);
    ctx.fillRect(cx - 5.4, cy - 4.4, 10.4, 1.3);
    ctx.beginPath();
    ctx.ellipse(cx + 2.6, cy - 4.2, 1.9, 1.7, 0, 0, Math.PI * 2);
    fillInk(ctx, tint(BRASS), 0.8);
    ctx.fillStyle = tint(LENS);
    ctx.beginPath();
    ctx.ellipse(cx + 2.8, cy - 4.2, 1.1, 1, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.fillStyle = tint(LEATHER);
  ctx.fillRect(cx - 5.9, cy - 4.6, 11.8, 1.3);
  if (view === 'up') return;

  ctx.beginPath();
  ctx.ellipse(cx, cy - 1.4, 6.5, 1.5, 0, 0, Math.PI);
  fillInk(ctx, tint(tone(cap, -0.18)), 0.9);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * 2.3, cy - 4.1, 1.85, 0, Math.PI * 2);
    fillInk(ctx, tint(BRASS), 0.8);
    ctx.fillStyle = tint(LENS);
    ctx.beginPath();
    ctx.arc(cx + side * 2.3, cy - 4.1, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cx + side * 2.3 - 0.8, cy - 4.8, 0.6, 0.6);
  }
}

/** The tool in hand, drawn along the arm's line so it follows the swing. */
function drawTool(ctx: CanvasRenderingContext2D, hx: number, hy: number, angle: number, tool: Tool): void {
  const dx = Math.sin(angle);
  const dy = Math.cos(angle);
  const len = tool === 'rod' ? 16 : 9.5;
  const ex = hx + dx * len;
  const ey = hy + dy * len;
  capsule(ctx, hx - dx * 1.5, hy - dy * 1.5, ex, ey, 1.5, tint(HANDLE), INK, 0.8);

  // Perpendicular to the handle, pointing the way the blow travels.
  const px = dy;
  const py = -dx;
  if (tool === 'axe') {
    ctx.beginPath();
    ctx.moveTo(ex - dx * 0.6 - px * 0.6, ey - dy * 0.6 - py * 0.6);
    ctx.lineTo(ex + px * 4.2 - dx * 2.4, ey + py * 4.2 - dy * 2.4);
    ctx.quadraticCurveTo(ex + px * 5.2 + dx * 0.8, ey + py * 5.2 + dy * 0.8, ex + px * 4 + dx * 2.6, ey + py * 4 + dy * 2.6);
    ctx.lineTo(ex + dx * 0.9 - px * 0.6, ey + dy * 0.9 - py * 0.6);
    ctx.closePath();
    fillInk(ctx, tint(STEEL), 0.9);
  } else if (tool === 'pick') {
    ctx.beginPath();
    ctx.moveTo(ex - px * 5.2 - dx * 1.6, ey - py * 5.2 - dy * 1.6);
    ctx.quadraticCurveTo(ex + dx * 1.6, ey + dy * 1.6, ex + px * 5.2 - dx * 1.6, ey + py * 5.2 - dy * 1.6);
    ctx.quadraticCurveTo(ex + dx * 0.2, ey + dy * 0.2, ex - px * 5.2 - dx * 1.6, ey - py * 5.2 - dy * 1.6);
    fillInk(ctx, tint(STEEL), 0.9);
  } else if (tool === 'rod') {
    ctx.strokeStyle = 'rgba(230, 240, 250, 0.6)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.quadraticCurveTo(ex + px * 6, ey + 6, ex + px * 8, ey + 14);
    ctx.stroke();
  }
}

function drawDashTrail(ctx: CanvasRenderingContext2D, x: number, feet: number, vx: number, vy: number, outfit: Outfit): void {
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 5;
    const sx = x - uy * off;
    const sy = feet - 14 + ux * off;
    const g = ctx.createLinearGradient(sx, sy, sx - ux * 26, sy - uy * 26);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = i === 1 ? 2.6 : 1.6;
    ctx.beginPath();
    ctx.moveTo(sx - ux * 6, sy - uy * 6);
    ctx.lineTo(sx - ux * 28, sy - uy * 28);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = outfit.jacket;
  ctx.beginPath();
  ctx.ellipse(x - ux * 12, feet - 14 - uy * 12, 6, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Knocked out: lying on the ground, greyed, waiting to get back up. */
function drawDowned(ctx: CanvasRenderingContext2D, x: number, feet: number, outfit: Outfit, time: number): void {
  softShadow(ctx, x, feet - 2, 15, 0.3);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.translate(x - 12, feet - 4);
  ctx.rotate(-Math.PI / 2);
  const pose: Pose = { phase: 0, moving: false, bob: Math.sin(time * 1.5) * 0.3, lean: 0, work: -1, tool: null, time };
  const grey: Outfit = { jacket: tone(outfit.jacket, -0.25), scarf: tone(outfit.scarf, -0.3), cap: outfit.cap };
  drawSide(ctx, grey, pose);
  ctx.restore();
}

// ─── Creatures ──────────────────────────────────────────────────────────────

/** A creature faces where it is going, or keeps a seeded heading when still. */
function heading(mob: Mob): { x: number; y: number } {
  if (mob.look !== undefined) return { x: Math.cos(mob.look), y: Math.sin(mob.look) };
  const len = Math.hypot(mob.vel.x, mob.vel.y);
  if (len > 1) return { x: mob.vel.x / len, y: mob.vel.y / len };
  const a = rand(mob.seed, 3) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function drawMob(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS[mob.type];
  // Rearing back to bite: a red mark on the ground grows under it and the
  // body blanches and draws up, so the bite is seen coming.
  const windup = mob.windup ?? 0;
  const rear = windup > 0 ? 1 - windup / BITE.windup : 0;
  if (windup > 0) {
    const feet = mob.pos.y + def.radius * 0.6;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.5 * rear;
    ctx.strokeStyle = '#ff5a4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(mob.pos.x, feet, def.radius * (0.9 + 0.5 * rear), def.radius * (0.9 + 0.5 * rear) * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if ((mob.chill ?? 0) > 0) drawFrost(ctx, mob, time, true);
  setFlash(mob.hitFlash > 0 ? 1 : 0);
  ctx.save();
  // Pixel creatures have their own rearing and flash frames; stretching a
  // frame would smear its pixels.
  const baked = pixelSprites() && PIXEL_MOBS.has(mob.type);
  if (windup > 0 && !baked) {
    const feet = mob.pos.y + def.radius * 0.6;
    ctx.translate(mob.pos.x, feet);
    ctx.scale(1 - 0.08 * rear, 1 + 0.12 * rear);
    ctx.translate(-mob.pos.x, -feet);
  }
  // A hit squashes the body flat about its feet and lets it spring back, so a
  // shot is seen to land even in a crowd where the flash is lost.
  if (mob.hitFlash > 0 && !baked) {
    const k = mob.hitFlash / 0.12;
    const feet = mob.pos.y + def.radius * 0.6;
    ctx.translate(mob.pos.x, feet);
    ctx.scale(1 + 0.16 * k, 1 - 0.14 * k);
    ctx.translate(-mob.pos.x, -feet);
  }
  switch (mob.type) {
    case 'slime':
    case 'mother':
      drawSlime(ctx, mob, time);
      break;
    case 'spitter':
      drawSpitter(ctx, mob, time);
      break;
    case 'shellback':
      drawShellback(ctx, mob, time);
      break;
    case 'warden':
      drawWarden(ctx, mob, time);
      break;
    case 'queen':
      drawQueen(ctx, mob, time);
      break;
    case 'bulwark':
      drawBulwark(ctx, mob, time);
      break;
    case 'crawler':
      drawCrawler(ctx, mob, time);
      break;
    case 'wisp':
      drawWisp(ctx, mob, time);
      break;
    case 'brute':
      drawBrute(ctx, mob, time);
      break;
  }
  ctx.restore();
  setFlash(0);
  if (mob.shield !== undefined) drawShield(ctx, mob, time);
  if ((mob.chill ?? 0) > 0) drawFrost(ctx, mob, time, false);

  const tall = mob.type === 'brute' ? 2.9 : mob.type === 'wisp' ? 3 : mob.type === 'warden' ? 3.2 : mob.type === 'queen' ? 3.4 : mob.type === 'bulwark' ? 3.3 : 2.1;
  if (mob.hp < mob.maxHp) healthBar(ctx, mob.pos.x, mob.pos.y - def.radius * tall, def.radius * 2.2, mob.hp / mob.maxHp);

  // A mark over its head as well, since a crowd hides the ground; white in
  // the last half, when it is about to land.
  if (windup > 0) {
    const top = mob.pos.y - def.radius * tall - 16;
    ctx.fillStyle = '#1a0d10';
    ctx.fillRect(mob.pos.x - 2.5, top - 1, 5, 12);
    ctx.fillStyle = rear > 0.5 ? '#ffffff' : '#ff5a4a';
    ctx.fillRect(mob.pos.x - 1.5, top, 3, 6);
    ctx.fillRect(mob.pos.x - 1.5, top + 7.5, 3, 2.5);
  }
}

/**
 * A chilled creature stands on a patch of frost with ice glinting on it, so
 * a slow is seen rather than only felt. It thaws out as the chill runs down.
 */
function drawFrost(ctx: CanvasRenderingContext2D, mob: Mob, time: number, ground: boolean): void {
  const r = MOBS[mob.type].radius;
  const fade = Math.min(1, (mob.chill ?? 0) / 0.5);
  const feet = mob.pos.y + r * 0.6;
  ctx.save();
  if (!ground) {
    glints(ctx, mob, r, fade, time);
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 0.5 * fade;
  ctx.fillStyle = '#d8f4ff';
  ctx.beginPath();
  ctx.ellipse(mob.pos.x, feet, r * 1.15, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9 * fade;
  ctx.strokeStyle = '#9fe3ff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** A few glints of ice over the body, each twinkling on its own beat. */
function glints(ctx: CanvasRenderingContext2D, mob: Mob, r: number, fade: number, time: number): void {
  ctx.globalAlpha = fade;
  for (let i = 0; i < 4; i++) {
    const a = mob.seed * 7 + i * 1.9;
    const x = mob.pos.x + Math.cos(a) * r * 0.8;
    const y = mob.pos.y - r * 0.4 + Math.sin(a * 1.3) * r * 0.7;
    const s = 2.2 * (0.5 + 0.5 * Math.sin(time * 5 + i * 2.3));
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#bfefff';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.6);
    ctx.lineTo(x + s * 0.6, y);
    ctx.lineTo(x, y + s * 1.6);
    ctx.lineTo(x - s * 0.6, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** The swing frame whose arm reaches forward and a little up: the hand a spell leaves from. */
const CAST_FRAME = 2;

/** Light gathered in the casting hand, flaring as the spell leaves it. */
function drawCastGlow(ctx: CanvasRenderingContext2D, x: number, feet: number, dir: number, left: number, color: string): void {
  const k = left / CAST_POSE;
  const hx = x + dir * 11;
  const hy = feet - 23;
  const r = 5 + 9 * k;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
  g.addColorStop(0, rgba('#ffffff', 0.9 * k));
  g.addColorStop(0.35, rgba(color, 0.7 * k));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
  ctx.restore();
}

/** Creatures drawn as pixel sprites when the player is. */
const PIXEL_MOBS = new Set<Mob['type']>(['slime', 'crawler', 'brute', 'spitter', 'shellback', 'wisp', 'mother', 'warden', 'queen', 'bulwark']);


/** A slim framed bar: the enemy's health, readable without shouting. */
function healthBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, f: number): void {
  const h = 3.2;
  ctx.fillStyle = 'rgba(14, 16, 24, 0.75)';
  ctx.beginPath();
  ctx.roundRect(x - width / 2 - 1, y - 1, width + 2, h + 2, 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#ff7a86');
  g.addColorStop(1, '#c23848');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y, width * Math.max(0, Math.min(1, f)), h, 1.5);
  ctx.fill();
}

/** Hop phases and looking directions a slime is baked at. */
const SLIME_HOPS = 12;
const SLIME_LOOKS = 8;

/** Where a slime is in its hop: crouch, spring, hang, land. */
function slimeHop(p: number): { air: number; lift: number; sx: number; sy: number } {
  const air = p > 0.15 && p < 0.85 ? Math.sin(((p - 0.15) / 0.7) * Math.PI) : 0;
  const ground = p < 0.15 ? 1 - p / 0.15 : p > 0.85 ? (p - 0.85) / 0.15 : 0;
  return { air, lift: air * 7, sx: 1 + ground * 0.16 - air * 0.07, sy: 1 - ground * 0.16 + air * 0.1 };
}

/**
 * Slimes are baked per hop phase, the way they look and hit flash: a raid
 * brings a crowd of them, and each traced live cost about 0.15 ms on a CPU
 * canvas. A mother is baked in two layers with her brood drawn live between.
 */
function drawSlime(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const r = MOBS[mob.type].radius;
  const { x, y } = mob.pos;
  const base = y + r * 0.45;
  const face = heading(mob);
  const p = (time * 1.25 + rand(mob.seed, 1)) % 1;

  const step = Math.floor(p * SLIME_HOPS) % SLIME_HOPS;
  const look = (Math.round((Math.atan2(face.y, face.x) / (Math.PI * 2)) * SLIME_LOOKS) + SLIME_LOOKS) % SLIME_LOOKS;
  const phase = (step + 0.5) / SLIME_HOPS;
  const hop = slimeHop(phase);
  softShadow(ctx, x, base, r * (1.05 - hop.air * 0.25), 0.36 - hop.air * 0.12);
  const a = (look / SLIME_LOOKS) * Math.PI * 2;
  const eyes = { x: Math.cos(a), y: Math.sin(a) };
  const flash = paintFlash() > 0 ? 1 : 0;
  if (pixelSprites()) {
    const hopStep = Math.floor(p * PIXEL_SLIME_HOPS) % PIXEL_SLIME_HOPS;
    const pixelLook = (Math.round((Math.atan2(face.y, face.x) / (Math.PI * 2)) * SLIME_LOOKS) + SLIME_LOOKS) % SLIME_LOOKS;
    drawPixelSlime(ctx, mob.type === 'mother' ? 'mother' : 'slime', x, base, mobAct(mob, true), hopStep, pixelLook, flash > 0);
    return;
  }
  const box = { left: r * 1.3, right: r * 1.3, top: r * 1.9 + 8, bottom: r * 0.5 };

  if (mob.type !== 'mother') {
    blitCached(ctx, `slime:${mob.type}:${step}:${look}:${flash}`, x, base, box, (c) =>
      drawSlimeBody(c, mob.type, hop, eyes, phase, 'all'),
    );
    return;
  }
  // A mother's brood moves inside her, so it is drawn live between her gel
  // and what sits on top of it.
  blitCached(ctx, `slime:mother:${step}:gel:${flash}`, x, base, box, (c) =>
    drawSlimeBody(c, mob.type, hop, eyes, phase, 'gel'),
  );
  ctx.save();
  ctx.translate(x, base - hop.lift);
  ctx.scale(hop.sx, hop.sy);
  drawBrood(ctx, mob, time);
  ctx.restore();
  blitCached(ctx, `slime:mother:${step}:${look}:top:${flash}`, x, base, box, (c) =>
    drawSlimeBody(c, mob.type, hop, eyes, phase, 'top'),
  );
}

/**
 * A slime standing at the origin (the middle of its base). `p` is its hop
 * phase, which also carries the bubbles up through it. `part` picks the gel
 * alone, what sits on top of it, or both with a half-digested lump between.
 */
function drawSlimeBody(
  ctx: CanvasRenderingContext2D,
  type: Mob['type'],
  hop: { lift: number; sx: number; sy: number },
  face: { x: number; y: number },
  p: number,
  part: 'all' | 'gel' | 'top',
): void {
  const def = MOBS[type];
  const r = def.radius;
  ctx.translate(0, -hop.lift);
  ctx.scale(hop.sx, hop.sy);

  if (part !== 'top') {
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.bezierCurveTo(-r * 1.05, -r * 1.05, -r * 0.5, -r * 1.55, 0, -r * 1.55);
    ctx.bezierCurveTo(r * 0.5, -r * 1.55, r * 1.05, -r * 1.05, r, 0);
    ctx.quadraticCurveTo(0, r * 0.3, -r, 0);
    ctx.closePath();
    const gel = ctx.createRadialGradient(-r * 0.35, -r * 1.05, r * 0.1, 0, -r * 0.5, r * 1.5);
    gel.addColorStop(0, tint(tone(def.color, 0.45)));
    gel.addColorStop(0.5, tint(def.color));
    gel.addColorStop(1, tint(tone(def.color, -0.45)));
    ctx.globalAlpha = 0.94;
    fillInk(ctx, gel, 1.3, tone(def.accent, -0.6));
    ctx.globalAlpha = 1;
  }
  if (part === 'gel') return;

  // Something half-digested in the middle, and bubbles rising through it.
  if (part === 'all') {
    ctx.fillStyle = tint(tone(def.accent, -0.3));
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(r * 0.2, -r * 0.42, r * 0.34, r * 0.24, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = tint(tone(def.color, 0.55));
  for (let i = 0; i < 3; i++) {
    // Two bubbles' rise to a hop, so a baked hop loops without a jump.
    const t = (p * 0.5 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc((rand(i, 9) - 0.5) * r, -t * r * 1.2, 0.9 + i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Wet highlight.
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.42, -r * 1.05, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-r * 0.12, -r * 1.3, r * 0.06, 0, Math.PI * 2);
  ctx.fill();

  // Eyes look where it is heading.
  const ex = face.x * r * 0.28;
  const ey = -r * 0.72 + face.y * r * 0.12;
  for (const side of [-1, 1]) {
    ctx.fillStyle = tint('#1a2a22');
    ctx.beginPath();
    ctx.ellipse(ex + side * r * 0.3, ey, r * 0.11, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(ex + side * r * 0.3 - r * 0.03, ey - r * 0.06, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Headings and stride phases a crawler is baked at. */
const CRAWLER_TURNS = 16;
const CRAWLER_STEPS = 12;

/**
 * Crawlers are baked per heading, stride phase and hit flash; six jointed
 * legs traced live cost about 0.3 ms each on a CPU canvas, and they come in
 * packs.
 */
function drawCrawler(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const r = MOBS.crawler.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const moving = Math.hypot(mob.vel.x, mob.vel.y) > 5;

  softShadow(ctx, x, y + r * 0.35, r * 1.2, 0.36);
  if (pixelSprites()) {
    const pixelTurn = (Math.round((Math.atan2(face.y, face.x) / (Math.PI * 2)) * PIXEL_CRAWLER_TURNS) + PIXEL_CRAWLER_TURNS) % PIXEL_CRAWLER_TURNS;
    const stride = Math.floor(((((time * (moving ? 14 : 2) + mob.seed) % 1) + 1) % 1) * PIXEL_CRAWLER_STEPS);
    drawPixelCrawler(ctx, x, y, mobAct(mob, moving), pixelTurn, stride, paintFlash() > 0);
    return;
  }

  const turn = (Math.round((Math.atan2(face.y, face.x) / (Math.PI * 2)) * CRAWLER_TURNS) + CRAWLER_TURNS) % CRAWLER_TURNS;
  const gait = time * (moving ? 18 : 3) + mob.seed;
  const step = Math.floor((((gait / (Math.PI * 2)) % 1) + 1) % 1 * CRAWLER_STEPS) % CRAWLER_STEPS;
  blitCached(
    ctx,
    `crawler:${turn}:${step}:${paintFlash() > 0 ? 1 : 0}`,
    x,
    y,
    { left: r * 1.7, right: r * 1.7, top: r * 1.7, bottom: r * 1.4 },
    (c) =>
      drawCrawlerPose(c, (turn / CRAWLER_TURNS) * Math.PI * 2, ((step + 0.5) / CRAWLER_STEPS) * Math.PI * 2),
  );
}

/** A crawler centred on the origin, facing `angle`, `gait` through its stride. */
function drawCrawlerPose(ctx: CanvasRenderingContext2D, angle: number, gait: number): void {
  const def = MOBS.crawler;
  const r = def.radius;
  ctx.translate(0, -r * 0.2);
  // Seen from above at an angle, so a heading squashes vertically.
  ctx.scale(1, 0.8);
  ctx.rotate(angle);

  const shell = tone(def.color, -0.12);
  const chitin = tone(def.accent, -0.35);

  // Three legs a side, moving in alternating tripods.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const bx = (0.25 - i * 0.35) * r;
      const tripod = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? 0 : Math.PI;
      const step = Math.sin(gait + tripod) * r * 0.18;
      const kx = bx + (0.1 - i * 0.12) * r + step * 0.5;
      const ky = side * r * 0.85;
      const fx = bx + (0.35 - i * 0.3) * r + step;
      const fy = side * r * 1.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(bx, side * r * 0.3);
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.strokeStyle = tint(chitin);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  // Abdomen, thorax, head, back to front.
  ctx.beginPath();
  ctx.ellipse(-r * 0.4, 0, r * 0.78, r * 0.62, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, shell, -r, -r * 0.6, r * 0.2, r * 0.6, 0.3, -0.35), 1.2);
  // Wing-case seam and ridges.
  ctx.strokeStyle = tint(tone(shell, -0.4));
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-r * 1.15, 0);
  ctx.lineTo(r * 0.3, 0);
  for (let i = 0; i < 3; i++) {
    const rx = -r * (0.9 - i * 0.3);
    ctx.moveTo(rx, -r * 0.5);
    ctx.quadraticCurveTo(rx - r * 0.12, 0, rx, r * 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 240, 220, 0.4)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.55, -r * 0.3, r * 0.4, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(r * 0.38, 0, r * 0.36, r * 0.42, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, chitin, 0, -r * 0.4, r * 0.7, r * 0.4, 0.35, -0.2), 1.1);

  // Mandibles.
  for (const side of [-1, 1]) {
    // The jaws work in time with the legs.
    const bite = Math.sin(gait) * 0.12;
    ctx.beginPath();
    ctx.moveTo(r * 0.78, side * r * 0.14);
    ctx.quadraticCurveTo(r * 1.25, side * r * (0.32 + bite), r * 1.08, side * r * 0.02);
    ctx.lineTo(r * 0.86, side * r * 0.08);
    ctx.closePath();
    fillInk(ctx, tint(tone(def.accent, -0.55)), 0.9);
  }
  ctx.beginPath();
  ctx.ellipse(r * 0.78, 0, r * 0.22, r * 0.26, 0, 0, Math.PI * 2);
  fillInk(ctx, tint(tone(chitin, -0.2)), 1);
  // Eyes that catch the light.
  ctx.fillStyle = tint('#ffcf6a');
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 0.88, side * r * 0.13, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Looking directions a wisp's body is baked at. */
const WISP_LOOKS = 8;

function drawWisp(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const def = MOBS.wisp;
  const r = def.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const hover = 14 + Math.sin(time * 2.2 + mob.seed) * 2.5;
  const cy = y - hover;

  softShadow(ctx, x, y + 2, r * 0.8, 0.22);

  // An aura, added on top of the scene so it glows rather than sits.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const aura = ctx.createRadialGradient(x, cy, 0, x, cy, r * 2.4);
  aura.addColorStop(0, 'rgba(160, 140, 255, 0.45)');
  aura.addColorStop(1, 'rgba(120, 100, 240, 0)');
  ctx.fillStyle = aura;
  ctx.fillRect(x - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
  ctx.restore();

  // A flame-like tail streaming away from where it is heading.
  const tx = -face.x;
  const ty = -face.y * 0.6 + 0.5;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const wave = Math.sin(time * 7 + mob.seed) * r * 0.35;
  const tipX = x + ux * r * 2.6 - uy * wave;
  const tipY = cy + uy * r * 2.6 + ux * wave;
  ctx.beginPath();
  ctx.moveTo(x - uy * r * 0.72, cy + ux * r * 0.72);
  ctx.quadraticCurveTo(x + ux * r * 1.4 - uy * (r * 0.5 + wave), cy + uy * r * 1.4 + ux * (r * 0.5 + wave), tipX, tipY);
  ctx.quadraticCurveTo(x + ux * r * 1.4 + uy * (r * 0.3 - wave), cy + uy * r * 1.4 - ux * (r * 0.3 - wave), x + uy * r * 0.72, cy - ux * r * 0.72);
  ctx.closePath();
  const tail = ctx.createLinearGradient(x, cy, tipX, tipY);
  tail.addColorStop(0, tint('#b6a8ff'));
  tail.addColorStop(1, 'rgba(110, 90, 220, 0)');
  ctx.fillStyle = tail;
  ctx.fill();

  // The body: a lantern of light, white at the heart.
  if (pixelSprites()) {
    const pixelLook = (Math.round((Math.atan2(face.y, face.x) / (Math.PI * 2)) * PIXEL_WISP_LOOKS) + PIXEL_WISP_LOOKS) % PIXEL_WISP_LOOKS;
    drawPixelWisp(ctx, x, cy, mobAct(mob, true), pixelLook, paintFlash() > 0);
  } else {
    drawWispBody(ctx, x, cy, face);
  }

  // Motes circling it.
  ctx.fillStyle = 'rgba(235, 228, 255, 0.9)';
  for (let i = 0; i < 3; i++) {
    const a = time * 2.4 + (i / 3) * Math.PI * 2 + mob.seed;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 0.55, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The drawn wisp's body, baked per the way it looks and hit flash, since wisps come in swarms. */
function drawWispBody(ctx: CanvasRenderingContext2D, x: number, cy: number, face: { x: number; y: number }): void {
  const def = MOBS.wisp;
  const r = def.radius;
  const look = (Math.round((Math.atan2(face.y, face.x) / (Math.PI * 2)) * WISP_LOOKS) + WISP_LOOKS) % WISP_LOOKS;
  blitCached(ctx, `wisp:${look}:${paintFlash() > 0 ? 1 : 0}`, x, cy, around(r * 0.85 + 2), (c) => {
    const a = (look / WISP_LOOKS) * Math.PI * 2;
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    c.beginPath();
    c.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    const core = c.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.05, 0, 0, r * 0.85);
    core.addColorStop(0, tint('#ffffff'));
    core.addColorStop(0.35, tint('#dcd4ff'));
    core.addColorStop(1, tint(def.color));
    c.fillStyle = core;
    c.fill();
    c.lineWidth = 1.1;
    c.strokeStyle = tone(def.accent, -0.35);
    c.stroke();

    // Hollow eyes, looking ahead.
    c.fillStyle = '#2a1f55';
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(fx * r * 0.22 + side * r * 0.26, -r * 0.05 + fy * r * 0.1, r * 0.1, r * 0.18, 0, 0, Math.PI * 2);
      c.fill();
    }
  });
}

/**
 * A brute is some twenty shaded, outlined shapes, so it is the one creature
 * baked rather than traced: its whole pose is one phase of its stride (or of
 * its idle breathing), a facing and a hit flash, which is few enough frames to
 * keep. Tracing it live cost most of a raid's frame on a CPU-drawn canvas.
 */
function drawBrute(ctx: CanvasRenderingContext2D, mob: Mob, time: number): void {
  const r = MOBS.brute.radius;
  const face = heading(mob);
  const moving = Math.hypot(mob.vel.x, mob.vel.y) > 3;
  const cycle = moving ? time * 5.5 + mob.seed : time * 1.6;
  const turn = (((cycle / (Math.PI * 2)) % 1) + 1) % 1;
  const step = Math.floor(turn * BRUTE_FRAMES);
  const flip = face.x < 0;
  const flashed = paintFlash() > 0;
  const feet = mob.pos.y + r * 0.45;
  if (pixelSprites()) {
    softShadow(ctx, mob.pos.x, feet, r * 1.35, 0.42);
    const walkStep = moving ? Math.floor(turn * BRUTE_WALK) : Math.floor(time * 1.2 + mob.seed) % 2;
    drawPixelBrute(ctx, mob.pos.x, feet, mobAct(mob, moving), walkStep, flip, flashed);
    return;
  }
  blitCached(
    ctx,
    `brute:${moving ? 1 : 0}:${step}:${flip ? 1 : 0}:${flashed ? 1 : 0}`,
    mob.pos.x,
    feet,
    { left: r * 1.7, right: r * 1.7, top: r * 2.7, bottom: r * 0.8 },
    (c) => drawBrutePose(c, moving, ((step + 0.5) / BRUTE_FRAMES) * Math.PI * 2, flip),
  );
}

const BRUTE_FRAMES = 24;

/** The brute standing at the origin (its feet), `phase` through its stride or breath. */
function drawBrutePose(ctx: CanvasRenderingContext2D, moving: boolean, phase: number, flip: boolean): void {
  const def = MOBS.brute;
  const r = def.radius;
  const gait = phase;
  const stomp = moving ? Math.abs(Math.sin(gait)) * 2 : Math.sin(phase) * 0.5;

  softShadow(ctx, 0, 0, r * 1.35, 0.42);

  if (flip) ctx.scale(-1, 1);

  const hide = tone(def.accent, -0.1);
  const plate = '#5b5f6a';
  const bone = '#e8dcc0';
  const lift = (side: number): number => (moving ? Math.max(0, Math.sin(gait) * side) * 4 : 0);

  // Legs: short and heavy.
  for (const side of [-1, 1]) {
    const lx = side * r * 0.42;
    ctx.beginPath();
    ctx.roundRect(lx - r * 0.24, -r * 0.62 - lift(side), r * 0.48, r * 0.62, r * 0.12);
    fillInk(ctx, litFill(ctx, tone(hide, side < 0 ? -0.2 : -0.3), lx - 6, -r, lx + 6, 0), 1.3);
    ctx.beginPath();
    ctx.ellipse(lx, -r * 0.05 - lift(side), r * 0.3, r * 0.14, 0, 0, Math.PI * 2);
    fillInk(ctx, tint(tone(hide, -0.45)), 1.2);
  }

  const by = -stomp;
  // The far arm, behind the body.
  drawBruteArm(ctx, -r * 0.95, by - r * 1.6, r, hide, -lift(1), true);

  // A hunched mass: broad shoulders, heavy gut.
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, by - r * 0.55);
  ctx.bezierCurveTo(-r * 1.2, by - r * 1.1, -r * 1.1, by - r * 2.05, -r * 0.2, by - r * 2.15);
  ctx.bezierCurveTo(r * 0.8, by - r * 2.2, r * 1.2, by - r * 1.5, r * 0.95, by - r * 0.9);
  ctx.bezierCurveTo(r * 0.85, by - r * 0.45, r * 0.4, by - r * 0.35, 0, by - r * 0.38);
  ctx.bezierCurveTo(-r * 0.4, by - r * 0.35, -r * 0.6, by - r * 0.4, -r * 0.75, by - r * 0.55);
  ctx.closePath();
  const skin = ctx.createLinearGradient(-r, by - r * 2.2, r * 0.9, by - r * 0.4);
  skin.addColorStop(0, tint(tone(def.color, 0.08)));
  skin.addColorStop(0.5, tint(hide));
  skin.addColorStop(1, tint(tone(hide, -0.45)));
  fillInk(ctx, skin, 1.5);

  // Paler belly.
  ctx.beginPath();
  ctx.ellipse(r * 0.18, by - r * 0.85, r * 0.5, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = tint(tone(def.color, 0.18));
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Stone plates grown into the shoulders, with spines.
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, by - r * 1.5);
  ctx.quadraticCurveTo(-r * 0.8, by - r * 2.35, r * 0.1, by - r * 2.3);
  ctx.quadraticCurveTo(r * 0.5, by - r * 2.25, r * 0.55, by - r * 1.95);
  ctx.quadraticCurveTo(-r * 0.2, by - r * 1.95, -r * 0.95, by - r * 1.5);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, plate, -r, by - r * 2.3, r * 0.5, by - r * 1.6, 0.35, -0.3), 1.3);
  for (let i = 0; i < 3; i++) {
    const sx = -r * 0.6 + i * r * 0.42;
    const sy = by - r * (2.08 + i * 0.07) + (i === 2 ? r * 0.08 : 0);
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.12, sy + r * 0.05);
    ctx.lineTo(sx - r * 0.1, sy - r * 0.36);
    ctx.lineTo(sx + r * 0.14, sy + r * 0.02);
    ctx.closePath();
    fillInk(ctx, litFill(ctx, bone, sx - 3, sy - 7, sx + 3, sy, 0.2, -0.3), 1);
  }

  // Head, low between the shoulders and thrust forward.
  const hx = r * 0.55;
  const hy = by - r * 1.55;
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.42, r * 0.36, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, hide, hx - 8, hy - 8, hx + 8, hy + 8, 0.2, -0.35), 1.3);
  // Horns sweeping forward.
  for (const side of [-1, 1]) {
    const bx = hx + side * r * 0.2 - r * 0.05;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.1, hy - r * 0.2);
    ctx.quadraticCurveTo(bx + side * r * 0.25 - r * 0.1, hy - r * 0.75, bx + r * 0.35, hy - r * 0.62);
    ctx.quadraticCurveTo(bx + side * r * 0.05, hy - r * 0.45, bx + r * 0.12, hy - r * 0.18);
    ctx.closePath();
    fillInk(ctx, litFill(ctx, bone, bx - 5, hy - 12, bx + 6, hy - 3, 0.15, -0.35), 1);
  }
  // Jaw with tusks, and a heavy brow over ember eyes.
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.12, hy + r * 0.2, r * 0.3, r * 0.14, 0, 0, Math.PI * 2);
  fillInk(ctx, tint(tone(hide, -0.35)), 1);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + r * 0.12 + side * r * 0.18, hy + r * 0.16);
    ctx.lineTo(hx + r * 0.16 + side * r * 0.2, hy - r * 0.05);
    ctx.lineTo(hx + r * 0.22 + side * r * 0.14, hy + r * 0.16);
    ctx.closePath();
    fillInk(ctx, tint(bone), 0.8);
  }
  ctx.fillStyle = tint(tone(hide, -0.5));
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.1, hy - r * 0.1, r * 0.34, r * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tint('#ffb347');
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + r * 0.12 + side * r * 0.15, hy - r * 0.02, r * 0.07, r * 0.045, side * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Near arm, fist on the ground.
  drawBruteArm(ctx, r * 1.02, by - r * 1.55, r, hide, -lift(-1), false);
}

function drawBruteArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  r: number,
  hide: string,
  lift: number,
  far: boolean,
): void {
  const fx = sx + (far ? -r * 0.15 : r * 0.12);
  const fy = -r * 0.28 + lift;
  const shade = far ? -0.35 : -0.05;
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.34, sy);
  ctx.quadraticCurveTo(sx - r * 0.5, (sy + fy) / 2, fx - r * 0.24, fy);
  ctx.lineTo(fx + r * 0.24, fy);
  ctx.quadraticCurveTo(sx + r * 0.42, (sy + fy) / 2, sx + r * 0.3, sy - r * 0.05);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, tone(hide, shade), sx - r * 0.4, sy, sx + r * 0.4, fy), 1.3);
  ctx.beginPath();
  ctx.ellipse(fx, fy + r * 0.05, r * 0.34, r * 0.26, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, tone(hide, shade - 0.12), fx - 6, fy - 5, fx + 6, fy + 5, 0.2, -0.3), 1.3);
  // Knuckle ridge.
  ctx.strokeStyle = tint(tone(hide, -0.55));
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(fx - r * 0.2, fy - r * 0.02);
  ctx.quadraticCurveTo(fx, fy - r * 0.12, fx + r * 0.2, fy - r * 0.02);
  ctx.stroke();
}

/**
 * Eyes and wisps drawn once more over the night layer. After dark the island
 * goes blue-black, and what gives a raid away is its eyes in the treeline.
 */
export function drawMobGlow(ctx: CanvasRenderingContext2D, mob: Mob, time: number, darkness: number): void {
  if (darkness <= 0.05) return;
  const def = MOBS[mob.type];
  const r = def.radius;
  const { x, y } = mob.pos;
  const face = heading(mob);
  const glow = (gx: number, gy: number, radius: number, color: string, alpha: number): void => {
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
    g.addColorStop(0, color.replace('A', String(alpha * darkness)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(gx - radius, gy - radius, radius * 2, radius * 2);
  };

  switch (mob.type) {
    case 'wisp': {
      const cy = y - 14 - Math.sin(time * 2.2 + mob.seed) * 2.5;
      glow(x, cy, r * 3, 'rgba(150, 130, 255, A)', 0.32);
      break;
    }
    case 'brute': {
      const dir = face.x < 0 ? -1 : 1;
      const hy = y + r * 0.45 - r * 1.55;
      for (const side of [-1, 1]) {
        glow(x + dir * (r * 0.67 + side * r * 0.15), hy, 5, 'rgba(255, 170, 70, A)', 0.9);
      }
      break;
    }
    case 'crawler': {
      const ex = x + face.x * r * 0.88;
      const ey = y - r * 0.2 + face.y * r * 0.7;
      glow(ex, ey, 4.5, 'rgba(255, 205, 110, A)', 0.8);
      break;
    }
    case 'slime':
    case 'mother': {
      glow(x, y - r * 0.2, r * 1.6, 'rgba(120, 230, 150, A)', 0.22);
      break;
    }
    case 'spitter': {
      glow(x + (face.x < 0 ? -1 : 1) * r * 0.55, y + r * 0.1, r * 1.1, 'rgba(210, 255, 120, A)', 0.35);
      break;
    }
    case 'shellback': {
      glow(x + face.x * r * 1.1, y - r * 0.25 + face.y * r * 0.8, 4.5, 'rgba(255, 210, 110, A)', 0.8);
      break;
    }
    case 'warden': {
      glow(x, y - r * 1.2, r * 2.2, 'rgba(255, 160, 60, A)', 0.4);
      break;
    }
    case 'bulwark': {
      glow(x, y - r * 1.9, r * 1.8, 'rgba(140, 230, 255, A)', 0.4);
      break;
    }
    case 'queen': {
      const hy = y + r * 0.35 - r * 1.1 - r * 0.12;
      glow(x + (face.x < 0 ? -1 : 1) * r * 0.76, hy, 7, 'rgba(255, 215, 90, A)', 0.9);
      glow(x, hy + r * 0.2, r * 2, 'rgba(190, 140, 255, A)', 0.22);
      break;
    }
  }
}
