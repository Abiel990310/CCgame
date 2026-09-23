import type { World } from '@shared/sim/types';

/** How far ahead of the clock notes are scheduled, in seconds. */
const LOOKAHEAD = 0.5;

interface Mood {
  /** Semitone offsets from the root, one octave of the scale. */
  scale: number[];
  /** Root in Hz. */
  root: number;
  /** Seconds per step. */
  step: number;
  /** Chance a step sounds at all — the rests are what keep it cozy. */
  density: number;
  wave: OscillatorType;
  gain: number;
}

const DAY: Mood = {
  scale: [0, 2, 4, 7, 9],
  root: 261.63,
  step: 0.4,
  density: 0.42,
  wave: 'triangle',
  gain: 0.2,
};

const NIGHT: Mood = {
  scale: [0, 3, 5, 7, 10],
  root: 196.0,
  step: 0.52,
  density: 0.26,
  wave: 'sine',
  gain: 0.17,
};

function hz(mood: Mood, degree: number): number {
  const octave = Math.floor(degree / mood.scale.length);
  const note = mood.scale[((degree % mood.scale.length) + mood.scale.length) % mood.scale.length];
  return mood.root * Math.pow(2, (note + octave * 12) / 12);
}

/**
 * A generative pentatonic layer rather than a looping track: a recorded piece
 * would be the only file in a bundle that otherwise fetches nothing, and after
 * a few hours on one island a loop is worse than silence. A random walk over a
 * pentatonic scale cannot land on a wrong note, so it stays pleasant without
 * anyone composing it.
 */
export class Music {
  private out: GainNode;
  private tail: DelayNode;
  private feedback: GainNode;
  private next = 0;
  private step = 0;
  /** Current position in the scale, walked rather than jumped. */
  private degree = 4;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 1;

    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowpass';
    shelf.frequency.value = 2600;

    // One delay line does the work of a reverb at a fraction of the cost, and
    // is most of why a bare oscillator stops sounding like a test tone.
    this.tail = ctx.createDelay(1);
    this.tail.delayTime.value = 0.34;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.32;

    this.out.connect(shelf);
    shelf.connect(dest);
    shelf.connect(this.tail);
    this.tail.connect(this.feedback);
    this.feedback.connect(this.tail);
    this.tail.connect(dest);
  }

  update(world: World): void {
    const mood = world.phase === 'night' ? NIGHT : DAY;
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now + 0.05;

    while (this.next < now + LOOKAHEAD) {
      this.emit(mood, this.next);
      this.next += mood.step;
      this.step++;
    }
  }

  private emit(mood: Mood, at: number): void {
    // A bar's downbeat carries the root underneath whatever the melody does.
    if (this.step % 8 === 0) this.note(hz(mood, 0) / 2, at, mood.gain * 0.5, 2.4, 'sine');

    if (Math.random() > mood.density) return;

    const walk = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    this.degree = Math.max(0, Math.min(mood.scale.length * 2 - 1, this.degree + walk));
    this.note(hz(mood, this.degree), at, mood.gain, 1.1, mood.wave);
  }

  private note(
    freq: number,
    at: number,
    level: number,
    length: number,
    wave: OscillatorType,
  ): void {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    gain.connect(this.out);

    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + length);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  stop(): void {
    this.out.disconnect();
    this.tail.disconnect();
    this.feedback.disconnect();
  }
}
