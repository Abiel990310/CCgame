import type { Layer } from './synth';

/**
 * Every sound in the game, as data. Adding one is a row here, the same way a
 * recipe or a mob is a row in `shared/data` — nothing in the audio engine
 * knows what a furnace is.
 */
export interface SoundDef {
  layers: Layer[];
  /** Level of the whole sound, before distance and bus volume. */
  gain: number;
  /** Random pitch spread as a fraction, so a repeated sound never phases. */
  vary?: number;
  /**
   * Seconds this sound refuses to start again. A hundred furnaces finishing on
   * the same tick is one thunk, not a hundred overlapping ones.
   */
  throttle?: number;
}

const TONE = (
  wave: OscillatorType,
  freq: number,
  to: number,
  gain: number,
  attack: number,
  decay: number,
  at = 0,
  detune = 0,
): Layer => ({ kind: 'tone', wave, freq, to, gain, attack, decay, at, detune });

const NOISE = (
  freq: number,
  to: number,
  gain: number,
  attack: number,
  decay: number,
  q = 1,
  at = 0,
  filter: BiquadFilterType = 'bandpass',
): Layer => ({ kind: 'noise', freq, to, gain, attack, decay, q, at, filter });

export const SOUNDS = {
  // ---- Weapons: each one should be recognisable with your eyes shut ----
  shotSling: {
    gain: 0.16,
    vary: 0.08,
    throttle: 0.04,
    layers: [NOISE(1400, 600, 0.6, 0.002, 0.07, 1.4), TONE('triangle', 300, 170, 0.5, 0.002, 0.06)],
  },
  shotBow: {
    gain: 0.18,
    vary: 0.06,
    throttle: 0.05,
    layers: [NOISE(2200, 900, 0.7, 0.001, 0.09, 2.2), TONE('sine', 480, 260, 0.35, 0.002, 0.07)],
  },
  shotSpark: {
    gain: 0.1,
    vary: 0.14,
    throttle: 0.03,
    layers: [TONE('square', 1500, 2600, 0.35, 0.001, 0.05), NOISE(3400, 4200, 0.3, 0.001, 0.04, 3)],
  },
  shotThorn: {
    gain: 0.22,
    vary: 0.05,
    throttle: 0.06,
    layers: [
      TONE('sawtooth', 190, 90, 0.5, 0.003, 0.16, 0, 8),
      NOISE(900, 320, 0.5, 0.002, 0.12, 1.2),
    ],
  },
  shotHarpoon: {
    gain: 0.2,
    vary: 0.05,
    throttle: 0.08,
    layers: [
      NOISE(2600, 700, 0.6, 0.001, 0.14, 1.8),
      TONE('triangle', 140, 70, 0.55, 0.002, 0.18),
      TONE('sine', 900, 420, 0.2, 0.001, 0.08),
    ],
  },
  shotEmber: {
    gain: 0.18,
    vary: 0.1,
    throttle: 0.06,
    layers: [NOISE(500, 1400, 0.5, 0.01, 0.16, 0.8, 0, 'lowpass'), TONE('sine', 220, 330, 0.35, 0.005, 0.12)],
  },
  shotFrost: {
    gain: 0.1,
    vary: 0.12,
    throttle: 0.04,
    layers: [TONE('sine', 2400, 1800, 0.35, 0.001, 0.09), NOISE(6000, 5000, 0.25, 0.001, 0.06, 4, 0, 'highpass')],
  },

  // ---- Combat ----
  blast: {
    gain: 0.24,
    vary: 0.1,
    throttle: 0.07,
    layers: [
      NOISE(700, 120, 0.8, 0.002, 0.3, 0.7, 0, 'lowpass'),
      TONE('sine', 110, 40, 0.6, 0.003, 0.28),
    ],
  },
  spit: {
    gain: 0.12,
    vary: 0.15,
    throttle: 0.08,
    layers: [NOISE(900, 2200, 0.5, 0.004, 0.1, 2), TONE('sine', 360, 520, 0.25, 0.004, 0.08)],
  },
  // A rising buzz: the queen's brood hatching around her.
  summon: {
    gain: 0.2,
    vary: 0.08,
    throttle: 0.5,
    layers: [
      TONE('sawtooth', 120, 240, 0.35, 0.05, 0.5, 0, 18),
      TONE('square', 180, 330, 0.2, 0.06, 0.45, 0.04, 9),
      NOISE(1400, 2600, 0.3, 0.05, 0.4, 3),
    ],
  },
  boss: {
    gain: 0.4,
    vary: 0,
    layers: [
      TONE('sawtooth', 55, 45, 0.5, 0.08, 1.6, 0, 6),
      TONE('triangle', 82, 70, 0.45, 0.1, 1.4, 0.05),
      NOISE(300, 80, 0.5, 0.05, 1.2, 0.6, 0, 'lowpass'),
    ],
  },
  hit: {
    gain: 0.12,
    vary: 0.16,
    throttle: 0.035,
    layers: [NOISE(1800, 900, 0.5, 0.001, 0.05, 1.6), TONE('triangle', 620, 440, 0.3, 0.001, 0.04)],
  },
  mobDied: {
    gain: 0.2,
    vary: 0.1,
    throttle: 0.05,
    layers: [
      TONE('triangle', 420, 120, 0.6, 0.004, 0.22),
      TONE('sine', 210, 70, 0.4, 0.004, 0.26, 0.02),
      NOISE(1200, 300, 0.4, 0.002, 0.16, 1),
    ],
  },
  playerHit: {
    gain: 0.34,
    vary: 0.06,
    layers: [
      TONE('sawtooth', 150, 70, 0.6, 0.004, 0.24, 0, 14),
      NOISE(500, 180, 0.55, 0.002, 0.2, 0.8, 0, 'lowpass'),
    ],
  },
  downed: {
    gain: 0.4,
    layers: [
      TONE('sine', 330, 82, 0.7, 0.02, 0.9),
      TONE('triangle', 165, 55, 0.45, 0.02, 1.1, 0.06),
    ],
  },
  levelUp: {
    gain: 0.3,
    layers: [
      TONE('sine', 523, 523, 0.5, 0.01, 0.2),
      TONE('sine', 659, 659, 0.5, 0.01, 0.22, 0.09),
      TONE('sine', 784, 784, 0.5, 0.01, 0.3, 0.18),
      TONE('triangle', 1046, 1046, 0.3, 0.01, 0.5, 0.27),
    ],
  },

  // A goal met: brighter and shorter than a level-up, since the two often land
  // together and the level-up should still read as the bigger moment.
  goal: {
    gain: 0.24,
    layers: [
      TONE('triangle', 784, 784, 0.45, 0.005, 0.14),
      TONE('triangle', 1175, 1175, 0.4, 0.005, 0.28, 0.07),
      TONE('sine', 1568, 1568, 0.18, 0.01, 0.35, 0.07),
    ],
  },
  beaconStage: {
    gain: 0.3,
    layers: [
      TONE('triangle', 392, 392, 0.4, 0.01, 0.5),
      TONE('triangle', 587, 587, 0.35, 0.01, 0.6, 0.12),
      NOISE(300, 120, 0.3, 0.02, 0.5, 0.7, 0, 'lowpass'),
    ],
  },
  beaconLit: {
    gain: 0.36,
    layers: [
      TONE('triangle', 523, 523, 0.4, 0.02, 1.4),
      TONE('triangle', 659, 659, 0.35, 0.02, 1.5, 0.15),
      TONE('triangle', 784, 784, 0.35, 0.02, 1.6, 0.3),
      TONE('sine', 1047, 1047, 0.3, 0.05, 2.2, 0.45),
    ],
  },

  // ---- Gathering and carrying ----
  gathered: {
    gain: 0.2,
    vary: 0.12,
    throttle: 0.04,
    layers: [TONE('triangle', 340, 180, 0.6, 0.002, 0.11), NOISE(1000, 400, 0.4, 0.001, 0.08, 1.2)],
  },
  collected: {
    gain: 0.13,
    vary: 0.1,
    throttle: 0.045,
    layers: [
      TONE('sine', 880, 880, 0.5, 0.003, 0.06),
      TONE('sine', 1320, 1320, 0.4, 0.003, 0.09, 0.045),
    ],
  },

  // ---- The factory ----
  mined: {
    gain: 0.11,
    vary: 0.14,
    throttle: 0.09,
    layers: [
      NOISE(520, 220, 0.6, 0.002, 0.13, 0.9),
      TONE('triangle', 170, 110, 0.35, 0.003, 0.1),
    ],
  },
  smelted: {
    gain: 0.1,
    vary: 0.1,
    throttle: 0.1,
    layers: [
      NOISE(300, 1100, 0.5, 0.03, 0.18, 0.7, 0, 'lowpass'),
      TONE('sine', 220, 330, 0.3, 0.02, 0.16),
    ],
  },
  assembled: {
    gain: 0.1,
    vary: 0.12,
    throttle: 0.1,
    layers: [
      TONE('square', 900, 700, 0.3, 0.001, 0.035),
      TONE('square', 1200, 950, 0.28, 0.001, 0.04, 0.05),
      NOISE(2000, 1200, 0.25, 0.001, 0.05, 2, 0.05),
    ],
  },

  // ---- Building ----
  placed: {
    gain: 0.26,
    vary: 0.07,
    layers: [
      TONE('triangle', 260, 120, 0.6, 0.002, 0.13),
      NOISE(700, 260, 0.45, 0.001, 0.09, 1.1),
    ],
  },
  built: {
    gain: 0.3,
    vary: 0.05,
    layers: [
      TONE('triangle', 200, 100, 0.6, 0.003, 0.2),
      TONE('sine', 400, 300, 0.35, 0.01, 0.24, 0.03),
      NOISE(600, 200, 0.5, 0.002, 0.14, 0.9),
    ],
  },
  // Two taps of the hammer and a bright ring as the piece comes off the bench.
  crafted: {
    gain: 0.26,
    vary: 0.04,
    layers: [
      NOISE(2600, 1400, 0.5, 0.001, 0.05, 2.2),
      NOISE(2400, 1300, 0.45, 0.001, 0.05, 2.2, 0.09),
      TONE('triangle', 880, 880, 0.35, 0.004, 0.32, 0.17),
      TONE('sine', 1320, 1320, 0.2, 0.004, 0.36, 0.17),
    ],
  },
  removed: {
    gain: 0.24,
    vary: 0.08,
    layers: [
      NOISE(1300, 350, 0.6, 0.002, 0.16, 0.8),
      TONE('triangle', 220, 140, 0.35, 0.002, 0.1, 0.03),
    ],
  },
  denied: {
    gain: 0.18,
    layers: [
      TONE('square', 200, 200, 0.4, 0.002, 0.05),
      TONE('square', 150, 150, 0.4, 0.002, 0.08, 0.07),
    ],
  },

  // ---- Interface ----
  click: {
    gain: 0.12,
    vary: 0.05,
    layers: [TONE('sine', 760, 620, 0.4, 0.001, 0.04), NOISE(2400, 1600, 0.2, 0.001, 0.02, 2)],
  },
  open: {
    gain: 0.14,
    layers: [TONE('sine', 420, 700, 0.5, 0.004, 0.1), TONE('triangle', 840, 1100, 0.2, 0.004, 0.08)],
  },
  close: {
    gain: 0.14,
    layers: [TONE('sine', 700, 380, 0.5, 0.004, 0.1), TONE('triangle', 1100, 620, 0.2, 0.004, 0.08)],
  },
  slot: {
    gain: 0.1,
    vary: 0.1,
    throttle: 0.02,
    layers: [TONE('triangle', 560, 480, 0.35, 0.001, 0.035)],
  },

  // ---- The clock ----
  dawn: {
    gain: 0.3,
    layers: [
      TONE('sine', 392, 392, 0.45, 0.06, 1.1),
      TONE('sine', 523, 523, 0.4, 0.08, 1.2, 0.12),
      TONE('sine', 659, 659, 0.35, 0.1, 1.4, 0.24),
      TONE('triangle', 196, 196, 0.25, 0.12, 1.6),
    ],
  },
  dusk: {
    gain: 0.32,
    layers: [
      TONE('sine', 330, 330, 0.45, 0.06, 1.2),
      TONE('sine', 392, 392, 0.4, 0.08, 1.3, 0.14),
      TONE('triangle', 165, 160, 0.4, 0.15, 1.9),
      NOISE(240, 160, 0.3, 0.3, 1.6, 0.6, 0, 'lowpass'),
    ],
  },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
