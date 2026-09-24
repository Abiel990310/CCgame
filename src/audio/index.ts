import { MACHINES } from '@shared/data/machines';
import { TILE } from '@shared/sim/constants';
import type { MachineFamily, SimEvent, Vec2, World } from '@shared/sim/types';
import { Ambience } from './ambience';
import { Music } from './music';
import { SOUNDS, type SoundDef, type SoundId } from './sounds';
import { playLayer } from './synth';

const STORE_KEY = 'ccgame.audio.v1';

/** Each slider is its own bus, so turning music off leaves feedback intact. */
export type Bus = 'master' | 'sfx' | 'ambience' | 'music';

export type AudioSettings = Record<Bus, number> & { muted: boolean };

const DEFAULTS: AudioSettings = {
  master: 0.7,
  sfx: 0.9,
  ambience: 0.7,
  music: 0.45,
  muted: false,
};

/** Beyond this many tiles from the camera a sound is not worth a voice. */
const EARSHOT = TILE * 22;
/** Sounds started in one tick, before the rest are dropped. */
const VOICE_BUDGET = 8;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: clamp01(parsed.master ?? DEFAULTS.master),
      sfx: clamp01(parsed.sfx ?? DEFAULTS.sfx),
      ambience: clamp01(parsed.ambience ?? DEFAULTS.ambience),
      music: clamp01(parsed.music ?? DEFAULTS.music),
      muted: parsed.muted === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export interface PlayOptions {
  /** Where in the world it happened; omitted means it happened to you. */
  pos?: Vec2;
  /** Extra level on top of the sound's own, 0..1+. */
  gain?: number;
}

/**
 * The whole audio layer. Like `Effects`, it only ever reads simulation events,
 * so `shared/` stays deaf and a headless server never builds one.
 *
 * The context is created on the first input the page sees, because browsers
 * refuse to start one before a gesture; until then every call here is a no-op
 * rather than an error, so nothing has to check whether sound is ready.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private ambience: Ambience | null = null;
  private music: Music | null = null;

  private settings: AudioSettings = typeof localStorage === 'undefined' ? { ...DEFAULTS } : load();
  /** Camera position, so a sound knows where it is relative to the listener. */
  private listener: Vec2 = { x: 0, y: 0 };
  private halfWidth = 400;
  /** Last start time per sound, for throttling. */
  private lastPlayed = new Map<SoundId, number>();
  private budget = VOICE_BUDGET;

  constructor() {
    // Guarded so importing this module outside a browser is inert rather than
    // a crash; the engine then stays a no-op for its whole life.
    if (typeof window === 'undefined') return;

    // Any gesture will do, and one is enough: the context stays alive after.
    const wake = (): void => {
      this.resume();
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);

    document.addEventListener('visibilitychange', () => {
      // A tab in the background should not keep humming at someone.
      if (document.hidden) void this.ctx?.suspend();
      else if (!this.settings.muted) void this.ctx?.resume();
    });
  }

  get volumes(): AudioSettings {
    return { ...this.settings };
  }

  /** Build the graph, or wake it if the browser parked it. Safe to call often. */
  resume(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.settings.muted) void this.ctx.resume();
      return;
    }

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      // A browser that refuses a context just plays a silent game.
      return;
    }

    const master = ctx.createGain();
    master.connect(ctx.destination);
    const make = (): GainNode => {
      const node = ctx.createGain();
      node.connect(master);
      return node;
    };
    this.buses = { master, sfx: make(), ambience: make(), music: make() };

    this.ctx = ctx;
    this.ambience = new Ambience(ctx, this.buses.ambience);
    this.music = new Music(ctx, this.buses.music);
    this.applyVolumes();
  }

  setVolume(bus: Bus, value: number): void {
    this.settings[bus] = clamp01(value);
    // Touching a slider is itself consent to make noise.
    if (this.settings.muted && value > 0) this.settings.muted = false;
    this.resume();
    this.applyVolumes();
    this.save();
  }

  /** Returns the new state, so callers can say which way it went. */
  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    if (!this.settings.muted) this.resume();
    this.applyVolumes();
    this.save();
    return this.settings.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.buses) return;
    const now = this.ctx.currentTime;
    const master = this.settings.muted ? 0 : this.settings.master;
    // Perceived loudness is closer to the square of the slider than the slider.
    this.buses.master.gain.setTargetAtTime(master * master, now, 0.05);
    for (const bus of ['sfx', 'ambience', 'music'] as const) {
      this.buses[bus].gain.setTargetAtTime(this.settings[bus], now, 0.05);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch {
      // A blocked storage quota costs a preference, never the session.
    }
  }

  /** Where the ear is, and how wide the view is, for distance and panning. */
  listenFrom(pos: Vec2, viewWidth: number): void {
    this.listener = pos;
    this.halfWidth = Math.max(160, viewWidth / 2);
  }

  play(id: SoundId, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses || this.settings.muted || ctx.state !== 'running') return;

    const def: SoundDef = SOUNDS[id];
    const now = ctx.currentTime;

    const throttle = def.throttle ?? 0;
    if (throttle > 0 && now - (this.lastPlayed.get(id) ?? -1) < throttle) return;

    let level = def.gain * (options.gain ?? 1);
    let pan = 0;

    if (options.pos) {
      const dx = options.pos.x - this.listener.x;
      const dy = options.pos.y - this.listener.y;
      const dist = Math.hypot(dx, dy);
      if (dist > EARSHOT) return;
      // Linear falloff to silence at the edge of earshot, squared so things
      // right next to you still clearly dominate things across the island.
      const near = 1 - dist / EARSHOT;
      level *= near * near;
      pan = Math.max(-0.85, Math.min(0.85, dx / this.halfWidth));
    }

    if (level < 0.002) return;
    if (this.budget <= 0) return;
    this.budget--;
    this.lastPlayed.set(id, now);

    let dest: AudioNode = buses.sfx;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      panner.connect(buses.sfx);
      dest = panner;
      window.setTimeout(() => panner.disconnect(), 4000);
    }

    const pitch = def.vary ? 1 + (Math.random() * 2 - 1) * def.vary : 1;
    for (const layer of def.layers) playLayer(ctx, dest, layer, now, pitch, level);
  }

  /** Turn one tick of simulation events into sound. */
  consume(events: SimEvent[]): void {
    if (!this.ctx || this.settings.muted) return;
    this.budget = VOICE_BUDGET;

    for (const event of events) {
      switch (event.kind) {
        case 'shot':
          this.play(SHOT_SOUND[event.weapon], { pos: event.pos });
          break;
        case 'hit':
          this.play('hit', { pos: event.pos });
          break;
        case 'mobDied':
          this.play('mobDied', { pos: event.pos });
          break;
        case 'playerHit':
          this.play('playerHit');
          break;
        case 'downed':
          this.play('downed');
          break;
        case 'levelUp':
          this.play('levelUp');
          break;
        case 'goal':
          this.play('goal');
          break;
        case 'gathered':
          this.play('gathered', { pos: event.pos });
          break;
        case 'collected':
          this.play('collected', { pos: event.pos });
          break;
        case 'produced': {
          const sound = PRODUCED_SOUND[MACHINES[event.machine].family];
          if (sound) this.play(sound, { pos: event.pos });
          break;
        }
        case 'placed':
          this.play('placed', { pos: event.pos });
          break;
        case 'built':
          this.play('built', { pos: event.pos });
          break;
        case 'crafted':
          this.play('crafted');
          break;
        case 'removed':
          this.play('removed', { pos: event.pos });
          break;
        case 'phase':
          this.play(event.phase === 'night' ? 'dusk' : 'dawn');
          break;
        default:
          break;
      }
    }
  }

  /** Drive the beds. Called every frame, whether or not the world is ticking. */
  update(world: World, dt: number): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.settings.muted) return;
    this.ambience?.update(world, this.listener, dt);
    if (this.settings.music > 0) this.music?.update(world);
  }
}

const SHOT_SOUND = {
  sling: 'shotSling',
  bow: 'shotBow',
  spark: 'shotSpark',
  thorn: 'shotThorn',
} as const satisfies Record<string, SoundId>;

/**
 * A chest never produces and a splitter only passes items along, but the table
 * has to cover every family. Tiers are keyed by family on purpose: a steel
 * furnace is a furnace, and a row per tier would be five more sounds saying
 * the same thing. A lab consumes rather than
 * produces, so it has no production sound yet.
 */
const PRODUCED_SOUND = {
  miner: 'mined',
  furnace: 'smelted',
  assembler: 'assembled',
  inserter: 'slot',
  chest: 'slot',
  splitter: 'slot',
  lab: null,
  // A trap landing a catch is the rod's sound, since it is the rod's catch.
  fishTrap: 'gathered',
  generator: null,
  solar: null,
  pole: null,
} as const satisfies Record<MachineFamily, SoundId | null>;

export type { SoundId };

/**
 * One engine for the whole page. Sound cuts across the menu, the HUD and the
 * game loop, and three of those are built in different places — threading an
 * instance through all of them would be ceremony around a single mixer.
 */
export const audio = new GameAudio();
