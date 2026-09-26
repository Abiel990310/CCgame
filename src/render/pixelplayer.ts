import { OUTLINE, PixelGrid, blitPixels, ramp, type Ramp, type Rgb } from './pixel';

/**
 * The player as pixel art: a small rig posed on a grid of whole pixels, one
 * frame per step of each animation, outlined and cached. Where the drawn
 * figure was smooth shapes redrawn every frame, this is what the finished
 * games in the genre ship, chunky readable pixels that step between poses,
 * and it costs one blit per player once a frame has been made.
 *
 * Coordinates below are pixels from the feet, x forward (the side view faces
 * right; left is the same frame mirrored), y down, so the numbers read like
 * the world-unit numbers of the drawn figure it replaces.
 */

export type PixelTool = 'axe' | 'pick' | 'hand' | 'rod' | 'blade' | null;
export type PixelView = 'side' | 'down' | 'up';

export interface PixelPose {
  view: PixelView;
  flip: boolean;
  /** Frame of the 8-step walk, or -1 standing. */
  walk: number;
  /** Frame of the 2-step breath while standing. */
  idle: number;
  /** Frame of the 16-step tool swing, or -1. */
  swing: number;
  tool: PixelTool;
  /** A dash leans the body forward. */
  dash: boolean;
  flash: boolean;
  /** Just hit: thrown back a little after the white flash. */
  recoil?: boolean;
  /** Eyes shut for a frame now and then, so standing still is alive. */
  blink?: boolean;
}

export interface PixelOutfit {
  jacket: string;
  scarf: string;
  cap: string;
}

const W = 48;
const H = 50;
const AX = 24;
const AY = 46;

export const WALK_FRAMES = 8;
export const SWING_FRAMES = 16;

const SKIN = ramp('#e6bd95');
const HAIR = ramp('#4a3326');
const TROUSERS = ramp('#3a4152');
const TROUSERS_FAR = ramp('#2a2f3c');
const BOOTS = ramp('#4a3526');
const BOOTS_FAR = ramp('#352619');
const PACK = ramp('#8a5c36');
const BEDROLL = ramp('#8f9a62');
const LEATHER = ramp('#3a2a20');
const BRASS = ramp('#e2b25a');
const STEEL = ramp('#c3ccd6');
const HANDLE = ramp('#9a6a3c');
const EYE: Rgb = [34, 26, 32];
const BLUSH: Rgb = [226, 150, 128];
const FLASH: Rgb = [255, 246, 238];

interface Palette {
  jacket: Ramp;
  far: Ramp;
  scarf: Ramp;
  cap: Ramp;
}

const palettes = new Map<string, Palette>();

function paletteOf(o: PixelOutfit): Palette {
  const key = `${o.jacket}${o.scarf}${o.cap}`;
  let p = palettes.get(key);
  if (!p) {
    const j = ramp(o.jacket);
    p = { jacket: j, far: [j[1], j[2], shade(j[2], 0.75)], scarf: ramp(o.scarf), cap: ramp(o.cap) };
    palettes.set(key, p);
  }
  return p;
}

function shade(c: Rgb, k: number): Rgb {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k + 4)];
}

/** The grid in rig coordinates: offsets from the feet. */
class Rig extends PixelGrid {
  constructor() {
    super(W, H);
  }
  p(x: number, y: number, c: Rgb): void {
    this.set(AX + x, AY + y, c);
  }
  box(x0: number, y0: number, x1: number, y1: number, r: Ramp, round = false): void {
    this.rect(AX + x0, AY + y0, AX + x1, AY + y1, r, round);
  }
  ball(cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
    this.disc(AX + cx, AY + cy, rx, ry, r);
  }
  bone(x0: number, y0: number, x1: number, y1: number, width: number, r: Ramp): void {
    this.limb(AX + x0, AY + y0, AX + x1, AY + y1, width, r);
  }
  seam(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    this.line(AX + x0, AY + y0, AX + x1, AY + y1, c);
  }
  /**
   * Draw a part on its own and outline it before laying it on the body, so a
   * near arm or the head stays separate from what is behind it: the
   * "selective outline" a sprite artist would draw by hand.
   */
  part(draw: (g: Rig) => void, edge: Rgb = OUTLINE): void {
    const g = new Rig();
    draw(g);
    g.outline(edge);
    for (let i = 0; i < g.px.length; i++) if (g.px[i]) this.px[i] = g.px[i];
  }
  /** Lean everything above the hips forward, for the dash. */
  lean(hipY: number, k: number): void {
    const pivot = AY + hipY;
    for (let y = 0; y < pivot; y++) {
      const shift = Math.round((pivot - y) * k);
      if (!shift) continue;
      const row = this.px.slice(y * W, y * W + W);
      for (let x = 0; x < W; x++) this.px[y * W + x] = row[x - shift] ?? null;
    }
  }
}

export function drawPixelPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  feet: number,
  outfit: PixelOutfit,
  pose: PixelPose,
  swingAngle: (t: number) => number,
): void {
  const key = `pp|${outfit.jacket}${outfit.scarf}|${pose.view}|${pose.flip ? 1 : 0}|${pose.walk}|${pose.idle}|${pose.swing}|${pose.tool ?? '-'}|${pose.dash ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.recoil ? 1 : 0}|${pose.blink ? 1 : 0}`;
  blitPixels(ctx, key, x, feet, AX, AY, 1, () => {
    const g = new Rig();
    const pal = paletteOf(outfit);
    if (pose.view === 'side') drawSide(g, pal, pose, swingAngle);
    else drawFrontBack(g, pal, pose, pose.view === 'up');
    if (pose.flash) g.silhouette(FLASH);
    g.outline();
    return pose.flip ? g.mirrored() : g;
  });
}

/**
 * Knocked down: the standing frame laid on its side, dimmed, head toward the
 * left, with a slow breath so a friend can tell they are only down.
 */
export function drawPixelDowned(ctx: CanvasRenderingContext2D, x: number, feet: number, outfit: PixelOutfit, breath: number): void {
  const dim: PixelOutfit = { jacket: darken(outfit.jacket), scarf: darken(outfit.scarf), cap: darken(outfit.cap) };
  const pose: PixelPose = { view: 'side', flip: false, walk: -1, idle: breath, swing: -1, tool: null, dash: false, flash: false };
  // The body runs from the crown (12 rows below the top) to the feet; laid
  // down, its middle sits on the player's position.
  blitPixels(ctx, `ppd|${outfit.jacket}${outfit.scarf}|${breath}`, x, feet, 29, 27, 1, () => {
    const g = new Rig();
    drawSide(g, paletteOf(dim), pose, () => 0);
    g.outline();
    return g.rotated();
  });
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): string => Math.round(v * 0.72).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Down on the contact frames, up as the legs pass: the walk's bounce. */
const WALK_BOB = [1, 0, -1, 0, 1, 0, -1, 0];

function bobOf(pose: PixelPose): number {
  if (pose.swing >= 12 && pose.swing <= 13) return 1;
  if (pose.walk >= 0) return WALK_BOB[pose.walk];
  return pose.idle;
}

function strideOf(pose: PixelPose): number {
  return pose.walk >= 0 ? Math.sin((pose.walk / WALK_FRAMES) * Math.PI * 2) * 0.62 : 0;
}

// ─── Side view, facing right ────────────────────────────────────────────────

function drawSide(g: Rig, pal: Palette, pose: PixelPose, swingAngle: (t: number) => number): void {
  const bob = bobOf(pose);
  const stride = strideOf(pose);
  const hip = -11 + bob;
  const moving = pose.walk >= 0;

  sideLeg(g, 0, hip, -stride, true);

  const shoulder = -19 + bob;
  const farArm = moving ? -stride * 1.2 : 0.12;
  g.part((p) => sideArm(p, 0, shoulder, farArm, pal.far, null));

  // Pack and the bedroll strapped over it.
  g.box(-9, -21 + bob, -5, -11 + bob, PACK, true);
  g.seam(-8, -16 + bob, -6, -16 + bob, PACK[2]);
  g.ball(-7, -22 + bob, 3, 2.2, BEDROLL);
  g.p(-7, -22 + bob, BEDROLL[2]);

  // Torso, belt and buckle, the strap across the chest.
  g.box(-4, -21 + bob, 4, -11 + bob, pal.jacket, true);
  g.seam(-4, -12 + bob, 4, -12 + bob, LEATHER[1]);
  g.p(2, -12 + bob, BRASS[0]);
  g.p(3, -12 + bob, BRASS[1]);
  g.seam(-3, -20 + bob, 0, -13 + bob, LEATHER[1]);
  g.p(2, -17 + bob, pal.jacket[2]);
  g.p(3, -17 + bob, pal.jacket[2]);

  // Scarf, its tail streaming behind on the move.
  g.box(-3, -22 + bob, 4, -20 + bob, pal.scarf);
  const flutter = moving ? (pose.walk % 4 < 2 ? 0 : 1) : 0;
  const tail = moving || pose.dash ? 4 : 1;
  g.bone(-4, -21 + bob, -4 - tail, -18 + bob - (moving ? 2 : 0) + flutter, 2, pal.scarf);

  const near =
    pose.swing >= 0 ? swingAngle((pose.swing + 0.5) / SWING_FRAMES) : moving ? stride * 1.2 : 0.1;
  const arm = (): void => g.part((p) => sideArm(p, 1, shoulder, near, pal.jacket, pose.swing >= 0 ? pose.tool : null));
  // Raised over the shoulder the arm passes behind the head, not across the face.
  const raised = near > 2.3;
  if (raised) arm();
  g.part((p) => sideHead(p, pal, bob, pose.blink === true));
  if (!raised) arm();

  g.part((p) => sideLeg(p, 1, hip, stride, false));

  if (pose.recoil) g.lean(hip, -0.16);
  else if (pose.dash) g.lean(hip, 0.28);
  else if (moving) g.lean(hip, 0.06);
}

function sideLeg(g: Rig, x: number, hip: number, angle: number, far: boolean): void {
  const len = 10;
  // The leg swinging back lifts its heel, which is what makes a stride read.
  const lift = angle < 0 ? Math.round(-angle * 2.6) : 0;
  const fx = Math.round(x + Math.sin(angle) * len * 0.8);
  const fy = Math.min(0, Math.round(hip + Math.cos(angle) * len)) - lift;
  g.bone(x, hip, fx, fy - 3, 4, far ? TROUSERS_FAR : TROUSERS);
  const boots = far ? BOOTS_FAR : BOOTS;
  g.box(fx - 2, fy - 3, fx + 3, fy - 1, boots, true);
  g.seam(fx - 2, fy - 1, fx + 3, fy - 1, boots[2]);
}

function sideArm(g: Rig, sx: number, sy: number, angle: number, cloth: Ramp, tool: PixelTool): void {
  const len = 8;
  const dx = Math.sin(angle);
  const dy = Math.cos(angle);
  const hx = sx + dx * len;
  const hy = sy + dy * len;
  if (tool && tool !== 'hand') drawTool(g, hx, hy, dx, dy, tool);
  g.bone(sx, sy, sx + dx * (len - 1.5), sy + dy * (len - 1.5), 3.4, cloth);
  g.ball(hx, hy, 1.5, 1.5, SKIN);
}

function drawTool(g: Rig, hx: number, hy: number, dx: number, dy: number, tool: PixelTool): void {
  // Across the handle, pointing the way the blow travels.
  const px = dy;
  const py = -dx;
  if (tool === 'blade') {
    // A short hunting blade: grip, a crossguard, then a bright edge.
    g.bone(hx - dx * 2, hy - dy * 2, hx + dx, hy + dy, 2, LEATHER);
    g.seam(hx + dx * 1.5 - px * 2, hy + dy * 1.5 - py * 2, hx + dx * 1.5 + px * 2, hy + dy * 1.5 + py * 2, BRASS[1]);
    g.bone(hx + dx * 2.5, hy + dy * 2.5, hx + dx * 12, hy + dy * 12, 2.2, STEEL);
    g.seam(hx + dx * 3, hy + dy * 3, hx + dx * 11, hy + dy * 11, STEEL[0]);
    return;
  }
  const len = tool === 'rod' ? 16 : 10;
  const ex = hx + dx * len;
  const ey = hy + dy * len;
  g.bone(hx - dx * 2, hy - dy * 2, ex, ey, 2, HANDLE);
  if (tool === 'axe') {
    for (let b = -2.5; b <= 2.5; b += 0.5) {
      const reach = 4.5 - Math.abs(b) * 0.6;
      for (let a = 0; a <= reach; a += 0.5) {
        const edge = a > reach - 1;
        g.p(ex + px * a + dx * b, ey + py * a + dy * b, edge ? STEEL[0] : b > 1 ? STEEL[2] : STEEL[1]);
      }
    }
  } else if (tool === 'pick') {
    for (let a = -5.5; a <= 5.5; a += 0.5) {
      const bend = -Math.abs(a) * 0.35;
      for (let b = -0.5; b <= 1; b += 0.5) {
        const tip = Math.abs(a) > 4.5;
        g.p(ex + px * a + dx * (b + bend), ey + py * a + dy * (b + bend), tip ? STEEL[0] : b > 0.5 ? STEEL[2] : STEEL[1]);
      }
    }
  } else if (tool === 'rod') {
    for (let t = 0; t <= 1; t += 0.08) g.p(ex + px * 7 * t, ey + 14 * t * t, [214, 226, 236]);
  }
}

function sideHead(g: Rig, pal: Palette, bob: number, blink: boolean): void {
  const cy = -28 + bob;
  g.ball(-2, cy + 1, 3.2, 3.8, HAIR);
  g.ball(1, cy, 5, 5.2, SKIN);
  g.p(6, cy + 1, SKIN[1]);
  g.p(-1, cy + 1, SKIN[2]);
  g.p(-1, cy + 2, SKIN[2]);
  if (blink) g.p(3, cy, SKIN[2]);
  else {
    g.p(3, cy - 1, EYE);
    g.p(3, cy, EYE);
  }
  g.p(4, cy + 2, BLUSH);
  // Cap over the crown, its brim out over the eyes.
  g.box(-4, cy - 6, 4, cy - 2, pal.cap, true);
  g.seam(0, cy - 2, 7, cy - 2, pal.cap[2]);
  g.seam(-4, cy - 3, 3, cy - 3, pal.cap[1]);
  g.p(-3, cy - 5, pal.cap[0]);
}

// ─── Facing the camera, and facing away ─────────────────────────────────────

function drawFrontBack(g: Rig, pal: Palette, pose: PixelPose, back: boolean): void {
  const bob = bobOf(pose);
  const hip = -11 + bob;
  const cycle = (pose.walk / WALK_FRAMES) * Math.PI * 2;
  const moving = pose.walk >= 0;

  for (const side of [-1, 1]) {
    const lift = moving ? Math.round(Math.max(0, Math.sin(cycle) * side) * 2.6) : 0;
    const fx = side * 3;
    const legs = side < 0 ? TROUSERS : TROUSERS_FAR;
    g.part((p) => {
      p.bone(side * 2.5, hip, fx, -3 - lift, 4, legs);
      p.box(fx - 2, -3 - lift, fx + 2, -1 - lift, BOOTS, true);
    });
  }

  const arms = (): void => {
    for (const side of [-1, 1]) {
      const swing = moving ? Math.round(Math.sin(cycle) * -side * 2) : 0;
      g.part((p) => {
        p.bone(side * 6, -20 + bob, side * 7, -14 + bob + swing, 3.4, side < 0 ? pal.jacket : pal.far);
        p.ball(side * 7, -13 + bob + swing, 1.5, 1.5, SKIN);
      });
    }
  };

  if (back) arms();
  g.box(-5, -21 + bob, 5, -11 + bob, pal.jacket, true);
  g.seam(-5, -12 + bob, 5, -12 + bob, LEATHER[1]);

  if (back) {
    g.part((p) => {
      p.box(-5, -21 + bob, 5, -12 + bob, PACK, true);
      p.seam(-4, -17 + bob, 4, -17 + bob, PACK[2]);
      p.p(0, -16 + bob, BRASS[0]);
      p.ball(0, -22 + bob, 5.5, 2.3, BEDROLL);
      p.seam(-2, -22 + bob, 2, -22 + bob, BEDROLL[2]);
    });
  } else {
    g.seam(-3, -20 + bob, -3, -13 + bob, LEATHER[1]);
    g.seam(3, -20 + bob, 3, -13 + bob, LEATHER[1]);
    g.p(-1, -12 + bob, BRASS[0]);
    g.p(0, -12 + bob, BRASS[1]);
    g.p(1, -12 + bob, BRASS[1]);
    arms();
  }

  const cy = -28 + bob;
  g.box(-4, -22 + bob, 4, -20 + bob, pal.scarf);
  if (!back) g.bone(2, -20 + bob, 3, -17 + bob, 2, pal.scarf);

  g.part((p) => {
    if (back) {
      p.ball(0, cy, 5.2, 5.2, HAIR);
      p.p(-5, cy + 1, SKIN[1]);
      p.p(5, cy + 1, SKIN[2]);
    } else {
      p.ball(0, cy, 5.2, 5.2, SKIN);
      if (pose.blink) {
        p.p(-2, cy, SKIN[2]);
        p.p(2, cy, SKIN[2]);
      } else {
        p.p(-2, cy - 1, EYE);
        p.p(-2, cy, EYE);
        p.p(2, cy - 1, EYE);
        p.p(2, cy, EYE);
      }
      p.p(-3, cy + 2, BLUSH);
      p.p(3, cy + 2, BLUSH);
      p.p(0, cy + 3, SKIN[2]);
      p.p(-5, cy - 1, HAIR[1]);
      p.p(5, cy - 1, HAIR[2]);
    }
    p.box(-5, cy - 6, 5, cy - 2, pal.cap, true);
    if (back) p.seam(-5, cy - 2, 5, cy - 2, pal.cap[2]);
    else p.seam(-5, cy - 2, 5, cy - 2, pal.cap[0]);
    p.p(-3, cy - 5, pal.cap[0]);
  });
}
