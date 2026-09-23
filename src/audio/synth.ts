/**
 * The smallest useful Web Audio voice: an oscillator or a burst of filtered
 * noise, both shaped by the same attack/decay envelope.
 *
 * Every sound in the game is built from these because the bundle ships no
 * audio files — a sample pack would be the first external asset the project
 * has ever had, and the first thing standing between a page load and a
 * playable island.
 */

export type Wave = OscillatorType;

interface Envelope {
  /** Seconds to reach full level. Zero is a click, which is sometimes the point. */
  attack: number;
  /** Seconds from full level back to silence. */
  decay: number;
  /** Seconds to wait before this layer starts, for two-part sounds. */
  at?: number;
  /** Peak level of this layer within the sound, 0..1. */
  gain: number;
}

export interface ToneLayer extends Envelope {
  kind: 'tone';
  wave: Wave;
  freq: number;
  /** Frequency at the end of the decay; a slide is what makes a blip read. */
  to?: number;
  /** Cents of detune on a doubled oscillator, for width. */
  detune?: number;
}

export interface NoiseLayer extends Envelope {
  kind: 'noise';
  /** Filter cutoff or band centre in Hz. */
  freq: number;
  to?: number;
  q?: number;
  filter?: BiquadFilterType;
}

export type Layer = ToneLayer | NoiseLayer;

/**
 * One buffer of white noise per context, reused by every noise voice. Noise is
 * noise, and allocating a second of random floats per footstep is not.
 */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** Shape a gain node into an attack/decay envelope, and say when it is done. */
function envelope(ctx: BaseAudioContext, layer: Layer, start: number, level: number): GainNode {
  const gain = ctx.createGain();
  const attack = Math.max(0.001, layer.attack);
  const peak = Math.max(0.0001, level);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  // Exponential ramps cannot reach zero, so land just under it and cut.
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + Math.max(0.01, layer.decay));
  return gain;
}

/**
 * Schedule one layer. Returns the time it finishes so the caller can retire
 * whatever it built the layer on top of.
 */
export function playLayer(
  ctx: BaseAudioContext,
  dest: AudioNode,
  layer: Layer,
  when: number,
  pitch: number,
  level: number,
): number {
  const start = when + (layer.at ?? 0);
  const end = start + Math.max(0.001, layer.attack) + Math.max(0.01, layer.decay);
  const gain = envelope(ctx, layer, start, level * layer.gain);
  gain.connect(dest);

  const from = layer.freq * pitch;
  const to = (layer.to ?? layer.freq) * pitch;

  if (layer.kind === 'tone') {
    const voices = layer.detune ? [-layer.detune, layer.detune] : [0];
    for (const cents of voices) {
      const osc = ctx.createOscillator();
      osc.type = layer.wave;
      osc.detune.value = cents;
      osc.frequency.setValueAtTime(from, start);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), end);
      osc.connect(gain);
      osc.start(start);
      osc.stop(end);
      osc.onended = () => osc.disconnect();
    }
  } else {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;
    // A random read offset stops repeated bursts sounding like the same sample.
    const offset = Math.random() * 1.5;

    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter ?? 'bandpass';
    filter.Q.value = layer.q ?? 1;
    filter.frequency.setValueAtTime(Math.max(20, from), start);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), end);

    source.connect(filter);
    filter.connect(gain);
    source.start(start, offset);
    source.stop(end);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
    };
  }

  // Freeing the envelope has to wait for the voices feeding it.
  window.setTimeout(
    () => gain.disconnect(),
    Math.max(0, (end - ctx.currentTime) * 1000) + 120,
  );
  return end;
}
