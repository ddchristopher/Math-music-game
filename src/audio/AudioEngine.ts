/**
 * Owns the AudioContext and the master signal chain.
 *
 * Browsers will not let an AudioContext produce sound unless it was created or
 * resumed inside a user gesture, so nothing here may be constructed before the
 * player clicks Start.
 *
 * Chain:
 *   music voices -> sidechain -> masterGain -> softClip -> compressor -> out
 *   kick / accents ------------^ (bypasses sidechain, so it never ducks itself)
 *   delay send -> feedback delay -> sidechain
 */

import type { VoiceBus } from './voices';

/** Gentle saturation curve. Glues the mix and stops peaks from clipping hard. */
function makeSoftClipCurve(amount = 1.6): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly bus: VoiceBus;

  private readonly sidechain: GainNode;
  private readonly masterGain: GainNode;
  private readonly delayNode: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly delayInput: GainNode;

  private volume = 0.8;
  private muted = false;

  constructor() {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    compressor.connect(this.ctx.destination);

    const softClip = this.ctx.createWaveShaper();
    softClip.curve = makeSoftClipCurve();
    softClip.oversample = '2x';
    softClip.connect(compressor);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(softClip);

    this.sidechain = this.ctx.createGain();
    this.sidechain.gain.value = 1;
    this.sidechain.connect(this.masterGain);

    // Delay line: dotted-8th-ish feedback, retuned whenever the tempo changes.
    this.delayInput = this.ctx.createGain();
    this.delayNode = this.ctx.createDelay(1.5);
    this.delayNode.delayTime.value = 0.36;
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0.36;

    const delayTone = this.ctx.createBiquadFilter();
    delayTone.type = 'bandpass';
    delayTone.frequency.value = 1400;
    delayTone.Q.value = 0.7;

    this.delayInput.connect(this.delayNode);
    this.delayNode.connect(delayTone);
    delayTone.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    delayTone.connect(this.sidechain);

    this.bus = {
      ctx: this.ctx,
      music: this.sidechain,
      dry: this.masterGain,
      delaySend: this.delayInput,
    };
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
  }

  suspend(): void {
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  /**
   * Latency between scheduling a sound and the player hearing it. On-beat
   * detection has to account for this — the player reacts to sound that already
   * spent this long in the output pipeline.
   */
  get outputLatency(): number {
    const ctx = this.ctx as AudioContext & { outputLatency?: number };
    return ctx.outputLatency || ctx.baseLatency || 0;
  }

  /**
   * Duck the music bus under a kick. This pumping is most of what separates
   * "techno" from "a drum loop with a bassline".
   */
  duck(time: number, depth: number, releaseTime: number): void {
    const g = this.sidechain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(1, time);
    g.linearRampToValueAtTime(1 - depth, time + 0.008);
    g.linearRampToValueAtTime(1, time + releaseTime);
  }

  /** Wider, slower duck used for the wrong-answer brake. */
  brakeDuck(time: number, duration: number): void {
    const g = this.sidechain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0.12, time + 0.03);
    g.linearRampToValueAtTime(1, time + duration);
  }

  /** Keep delay time musical as the tempo glides. */
  setDelayTimeForBpm(bpm: number): void {
    const eighth = 60 / bpm / 2;
    const target = eighth * 1.5; // dotted eighth
    this.delayNode.delayTime.setTargetAtTime(target, this.ctx.currentTime, 0.2);
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyGain();
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyGain(): void {
    const target = this.muted ? 0 : this.volume;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }
}
