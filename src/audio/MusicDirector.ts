/**
 * Turns game state into music.
 *
 * The key rule: tier changes are *queued*, never applied immediately. They
 * commit on the next bar line. A layer that appears halfway through a bar reads
 * as a glitch; the same layer entering on the downbeat reads as a drop.
 */

import { AudioEngine } from './AudioEngine';
import { Scheduler, STEPS_PER_BAR, type StepEvent } from './Scheduler';
import {
  ACID_ACCENTS,
  ACID_LINE,
  ACID_SLIDES,
  BASS_ACCENTS,
  BASS_LINE,
  CLAP_PATTERN,
  CLOSED_HAT_PATTERN,
  KICK_PATTERN,
  NUM_TIERS,
  OPEN_HAT_PATTERN,
  RIDE_PATTERN,
  STAB_CHORD,
  STAB_PATTERN,
  TIERS,
  noteHz,
  scaleDegree,
} from './patterns';
import * as voices from './voices';

/** Visual events the renderer cares about, timestamped in AudioContext time. */
export interface BeatPulse {
  time: number;
  kind: 'kick' | 'clap' | 'hat' | 'acid';
  strength: number;
}

export class MusicDirector {
  private readonly engine: AudioEngine;
  private readonly scheduler: Scheduler;

  private tier = 0;
  private pendingTier: number | null = null;
  private riserScheduled = false;

  /** Bar counter, used to walk the two-bar acid line. */
  private bar = 0;

  private pulses: BeatPulse[] = [];

  /** Fired when a queued tier change actually commits. */
  onTierChange: ((tier: number, previous: number) => void) | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.scheduler = new Scheduler(engine.ctx, (event) => this.handleStep(event));
  }

  get currentTier(): number {
    return this.tier;
  }

  get transport(): Scheduler {
    return this.scheduler;
  }

  start(): void {
    this.tier = 0;
    this.pendingTier = null;
    this.bar = 0;
    this.pulses = [];
    this.scheduler.setBpm(TIERS[0].bpm, 0);
    this.engine.setDelayTimeForBpm(TIERS[0].bpm);
    // Small offset so the first bar is fully inside the lookahead window.
    this.scheduler.start(this.engine.ctx.currentTime + 0.1);
  }

  stop(): void {
    this.scheduler.stop();
  }

  /** Queue a tier. Commits on the next bar line. */
  requestTier(tier: number): void {
    const clamped = Math.max(0, Math.min(NUM_TIERS - 1, tier));
    if (clamped === this.tier && this.pendingTier === null) return;
    if (clamped === this.tier) {
      this.pendingTier = null;
      return;
    }
    this.pendingTier = clamped;
  }

  /** Wrong answer: immediate audible penalty, tier drop still lands on the bar. */
  fireBrake(): void {
    const time = this.engine.ctx.currentTime + 0.01;
    voices.brake(this.engine.bus, time, 0.45);
    this.engine.brakeDuck(time, 0.45);
  }

  fireCorrect(onBeat: boolean): void {
    const time = this.engine.ctx.currentTime + 0.01;
    // Chime sits on a scale degree so it never fights the key.
    voices.chime(this.engine.bus, time, noteHz(scaleDegree(14)) * 2);
    if (onBeat) voices.rim(this.engine.bus, time, 1.4);
  }

  /** Drain beat pulses whose moment has arrived, for the visualizer. */
  drainPulses(now: number): BeatPulse[] {
    // The scheduler's queue drives the tempo-accurate part; pulses carry the
    // kind/strength the visuals need.
    this.scheduler.drainVisualQueue(now);
    if (this.pulses.length === 0) return [];
    let count = 0;
    while (count < this.pulses.length && this.pulses[count].time <= now) count += 1;
    if (count === 0) return [];
    return this.pulses.splice(0, count);
  }

  /**
   * Distance from a moment to the nearest beat, compensated for output latency.
   * Used by the on-beat scoring bonus.
   */
  distanceToBeat(time: number): number {
    return this.scheduler.distanceToNearestBeat(time - this.engine.outputLatency);
  }

  private pulse(time: number, kind: BeatPulse['kind'], strength: number): void {
    this.pulses.push({ time, kind, strength });
    if (this.pulses.length > 256) this.pulses.shift();
  }

  private handleStep(event: StepEvent): void {
    const { stepInBar, time } = event;

    if (stepInBar === 0) {
      this.commitPendingTier();
      this.bar += 1;
    }

    const cfg = TIERS[this.tier];
    const stepDuration = 60 / event.bpm / 4;

    // Riser goes on the last beat of the bar before an increase.
    if (
      this.pendingTier !== null &&
      this.pendingTier > this.tier &&
      stepInBar === 12 &&
      !this.riserScheduled
    ) {
      voices.riser(this.engine.bus, time, stepDuration * 4);
      this.riserScheduled = true;
    }

    if (cfg.kick && KICK_PATTERN[stepInBar]) {
      voices.kick(this.engine.bus, time);
      this.engine.duck(time, cfg.sidechainDepth, stepDuration * 2.4);
      this.pulse(time, 'kick', 1);
    }

    if (cfg.sub && stepInBar === 0) {
      voices.sub(this.engine.bus, time, noteHz(0), stepDuration * 3.5);
    }

    if (cfg.closedHat && CLOSED_HAT_PATTERN[stepInBar]) {
      voices.hat(this.engine.bus, time, false);
      this.pulse(time, 'hat', 0.35);
    }

    if (cfg.openHat && OPEN_HAT_PATTERN[stepInBar]) {
      voices.hat(this.engine.bus, time, true);
      this.pulse(time, 'hat', 0.5);
    }

    if (cfg.clap && CLAP_PATTERN[stepInBar]) {
      voices.clap(this.engine.bus, time);
      this.pulse(time, 'clap', 0.8);
    }

    if (cfg.ride && RIDE_PATTERN[stepInBar]) {
      voices.ride(this.engine.bus, time);
    }
    if (cfg.rideSixteenths && stepInBar % 2 === 1 && !RIDE_PATTERN[stepInBar]) {
      voices.ride(this.engine.bus, time, 0.6);
    }

    if (cfg.bassline) {
      const degree = BASS_LINE[stepInBar];
      if (degree !== null) {
        voices.bass(this.engine.bus, time, {
          freq: noteHz(scaleDegree(degree)),
          duration: stepDuration * 0.9,
          cutoff: 320 + this.tier * 90,
          accent: BASS_ACCENTS[stepInBar] === 1,
        });
      }
    }

    if (cfg.acid) {
      // Two-bar line: alternate halves on odd/even bars.
      const acidStep = ((this.bar - 1) % 2) * STEPS_PER_BAR + stepInBar;
      const degree = ACID_LINE[acidStep];
      if (degree !== null) {
        const previous = this.previousAcidNote(acidStep);
        voices.acid(this.engine.bus, time, {
          freq: noteHz(scaleDegree(degree)),
          duration: stepDuration * (ACID_SLIDES[acidStep] ? 1.8 : 0.85),
          cutoff: cfg.acidCutoff,
          resonance: cfg.acidResonance,
          accent: ACID_ACCENTS[acidStep] === 1,
          slideFrom:
            ACID_SLIDES[acidStep] && previous !== null
              ? noteHz(scaleDegree(previous))
              : undefined,
          send: cfg.acidSend,
        });
        if (ACID_ACCENTS[acidStep]) this.pulse(time, 'acid', 0.6);
      }
    }

    if (cfg.stabs && STAB_PATTERN[stepInBar]) {
      voices.stab(
        this.engine.bus,
        time,
        STAB_CHORD.map((d) => noteHz(scaleDegree(d) + 12)),
        cfg.acidSend,
      );
    }
  }

  private previousAcidNote(index: number): number | null {
    for (let i = 1; i <= 4; i++) {
      const candidate = ACID_LINE[(index - i + ACID_LINE.length) % ACID_LINE.length];
      if (candidate !== null) return candidate;
    }
    return null;
  }

  private commitPendingTier(): void {
    this.riserScheduled = false;
    if (this.pendingTier === null) return;
    const previous = this.tier;
    this.tier = this.pendingTier;
    this.pendingTier = null;

    const cfg = TIERS[this.tier];
    this.scheduler.setBpm(cfg.bpm, STEPS_PER_BAR * 2);
    this.engine.setDelayTimeForBpm(cfg.bpm);
    this.onTierChange?.(this.tier, previous);
  }
}
