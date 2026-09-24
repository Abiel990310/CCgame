import { MACHINES } from '@shared/data/machines';
import { TILE } from '@shared/sim/constants';
import type { Vec2, World } from '@shared/sim/types';
import { noiseBuffer } from './synth';

/** Seconds between recounts of what is running nearby. */
const SURVEY_INTERVAL = 0.3;
/** How far from the camera a machine still counts toward the factory hum. */
const EARSHOT = 560;

/** A looping noise bed with a slowly wandering cutoff — wind, surf, hum. */
class Bed {
  private source: AudioBufferSourceNode;
  private filter: BiquadFilterNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  readonly gain: GainNode;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    type: BiquadFilterType,
    cutoff: number,
    sway: number,
    rate: number,
  ) {
    this.source = ctx.createBufferSource();
    this.source.buffer = noiseBuffer(ctx);
    this.source.loop = true;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.filter.frequency.value = cutoff;
    this.filter.Q.value = 0.7;

    // A static noise bed reads as tape hiss; the drift is what makes it weather.
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = rate;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = sway;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filter.frequency);

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;

    this.source.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(dest);
    this.source.start();
    this.lfo.start();
  }

  set(level: number, cutoff: number): void {
    const now = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(level, now, 1.2);
    this.filter.frequency.setTargetAtTime(cutoff, now, 1.5);
  }

  stop(): void {
    this.source.stop();
    this.lfo.stop();
    this.source.disconnect();
    this.filter.disconnect();
    this.lfoGain.disconnect();
    this.gain.disconnect();
  }
}

/**
 * The bed the island sits on: wind, surf, a night drone that thickens with the
 * raid, and a factory hum that grows with what you have built. The hum is the
 * point — a big factory should be audible from the camp, so the island sounds
 * like the hours you have put into it.
 */
export class Ambience {
  private wind: Bed;
  private surf: Bed;
  private hum: GainNode;
  private humFilter: BiquadFilterNode;
  private humVoices: OscillatorNode[] = [];
  private belts: Bed;
  private drone: GainNode;
  private droneVoices: OscillatorNode[] = [];
  private droneFilter: BiquadFilterNode;

  private survey = 0;
  /** Machines running within earshot, and items moving on nearby belts. */
  private running = 0;
  private moving = 0;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.wind = new Bed(ctx, dest, 'lowpass', 420, 180, 0.07);
    this.surf = new Bed(ctx, dest, 'lowpass', 240, 90, 0.031);
    this.belts = new Bed(ctx, dest, 'bandpass', 1600, 400, 3.1);

    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 380;
    this.humFilter.Q.value = 0.8;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    this.humFilter.connect(this.hum);
    this.hum.connect(dest);
    for (const [freq, detune] of [
      [55, -7],
      [55, 9],
      [110, 4],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(this.humFilter);
      osc.start();
      this.humVoices.push(osc);
    }

    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 260;
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.droneFilter.connect(this.drone);
    this.drone.connect(dest);
    for (const [freq, detune] of [
      [49, -5],
      [73.5, 6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(this.droneFilter);
      osc.start();
      this.droneVoices.push(osc);
    }
  }

  update(world: World, camera: Vec2, dt: number): void {
    this.survey -= dt;
    if (this.survey <= 0) {
      this.survey = SURVEY_INTERVAL;
      this.recount(world, camera);
    }

    const night = world.phase === 'night';
    const now = this.ctx.currentTime;

    this.wind.set(night ? 0.14 : 0.075, night ? 300 : 460);
    this.surf.set(0.06, 250);

    // Diminishing returns: the tenth furnace should thicken the hum, the
    // hundredth should not drown the island.
    const factory = Math.min(1, Math.log1p(this.running) / Math.log1p(24));
    this.hum.gain.setTargetAtTime(factory * 0.055, now, 0.8);
    this.humFilter.frequency.setTargetAtTime(300 + factory * 320, now, 0.9);

    const shuffle = Math.min(1, Math.log1p(this.moving) / Math.log1p(40));
    this.belts.set(shuffle * 0.02, 1500 + shuffle * 900);

    // Peaceful islands still get dusk, just without the dread under it.
    const pressure = world.peaceful ? 0 : Math.min(1, world.mobs.length / 12);
    this.drone.gain.setTargetAtTime(night ? 0.035 + pressure * 0.05 : 0, now, night ? 2.5 : 4);
  }

  private recount(world: World, camera: Vec2): void {
    let running = 0;
    let moving = 0;

    for (const machine of world.machines) {
      if (machine.stalled || MACHINES[machine.type].family === 'chest') continue;
      const dx = machine.tx * TILE + TILE / 2 - camera.x;
      const dy = machine.ty * TILE + TILE / 2 - camera.y;
      if (dx * dx + dy * dy < EARSHOT * EARSHOT) running++;
    }
    for (const belt of world.belts) {
      if (belt.items.length === 0) continue;
      const dx = belt.tx * TILE + TILE / 2 - camera.x;
      const dy = belt.ty * TILE + TILE / 2 - camera.y;
      if (dx * dx + dy * dy < EARSHOT * EARSHOT) moving += belt.items.length;
    }

    this.running = running;
    this.moving = moving;
  }

  stop(): void {
    this.wind.stop();
    this.surf.stop();
    this.belts.stop();
    for (const osc of [...this.humVoices, ...this.droneVoices]) {
      osc.stop();
      osc.disconnect();
    }
    this.humFilter.disconnect();
    this.hum.disconnect();
    this.droneFilter.disconnect();
    this.drone.disconnect();
  }
}
