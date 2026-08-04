/**
 * Synth voices. Every voice builds its own short-lived node graph, starts it at
 * an exact time, and stops it — the graph is then garbage collected.
 *
 * Rule that applies to all of them: gain never changes abruptly. A bare
 * setValueAtTime to or from zero produces a click on every single hit, which is
 * fatal at 140 BPM. Everything ramps, even if only over 3ms.
 */

export interface VoiceBus {
  ctx: AudioContext;
  /** Sidechained bus — everything pumping under the kick. */
  music: AudioNode;
  /** Un-sidechained bus for the kick itself and UI accents. */
  dry: AudioNode;
  /** Send into the delay line, used for acid throws and stabs. */
  delaySend: AudioNode;
}

/** Shortest gain ramp that is reliably click-free. */
const CLICK_GUARD = 0.003;

/**
 * Shared noise buffer. Generating white noise per hit would allocate a fresh
 * buffer for every hat at 16th notes; one buffer read from random offsets is
 * indistinguishable and free.
 */
let noiseBuffer: AudioBuffer | null = null;

export function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** Reset cached buffers. Only needed when tearing down between contexts. */
export function resetVoiceCaches(): void {
  noiseBuffer = null;
}

function noiseSource(ctx: AudioContext, time: number, duration: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  // Random offset so successive hats are not bit-identical.
  const offset = Math.random() * (src.buffer.duration - duration - 0.01);
  src.start(time, Math.max(0, offset), duration + 0.02);
  src.stop(time + duration + 0.02);
  return src;
}

/** Percussive decay envelope: fast attack, exponential-ish fall to silence. */
function decayEnv(
  ctx: AudioContext,
  time: number,
  peak: number,
  decay: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + CLICK_GUARD);
  gain.gain.exponentialRampToValueAtTime(peak * 0.001, time + decay);
  gain.gain.linearRampToValueAtTime(0, time + decay + CLICK_GUARD);
  return gain;
}

export function kick(bus: VoiceBus, time: number, gainScale = 1): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(50, time + 0.04);

  // Body and click peak together, so their sum has to stay under full scale —
  // the master soft-clipper would mask it, but only by spending headroom the
  // rest of the mix needs at the top tier.
  const env = decayEnv(ctx, time, 0.82 * gainScale, 0.25);

  // Click transient on top — this is what makes a kick cut through a dense mix.
  const click = noiseSource(ctx, time, 0.01);
  const clickFilter = ctx.createBiquadFilter();
  clickFilter.type = 'highpass';
  clickFilter.frequency.value = 1200;
  const clickEnv = decayEnv(ctx, time, 0.13 * gainScale, 0.012);

  osc.connect(env).connect(bus.dry);
  click.connect(clickFilter).connect(clickEnv).connect(bus.dry);

  osc.start(time);
  osc.stop(time + 0.3);
}

export function sub(bus: VoiceBus, time: number, freq: number, duration: number): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);

  const env = decayEnv(ctx, time, 0.55, duration);
  osc.connect(env).connect(bus.music);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

export interface BassParams {
  freq: number;
  duration: number;
  cutoff: number;
  accent: boolean;
}

export function bass(bus: VoiceBus, time: number, p: BassParams): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(p.freq, time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = p.accent ? 8 : 4;
  filter.frequency.setValueAtTime(p.cutoff * (p.accent ? 1.8 : 1), time);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(80, p.cutoff * 0.5),
    time + p.duration,
  );

  const env = decayEnv(ctx, time, p.accent ? 0.34 : 0.24, p.duration);
  osc.connect(filter).connect(env).connect(bus.music);
  osc.start(time);
  osc.stop(time + p.duration + 0.05);
}

export function hat(bus: VoiceBus, time: number, open: boolean, gainScale = 1): void {
  const { ctx } = bus;
  const duration = open ? 0.18 : 0.04;
  const src = noiseSource(ctx, time, duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = open ? 7000 : 9000;

  const env = decayEnv(ctx, time, (open ? 0.16 : 0.13) * gainScale, duration);
  src.connect(filter).connect(env).connect(bus.music);
}

export function clap(bus: VoiceBus, time: number): void {
  const { ctx } = bus;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1600;
  filter.Q.value = 1.2;
  filter.connect(bus.music);

  // Three tight bursts plus a longer tail — the classic 909 clap construction.
  const offsets = [0, 0.009, 0.019];
  for (const offset of offsets) {
    const src = noiseSource(ctx, time + offset, 0.02);
    const env = decayEnv(ctx, time + offset, 0.3, 0.02);
    src.connect(env).connect(filter);
  }
  const tail = noiseSource(ctx, time + 0.026, 0.16);
  const tailEnv = decayEnv(ctx, time + 0.026, 0.22, 0.16);
  tail.connect(tailEnv).connect(filter);
}

export function ride(bus: VoiceBus, time: number, gainScale = 1): void {
  const { ctx } = bus;
  const src = noiseSource(ctx, time, 0.09);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 6200;
  filter.Q.value = 0.8;
  const env = decayEnv(ctx, time, 0.07 * gainScale, 0.09);
  src.connect(filter).connect(env).connect(bus.music);
}

export interface AcidParams {
  freq: number;
  duration: number;
  /** Filter envelope peak, Hz. Opens up as the tier climbs. */
  cutoff: number;
  resonance: number;
  accent: boolean;
  /** Portamento from the previous note, seconds. 0 for no slide. */
  slideFrom?: number;
  /** 0..1 amount sent to the delay line. */
  send?: number;
}

export function acid(bus: VoiceBus, time: number, p: AcidParams): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  if (p.slideFrom) {
    osc.frequency.setValueAtTime(p.slideFrom, time);
    osc.frequency.exponentialRampToValueAtTime(p.freq, time + 0.06);
  } else {
    osc.frequency.setValueAtTime(p.freq, time);
  }

  // The whole 303 sound is this: a resonant lowpass with a fast envelope on the
  // cutoff, sweeping down through the harmonics of a saw.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = p.resonance;
  const peak = p.cutoff * (p.accent ? 1.6 : 1);
  filter.frequency.setValueAtTime(Math.max(120, peak), time);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(110, p.cutoff * 0.25),
    time + p.duration * 0.9,
  );

  const env = decayEnv(ctx, time, p.accent ? 0.24 : 0.17, p.duration);
  osc.connect(filter).connect(env);
  env.connect(bus.music);

  if (p.send && p.send > 0) {
    const send = ctx.createGain();
    send.gain.value = p.send;
    env.connect(send).connect(bus.delaySend);
  }

  osc.start(time);
  osc.stop(time + p.duration + 0.05);
}

export function stab(bus: VoiceBus, time: number, freqs: number[], send = 0.3): void {
  const { ctx } = bus;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, time);
  filter.frequency.exponentialRampToValueAtTime(900, time + 0.18);
  filter.Q.value = 2;

  const env = decayEnv(ctx, time, 0.13, 0.2);
  filter.connect(env);
  env.connect(bus.music);

  const sendGain = ctx.createGain();
  sendGain.gain.value = send;
  env.connect(sendGain).connect(bus.delaySend);

  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    // Slight detune per voice so the chord has width.
    osc.detune.value = (Math.random() - 0.5) * 12;
    osc.connect(filter);
    osc.start(time);
    osc.stop(time + 0.25);
  }
}

/** Uplifting noise sweep, fired on the bar before a tier increase. */
export function riser(bus: VoiceBus, time: number, duration: number): void {
  const { ctx } = bus;
  const src = noiseSource(ctx, time, duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(400, time);
  filter.frequency.exponentialRampToValueAtTime(8000, time + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.22, time + duration * 0.85);
  gain.gain.linearRampToValueAtTime(0, time + duration);

  src.connect(filter).connect(gain).connect(bus.dry);
}

/** Downward pitch/filter drop, fired on a wrong answer. */
export function brake(bus: VoiceBus, time: number, duration = 0.5): void {
  const { ctx } = bus;
  const src = noiseSource(ctx, time, duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(6000, time);
  filter.frequency.exponentialRampToValueAtTime(180, time + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.3, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  gain.gain.linearRampToValueAtTime(0, time + duration + CLICK_GUARD);

  src.connect(filter).connect(gain).connect(bus.dry);

  // Detuned sine dropping an octave underneath, for weight.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + duration);
  const oscEnv = decayEnv(ctx, time, 0.35, duration);
  osc.connect(oscEnv).connect(bus.dry);
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

/** Short pitched blip for correct answers. */
export function chime(bus: VoiceBus, time: number, freq: number): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, time);
  const env = decayEnv(ctx, time, 0.2, 0.18);
  osc.connect(env).connect(bus.dry);
  osc.start(time);
  osc.stop(time + 0.22);
}

/** Dry rimshot — the scratchpad tick and the on-beat accent. */
export function rim(bus: VoiceBus, time: number, gainScale = 1): void {
  const { ctx } = bus;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(440, time);
  osc.frequency.exponentialRampToValueAtTime(180, time + 0.03);
  const env = decayEnv(ctx, time, 0.16 * gainScale, 0.045);

  const src = noiseSource(ctx, time, 0.02);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  const noiseEnv = decayEnv(ctx, time, 0.1 * gainScale, 0.02);

  osc.connect(env).connect(bus.dry);
  src.connect(filter).connect(noiseEnv).connect(bus.dry);
  osc.start(time);
  osc.stop(time + 0.08);
}
