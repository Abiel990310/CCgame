import { CYCLE } from '@shared/sim/constants';
import type { World } from '@shared/sim/types';
import { compositesInSoftware } from './softgl';

/**
 * The colour grade laid over the island: a little colour pulled out of the
 * whole scene, a warm cast at dawn and dusk, a cold one at night, and a
 * vignette that holds the eye on the middle of the screen.
 *
 * Every screen shared one flat, evenly lit palette before this, so noon, dusk
 * and a raid all looked like the same picture. Games that feel finished hold
 * a mood, and the cheapest honest way to get one is to grade the frame the way
 * a film is graded rather than to repaint every sprite.
 *
 * It is three stacked elements the browser's compositor blends over the
 * stage, like the night layers: nothing is drawn per frame, only a few style
 * values change, and only when they move by a visible step. That keeps it
 * identical under Canvas and Pixi, which draw into different elements.
 */
export class Grade {
  private readonly mute = layer('saturation');
  private readonly tint = layer('soft-light');
  private readonly vignette = layer('normal');
  private last = '';
  /**
   * Without a graphics card each blended layer costs about a sixth of the
   * frame rate at night, so only the plain vignette is kept; the night shade
   * carries its own cold colour either way.
   */
  private readonly lite = gradeMode() === 'lite';

  constructor() {
    this.mute.style.background = '#808080';
    // An ellipse sized to the screen, so a phone held either way is framed alike.
    this.vignette.style.background =
      'radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(6,8,16,0.55) 100%)';
  }

  /** The layers in stacking order, for the renderer to put over the stage. */
  get elements(): HTMLElement[] {
    return this.lite ? [this.vignette] : [this.mute, this.tint, this.vignette];
  }

  update(world: World, darkness: number): void {
    const g = gradeFor(world, darkness);
    const key = `${g.mute.toFixed(2)}|${g.tint}|${g.tintAlpha.toFixed(2)}|${g.vignette.toFixed(2)}`;
    if (key === this.last) return;
    this.last = key;
    this.mute.style.opacity = g.mute.toFixed(2);
    this.tint.style.background = g.tint;
    this.tint.style.opacity = g.tintAlpha.toFixed(2);
    this.vignette.style.opacity = g.vignette.toFixed(2);
  }
}

export interface GradeValues {
  /** How far toward grey the scene is pulled, 0..1. */
  mute: number;
  tint: string;
  tintAlpha: number;
  vignette: number;
}

const GOLD = [255, 150, 60];
const DUSK = [255, 110, 70];
const NIGHT = [22, 44, 110];

/**
 * The grade for a moment of the day. Warmth rises through the last third of
 * the day toward a rose-amber dusk and lingers briefly after dawn; the night
 * cast follows the same darkness curve as the night shade so the two never
 * disagree.
 */
export function gradeFor(world: World, darkness: number): GradeValues {
  let morning = 0;
  let evening = 0;
  if (world.phase === 'day') {
    const into = 1 - world.phaseTime / CYCLE.daySeconds;
    morning = Math.max(0, 1 - into / 0.15);
    evening = smoothstep(0.6, 1, into);
  }
  const warm = Math.max(morning * 0.7, evening) * (1 - darkness);
  // Late afternoon is gold; the last minute before dark turns toward rose.
  const warmColor = mix(GOLD, DUSK, evening * evening);
  const total = warm + darkness;
  const color = total > 0 ? mix(warmColor, NIGHT, darkness / total) : GOLD;
  return {
    mute: 0.12 + darkness * 0.3,
    tint: `rgb(${color.map((c) => Math.round(c)).join(',')})`,
    tintAlpha: Math.min(0.6, warm * 0.5 + darkness * 0.55),
    vignette: 0.55 + darkness * 0.45,
  };
}

const GRADE_KEY = 'ccgame.grade';

/** `?grade=full` or `?grade=lite` overrides the guess, and is remembered, like `?renderer=`. */
function gradeMode(): 'full' | 'lite' {
  try {
    const asked = new URLSearchParams(location.search).get('grade');
    if (asked === 'full' || asked === 'lite') localStorage.setItem(GRADE_KEY, asked);
    const stored = localStorage.getItem(GRADE_KEY);
    if (stored === 'full' || stored === 'lite') return stored;
  } catch {
    // Storage can be off entirely; fall back to the guess.
  }
  return compositesInSoftware() ? 'lite' : 'full';
}

function layer(blend: string): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    mixBlendMode: blend,
    opacity: '0',
  });
  return el;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}
