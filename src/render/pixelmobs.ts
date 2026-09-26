import { MOBS } from '@shared/data/mobs';
import type { Mob } from '@shared/sim/types';
import { OUTLINE, PixelGrid, blitPixels, ramp, type Ramp, type Rgb } from './pixel';

/**
 * The raiders as pixel art, generated the same way as the player: a
 * small grid of whole pixels shaded from three-step ramps, each part outlined
 * on its own, one frame per step of each move, cached after first use.
 *
 * Every creature also has the two frames that make a fight readable: rearing
 * back while its bite winds up, and lunging as it lands. Those come from the
 * mob's own state (its wind-up, and the cooldown a bite just set), so nothing
 * extra crosses the network.
 */

/** What a creature is doing, as far as its drawing cares. */
export type MobAct = 'move' | 'still' | 'rear' | 'lunge';

/**
 * What a creature is doing, for the frames that show it: winding up a bite,
 * or just landing one (a bite sets its cooldown to a second; a whiff, a
 * parry's daze and a wall bite set other values, and do not lunge).
 */
export function mobAct(mob: Mob, moving: boolean): MobAct {
  if ((mob.windup ?? 0) > 0) return 'rear';
  if (mob.attackCd > 0.82 && mob.attackCd <= 1) return 'lunge';
  return moving ? 'move' : 'still';
}

const SPRITES_KEY = 'ccgame.sprites';
let spriteMode: boolean | null = null;

/**
 * Pixel sprites unless `?sprites=vector` asks for the drawn figure, which is
 * kept for comparing the two; the choice is remembered like `?renderer=`.
 */
export function pixelSprites(): boolean {
  if (spriteMode !== null) return spriteMode;
  spriteMode = true;
  try {
    const asked = new URLSearchParams(location.search).get('sprites');
    if (asked === 'vector' || asked === 'pixel') localStorage.setItem(SPRITES_KEY, asked);
    spriteMode = localStorage.getItem(SPRITES_KEY) !== 'vector';
  } catch {
    // Storage can be off entirely; pixel sprites it is.
  }
  return spriteMode;
}

const FLASH: Rgb = [255, 246, 238];
const BONE = ramp('#e8dcc0');
const STONE = ramp('#5b5f6a');
const EYE: Rgb = [26, 34, 30];
const WHITE: Rgb = [250, 252, 248];
const EMBER: Rgb = [255, 190, 90];
const EMBER_HOT: Rgb = [255, 236, 170];
const RED_EYE: Rgb = [255, 96, 80];

/** A grid addressed from an anchor, with parts that carry their own outline. */
class Sprite extends PixelGrid {
  constructor(
    w: number,
    h: number,
    readonly ax: number,
    readonly ay: number,
  ) {
    super(w, h);
  }
  p(x: number, y: number, c: Rgb): void {
    this.set(this.ax + x, this.ay + y, c);
  }
  ball(cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
    this.disc(this.ax + cx, this.ay + cy, rx, ry, r);
  }
  bone(x0: number, y0: number, x1: number, y1: number, width: number, r: Ramp): void {
    this.limb(this.ax + x0, this.ay + y0, this.ax + x1, this.ay + y1, width, r);
  }
  seam(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    this.line(this.ax + x0, this.ay + y0, this.ax + x1, this.ay + y1, c);
  }
  box(x0: number, y0: number, x1: number, y1: number, r: Ramp): void {
    this.rect(this.ax + x0, this.ay + y0, this.ax + x1, this.ay + y1, r, true);
  }
  part(draw: (g: Sprite) => void, edge: Rgb = OUTLINE): void {
    const g = new Sprite(this.w, this.h, this.ax, this.ay);
    draw(g);
    g.outline(edge);
    for (let i = 0; i < g.px.length; i++) if (g.px[i]) this.px[i] = g.px[i];
  }
}

function finish(g: Sprite, flash: boolean): Sprite {
  if (flash) g.silhouette(FLASH);
  g.outline();
  return g;
}

// ─── Slime ──────────────────────────────────────────────────────────────────

export const SLIME_HOPS = 8;
export const SLIME_LOOKS = 8;

const SW = 41;
const SH = 42;
const SAX = 20;
const SAY = 36;

function hopShape(step: number): { lift: number; sx: number; sy: number } {
  const p = (step + 0.5) / SLIME_HOPS;
  const air = p > 0.15 && p < 0.85 ? Math.sin(((p - 0.15) / 0.7) * Math.PI) : 0;
  const ground = p < 0.15 ? 1 - p / 0.15 : p > 0.85 ? (p - 0.85) / 0.15 : 0;
  return { lift: Math.round(air * 6), sx: 1 + ground * 0.18 - air * 0.08, sy: 1 - ground * 0.2 + air * 0.12 };
}

/**
 * A slime standing on its base: a gel dome lit from the upper left, a wet
 * highlight, bubbles that rise as it hops, and eyes that look where it goes.
 * Rearing back it squats wide and scowls; lunging it stretches tall with its
 * mouth open, thrown forward the way it looks.
 */
export function drawPixelSlime(
  ctx: CanvasRenderingContext2D,
  type: 'slime' | 'spitter',
  x: number,
  base: number,
  act: MobAct,
  step: number,
  look: number,
  flash: boolean,
): void {
  const key = `pm|${type}|${act}|${act === 'move' || act === 'still' ? step : 0}|${look}|${flash ? 1 : 0}`;
  blitPixels(ctx, key, x, base, SAX, SAY, 1, () => {
    const def = MOBS[type];
    const r = def.radius;
    const gel = ramp(def.color);
    const deep = ramp(def.accent);
    const a = (look / SLIME_LOOKS) * Math.PI * 2;
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    let shape = act === 'move' || act === 'still' ? hopShape(step) : { lift: 0, sx: 1, sy: 1 };
    let lean = 0;
    if (act === 'rear') shape = { lift: 0, sx: 1.22, sy: 0.74 };
    if (act === 'lunge') {
      shape = { lift: 2, sx: 0.86, sy: 1.24 };
      lean = Math.round(fx * 3);
    }
    const g = new Sprite(SW, SH, SAX, SAY);
    const rx = r * shape.sx;
    const h = r * 1.5 * shape.sy;
    const bottom = -shape.lift;
    const cy = bottom - h * 0.5;
    // A dome: round on top, spread and flat where it sits.
    for (let y = Math.floor(bottom - h); y <= bottom; y++) {
      const t = (y - cy) / (h * 0.5);
      const half = t < 0 ? rx * Math.sqrt(Math.max(0, 1 - t * t)) : rx * (1 - 0.18 * t * t * t * t);
      // The top leans toward a lunge; the base stays put.
      const shift = lean * Math.max(0, -t);
      for (let px = Math.ceil(-half + shift); px <= Math.floor(half + shift); px++) {
        const dx = (px - shift) / rx;
        const lit = -dx * 0.6 - t * 0.8;
        const edge = Math.abs(dx) > 0.84 || y === bottom;
        g.p(px, y, lit > 0.45 ? gel[0] : edge || lit < -0.5 ? deep[1] : gel[1]);
      }
    }
    // Something half digested, and bubbles rising as it hops.
    const mid = Math.round(cy + h * 0.12);
    g.p(3 + lean, mid, deep[1]);
    g.p(4 + lean, mid, deep[1]);
    g.p(3 + lean, mid + 1, deep[2]);
    g.p(4 + lean, mid - 1, deep[1]);
    for (let i = 0; i < 2; i++) {
      const rise = ((step / SLIME_HOPS) * 0.5 + i * 0.5) % 1;
      g.p(i ? -4 : 5, Math.round(bottom - 2 - rise * h * 0.7), gel[0]);
    }
    // Wet highlight on the upper left.
    const top = Math.round(bottom - h);
    const hx = Math.round(-rx * 0.45) + Math.round(lean * 0.6);
    g.seam(hx, top + 4, hx + 2, top + 3, WHITE);
    g.p(hx - 1, top + 5, WHITE);
    g.p(hx + 3, top + 2, gel[0]);

    // Eyes, turned the way it looks.
    const ex = Math.round(fx * r * 0.28) + lean;
    const ey = Math.round(cy - h * 0.02 + fy * 1.5);
    for (const side of [-1, 1]) {
      const px = ex + side * 4 - (side < 0 ? 1 : 0);
      for (let dy = -1; dy <= 1; dy++) {
        g.p(px, ey + dy, EYE);
        g.p(px + 1, ey + dy, EYE);
      }
      if (act !== 'rear') g.p(px, ey - 1, WHITE);
      if (act === 'rear') {
        // A scowl: brows slanting down to the middle.
        g.p(side < 0 ? px - 1 : px + 2, ey - 3, EYE);
        g.p(px, ey - 2, EYE);
        g.p(px + 1, ey - 2, EYE);
      }
    }
    if (act === 'lunge') {
      for (let mx = -2; mx <= 2; mx++) {
        g.p(ex + mx, ey + 3, EYE);
        g.p(ex + mx, ey + 4, mx === 0 ? RED_EYE : EYE);
      }
    }
    return finish(g, flash);
  });
}

// ─── Crawler ────────────────────────────────────────────────────────────────

export const CRAWLER_TURNS = 8;
export const CRAWLER_STEPS = 4;

const CW = 45;
const CH = 41;
const CAX = 22;
const CAY = 22;

/**
 * A crawler seen from above at an angle: a shelled abdomen, a thorax and a
 * head with working jaws, on six legs that step in alternating threes. It is
 * drawn in its own frame (u forward, v across) and squashed onto the grid, so
 * every heading is laid out by the same code rather than hand-flipped.
 */
export function drawPixelCrawler(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  act: MobAct,
  turn: number,
  step: number,
  flash: boolean,
): void {
  const key = `pm|crawler|${act}|${turn}|${act === 'move' ? step : 0}|${flash ? 1 : 0}`;
  blitPixels(ctx, key, x, y, CAX, CAY, 1, () => {
    const def = MOBS.crawler;
    const r = def.radius;
    const shell = ramp(def.color);
    const chitin = ramp(def.accent);
    const leg: Ramp = [chitin[1], chitin[2], OUTLINE];
    const a = (turn / CRAWLER_TURNS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Rearing, the body draws back over its legs; lunging, it throws forward.
    const du = act === 'rear' ? -2.5 : act === 'lunge' ? 3 : 0;
    const at = (u: number, v: number): [number, number] => [u * c - v * s, (u * s + v * c) * 0.8 - 2];
    const g = new Sprite(CW, CH, CAX, CAY);

    const shape = (target: Sprite, cu: number, cv: number, ru: number, rv: number, rp: Ramp): void =>
      oval(target, at, c, s, 0.8, cu, cv, ru, rv, rp);

    // Three legs a side, stepping in alternating tripods.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const bu = (0.25 - i * 0.35) * r + du * 0.4;
        const tripod = (i + (side > 0 ? 1 : 0)) % 2;
        const phase = act === 'move' ? ((step + tripod * 2) % CRAWLER_STEPS) / CRAWLER_STEPS : 0.25;
        const swing = Math.sin(phase * Math.PI * 2) * r * 0.2;
        const spread = act === 'rear' ? 1.12 : 1;
        const [x0, y0] = at(bu, side * r * 0.3);
        const [x1, y1] = at(bu + (0.1 - i * 0.12) * r + swing * 0.5, side * r * 0.85 * spread);
        const [x2, y2] = at(bu + (0.35 - i * 0.3) * r + swing, side * r * 1.25 * spread);
        g.bone(x0, y0, x1, y1, 2, leg);
        g.bone(x1, y1, x2, y2, 1.6, leg);
      }
    }

    g.part((p) => {
      shape(p, -0.4 * r + du, 0, 0.8 * r, 0.62 * r, shell);
      // Wing-case seam and a shine along the shell.
      const [s0x, s0y] = at(-1.1 * r + du, 0);
      const [s1x, s1y] = at(0.28 * r + du, 0);
      p.seam(s0x, s0y, s1x, s1y, shell[2]);
      const [hx, hy] = at(-0.55 * r + du, -0.3 * r);
      p.p(Math.round(hx), Math.round(hy) - 1, WHITE);
      p.p(Math.round(hx) + 1, Math.round(hy) - 1, shell[0]);
    });
    g.part((p) => shape(p, 0.38 * r + du, 0, 0.36 * r, 0.42 * r, chitin));
    g.part((p) => {
      // Jaws: wide while it rears, shut on the bite, working as it walks.
      const open = act === 'rear' ? 0.5 : act === 'lunge' ? 0.02 : act === 'move' && step % 2 ? 0.3 : 0.2;
      for (const side of [-1, 1]) {
        const [j0x, j0y] = at(0.8 * r + du, side * 0.14 * r);
        const [j1x, j1y] = at(1.2 * r + du, side * (0.14 + open) * r);
        const [j2x, j2y] = at(1.1 * r + du, side * 0.04 * r);
        p.bone(j0x, j0y, j1x, j1y, 1.6, chitin);
        p.bone(j1x, j1y, j2x, j2y, 1.2, chitin);
      }
      shape(p, 0.78 * r + du, 0, 0.22 * r, 0.26 * r, [chitin[1], chitin[2], chitin[2]]);
      for (const side of [-1, 1]) {
        const [ex, ey] = at(0.88 * r + du, side * 0.13 * r);
        p.p(Math.round(ex), Math.round(ey), act === 'rear' ? RED_EYE : EMBER);
      }
    });
    return finish(g, flash);
  });
}

// ─── Brute ──────────────────────────────────────────────────────────────────

export const BRUTE_WALK = 8;

const BW = 71;
const BH = 70;
const BAX = 35;
const BAY = 62;

/**
 * The brute side-on: a hunched hide mass with stone plates grown into its
 * shoulders, a low horned head and fists that drag the ground. It stomps in an
 * eight-step walk, breathes when still, heaves both fists overhead as it winds
 * up, and brings them down in front of it on the blow.
 */
export function drawPixelBrute(
  ctx: CanvasRenderingContext2D,
  x: number,
  feet: number,
  act: MobAct,
  step: number,
  flip: boolean,
  flash: boolean,
): void {
  const frame = act === 'move' ? step % BRUTE_WALK : act === 'still' ? step % 2 : 0;
  const key = `pm|brute|${act}|${frame}|${flip ? 1 : 0}|${flash ? 1 : 0}`;
  blitPixels(ctx, key, x, feet, BAX, BAY, 1, () => {
    const def = MOBS.brute;
    const hide = ramp(def.accent);
    const hideFar: Ramp = [hide[1], hide[2], [hide[2][0] * 0.7, hide[2][1] * 0.7, hide[2][2] * 0.75 + 4].map(Math.round) as unknown as Rgb];
    const belly = ramp(def.color);
    const g = new Sprite(BW, BH, BAX, BAY);

    const cycle = act === 'move' ? (frame / BRUTE_WALK) * Math.PI * 2 : 0;
    const stomp = act === 'move' ? Math.round(Math.abs(Math.sin(cycle)) * 2) : act === 'still' ? frame : 0;
    const lift = (side: number): number => (act === 'move' ? Math.round(Math.max(0, Math.sin(cycle) * side) * 4) : 0);
    const by = -stomp + (act === 'rear' ? -2 : act === 'lunge' ? 2 : 0);
    // The upper body leans into the blow and back from the wind-up.
    const bx = act === 'lunge' ? 3 : act === 'rear' ? -2 : 0;
    const swing = (side: number): number => (act === 'move' ? Math.round(Math.sin(cycle) * side * 3) : 0);

    const fists = (near: boolean): { sx: number; sy: number; fx: number; fy: number } => {
      const sx = (near ? 19 : -18) + bx;
      const sy = by - 31;
      if (act === 'rear') return { sx, sy, fx: (near ? 10 : -4) + bx, fy: by - 54 };
      if (act === 'lunge') return { sx, sy, fx: near ? 29 : 22, fy: -6 };
      return { sx, sy, fx: sx + (near ? 3 : -3) + swing(near ? -1 : 1), fy: -6 - lift(near ? -1 : 1) };
    };
    const arm = (near: boolean): void => {
      const { sx, sy, fx, fy } = fists(near);
      const tone = near ? hide : hideFar;
      g.part((p) => {
        p.bone(sx, sy, fx, fy, near ? 8 : 9, tone);
        p.ball(fx, fy, 6, 5, tone);
        p.seam(fx - 3, fy - 3, fx + 3, fy - 3, tone[2]);
      });
    };

    // Short heavy legs, the far one darker.
    for (const side of [-1, 1]) {
      const lx = side * 8;
      const up = lift(side);
      g.part((p) => {
        p.box(lx - 5, -12 - up, lx + 5, -1 - up, side < 0 ? hideFar : hide);
        p.box(lx - 6, -3 - up, lx + 6, 0 - up, [hide[2], hideFar[2], hideFar[2]]);
      });
    }

    const rearFirst = act === 'rear';
    arm(false);
    if (rearFirst) arm(true);

    g.part((p) => {
      p.ball(bx, by - 26, 21, 17, hide);
      p.ball(bx + 5, by - 17, 10, 7, [belly[0], belly[1], hide[1]]);
      // Stone plates grown into the shoulders.
      for (let py = by - 45; py <= by - 36; py++) {
        const t = (py - (by - 45)) / 9;
        const half = 14 * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
        for (let px = Math.round(bx - 5 - half); px <= Math.round(bx - 5 + half); px++) {
          p.p(px, py, t < 0.35 ? STONE[0] : t > 0.8 ? STONE[2] : STONE[1]);
        }
      }
      for (let i = 0; i < 3; i++) {
        const sx = bx - 13 + i * 8;
        const sy = by - 44 + (i === 2 ? 2 : 0);
        p.bone(sx, sy, sx - 1, sy - 6, 3, BONE);
        p.p(sx - 1, sy - 7, BONE[0]);
      }
    });

    // The near arm goes in front of the body but behind the head, which is
    // thrust forward past the shoulder.
    if (act !== 'rear' && act !== 'lunge') arm(true);

    // Head low between the shoulders, horns sweeping forward.
    const hx = bx + 13;
    const hy = by - 31;
    g.part((p) => {
      for (const side of [-1, 1]) {
        const k = side < 0 ? 0 : 3;
        p.bone(hx - 3 + k, hy - 5, hx + 1 + k, hy - 12, 3, BONE);
        p.bone(hx + 1 + k, hy - 12, hx + 6 + k, hy - 13, 2, BONE);
      }
      p.ball(hx, hy, 8, 7, hide);
      p.ball(hx + 2, hy + 4, 6, 3, [hide[1], hide[2], hideFar[2]]);
      // A jaw that drops open on the blow.
      if (act === 'lunge') p.box(hx - 1, hy + 4, hx + 6, hy + 6, [OUTLINE, OUTLINE, OUTLINE]);
      p.p(hx - 1, hy + 2, BONE[0]);
      p.p(hx + 5, hy + 2, BONE[0]);
      p.p(hx - 1, hy + 1, BONE[1]);
      p.p(hx + 5, hy + 1, BONE[1]);
      // Brow, and ember eyes under it.
      p.seam(hx - 4, hy - 2, hx + 6, hy - 2, hide[2]);
      const lit = act === 'rear' || act === 'lunge' ? EMBER_HOT : EMBER;
      for (const ex of [hx - 2, hx + 4]) {
        p.p(ex, hy, lit);
        p.p(ex + 1, hy, lit);
      }
    });

    // On the blow the near fist comes down in front of everything.
    if (act === 'lunge') arm(true);
    const out = finish(g, flash);
    return flip ? (out.mirrored() as Sprite) : out;
  });
}

// ─── Spitter ────────────────────────────────────────────────────────────────

export const SPITTER_FILLS = 6;

const PW = 37;
const PH = 32;
const PAX = 18;
const PAY = 27;

/**
 * A squat frog-like spitter side-on, its throat sac swelling and paling as
 * the next shot comes due. It squats lower as a bite winds up and gapes as
 * it lands.
 */
export function drawPixelSpitter(
  ctx: CanvasRenderingContext2D,
  x: number,
  feet: number,
  act: MobAct,
  fill: number,
  spots: number,
  flip: boolean,
  flash: boolean,
): void {
  const pose = act === 'rear' || act === 'lunge' ? act : 'still';
  const key = `pm|spitter|${pose}|${fill}|${spots}|${flip ? 1 : 0}|${flash ? 1 : 0}`;
  blitPixels(ctx, key, x, feet, PAX, PAY, 1, () => {
    const def = MOBS.spitter;
    const r = def.radius;
    const skin = ramp(def.color);
    const dark = ramp(def.accent);
    const charge = fill / (SPITTER_FILLS - 1);
    const g = new Sprite(PW, PH, PAX, PAY);
    const squat = pose === 'rear' ? 2 : 0;

    // Folded hind legs, the far one darker.
    g.part((p) => {
      p.ball(-7, -3, 4.5, 3, [dark[1], dark[2], dark[2]]);
      p.ball(7, -2, 4.5, 3, dark);
    });
    g.part((p) => {
      p.ball(0, -7.5 + squat, r * 0.95, r * 0.72 - squat * 0.5, skin);
      // Speckles, a pattern per spitter.
      for (let i = 0; i < 5; i++) {
        const sx = Math.round(((spots * 7 + i * 5) % 13) - 6);
        const sy = Math.round(-8 - ((spots * 3 + i * 4) % 6) + squat);
        p.p(sx, sy, dark[1]);
      }
      // Mouth line, or a gape on the bite.
      if (pose === 'lunge') {
        p.box(3, -8, 11, -6, [OUTLINE, OUTLINE, OUTLINE]);
        p.p(7, -6, RED_EYE);
      } else {
        p.seam(3, -7 + squat, 8, -6 + squat, OUTLINE);
        p.seam(8, -6 + squat, 11, -8 + squat, OUTLINE);
      }
    });
    // The sac under the chin, bigger and paler as it fills.
    const sac = 4 + charge * 3;
    const sacRamp: Ramp = charge > 0.66 ? [[250, 255, 200], [226, 250, 140], [156, 194, 58]] : [[214, 240, 130], [168, 206, 70], [118, 150, 40]];
    g.part((p) => p.ball(6, -4 + squat * 0.5, sac, sac * 0.85, sacRamp));
    // Bulging eyes on top.
    for (const side of [-1, 1]) {
      g.part((p) => {
        const ex = 4 + side * 3;
        const ey = -15 + squat;
        p.ball(ex, ey, 2.6, 2.6, skin);
        p.p(ex + 1, ey, EYE);
        p.p(ex + 1, ey + 1, EYE);
        if (pose === 'rear') p.p(ex + 1, ey - 1, EYE);
      });
    }
    const out = finish(g, flash);
    return flip ? out.mirrored() : out;
  });
}

// ─── Shellback ──────────────────────────────────────────────────────────────

export const SHELLBACK_TURNS = 8;
export const SHELLBACK_STEPS = 4;

const HW = 49;
const HH = 43;
const HAX = 24;
const HAY = 21;

/** Oriented ellipse in a body frame turned by (c, s) and squashed by `k`. */
function oval(
  target: Sprite,
  at: (u: number, v: number) => [number, number],
  c: number,
  s: number,
  k: number,
  cu: number,
  cv: number,
  ru: number,
  rv: number,
  rp: Ramp,
): void {
  const [ox, oy] = at(cu, cv);
  const reach = Math.max(ru, rv) + 1;
  for (let py = Math.floor(oy - reach); py <= Math.ceil(oy + reach); py++) {
    for (let px = Math.floor(ox - reach); px <= Math.ceil(ox + reach); px++) {
      const sx = px - ox;
      const sy = (py - oy) / k;
      const u = sx * c + sy * s;
      const v = -sx * s + sy * c;
      const d = (u / ru) ** 2 + (v / rv) ** 2;
      if (d > 1.02) continue;
      const lit = (-sx / reach) * 0.6 - ((py - oy) / reach) * 0.8;
      target.p(px, py, lit > 0.35 ? rp[0] : d > 0.72 || lit < -0.4 ? rp[2] : rp[1]);
    }
  }
}

/**
 * A beetle under a heavy domed plate, seen from above at an angle like the
 * crawler: stubby legs out from under the rim, a small head in front, and a
 * plate with a raised rim, a cross seam and four bosses.
 */
export function drawPixelShellback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  act: MobAct,
  turn: number,
  step: number,
  flash: boolean,
): void {
  const key = `pm|shellback|${act}|${turn}|${act === 'move' ? step : 0}|${flash ? 1 : 0}`;
  blitPixels(ctx, key, x, y, HAX, HAY, 1, () => {
    const def = MOBS.shellback;
    const r = def.radius;
    const plate = ramp(def.color);
    const rim = ramp(def.accent);
    const a = (turn / SHELLBACK_TURNS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = 0.78;
    const du = act === 'rear' ? -2 : act === 'lunge' ? 3 : 0;
    const at = (u: number, v: number): [number, number] => [u * c - v * s, (u * s + v * c) * k];
    const g = new Sprite(HW, HH, HAX, HAY);
    const leg: Ramp = [rim[2], rim[2], OUTLINE];

    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const bu = (0.35 - i * 0.4) * r;
        const phase = act === 'move' ? ((step + i + (side > 0 ? 2 : 0)) % SHELLBACK_STEPS) / SHELLBACK_STEPS : 0;
        const swing = Math.sin(phase * Math.PI * 2) * r * 0.14;
        const [x0, y0] = at(bu, side * r * 0.5);
        const [x1, y1] = at(bu + swing, side * r * 1.1);
        g.bone(x0, y0, x1, y1, 2.6, leg);
      }
    }
    g.part((p) => {
      oval(p, at, c, s, k, r * 0.95 + du, 0, r * 0.32, r * 0.36, [rim[1], rim[2], rim[2]]);
      for (const side of [-1, 1]) {
        const [ex, ey] = at(r * 1.1 + du, side * r * 0.16);
        p.p(Math.round(ex), Math.round(ey), act === 'rear' ? RED_EYE : EMBER);
      }
    });
    g.part((p) => {
      oval(p, at, c, s, k, -r * 0.05, 0, r * 1.02, r * 0.86, [rim[1], rim[1], rim[2]]);
      oval(p, at, c, s, k, -r * 0.1, 0, r * 0.84, r * 0.68, plate);
      const [a0x, a0y] = at(-r * 0.9, 0);
      const [a1x, a1y] = at(r * 0.7, 0);
      p.seam(a0x, a0y, a1x, a1y, rim[1]);
      const [b0x, b0y] = at(-r * 0.1, -r * 0.66);
      const [b1x, b1y] = at(-r * 0.1, r * 0.66);
      p.seam(b0x, b0y, b1x, b1y, rim[1]);
      for (const [bu, bv] of [[-0.5, -0.35], [0.3, -0.35], [-0.5, 0.35], [0.3, 0.35]]) {
        const [px, py] = at(bu * r, bv * r);
        p.p(Math.round(px), Math.round(py), plate[0]);
        p.p(Math.round(px) + 1, Math.round(py) + 1, plate[2]);
      }
      p.p(-7, -5, WHITE);
      p.p(-6, -5, WHITE);
      p.p(-5, -6, plate[0]);
    });
    return finish(g, flash);
  });
}

// ─── Wisp ───────────────────────────────────────────────────────────────────

export const WISP_LOOKS = 8;

/**
 * A wisp's body: a lantern of light, white at the heart, with hollow eyes
 * looking ahead. Its glow and tail stay soft, since they are light rather
 * than a thing; only the body is pixels.
 */
export function drawPixelWisp(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  act: MobAct,
  look: number,
  flash: boolean,
): void {
  const pose = act === 'rear' || act === 'lunge' ? act : 'still';
  const key = `pm|wisp|${pose}|${look}|${flash ? 1 : 0}`;
  blitPixels(ctx, key, x, cy, 12, 12, 1, () => {
    const def = MOBS.wisp;
    const r = def.radius * 0.82;
    const g = new Sprite(25, 25, 12, 12);
    const glow: Ramp = [[255, 255, 255], [220, 212, 255], ramp(def.color)[1]];
    for (let py = -Math.ceil(r); py <= Math.ceil(r); py++) {
      for (let px = -Math.ceil(r); px <= Math.ceil(r); px++) {
        const d = Math.hypot(px + 2, py + 2) / r;
        if (Math.hypot(px, py) > r + 0.3) continue;
        g.p(px, py, d < 0.45 ? glow[0] : d < 0.95 ? glow[1] : glow[2]);
      }
    }
    const a = (look / WISP_LOOKS) * Math.PI * 2;
    const ex = Math.round(Math.cos(a) * 2);
    const ey = Math.round(Math.sin(a) * 1);
    const hollow: Rgb = pose === 'rear' ? [120, 30, 60] : [42, 31, 85];
    for (const side of [-1, 1]) {
      const px = ex + side * 3 - (side < 0 ? 1 : 0);
      for (let dy = -1; dy <= (pose === 'lunge' ? 2 : 1); dy++) {
        g.p(px, ey + dy, hollow);
        g.p(px + 1, ey + dy, hollow);
      }
    }
    if (flash) g.silhouette(FLASH);
    g.outline(ramp(def.accent)[2]);
    return g;
  });
}
