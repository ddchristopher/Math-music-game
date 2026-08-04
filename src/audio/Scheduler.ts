/**
 * Lookahead step scheduler ("Tale of Two Clocks").
 *
 * A coarse JS timer wakes up every TICK_MS and schedules every 16th-note step
 * that falls inside the next LOOKAHEAD_S seconds, at an exact AudioContext
 * time. Audio is never scheduled from requestAnimationFrame — RAF jitter would
 * be plainly audible.
 *
 * Steps are also pushed onto a visual queue that the render loop drains once
 * ctx.currentTime catches up, so beat-synced visuals line up with what is
 * actually coming out of the speakers rather than with when we queued it.
 */

const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;

export interface StepEvent {
  /** Absolute step counter since transport start. */
  step: number;
  /** Position within the bar, 0..15. */
  stepInBar: number;
  /** AudioContext time this step lands at. */
  time: number;
  /** BPM in force for this step. */
  bpm: number;
}

export type StepHandler = (event: StepEvent) => void;

/** Clock source, abstracted so tests can drive it with a fake. */
export interface Clock {
  readonly currentTime: number;
}

export class Scheduler {
  private readonly clock: Clock;
  private readonly onStep: StepHandler;

  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextStepTime = 0;

  private bpm = 124;
  /** Tempo glide state: BPM moves linearly from `bpm` to `targetBpm`. */
  private targetBpm = 124;
  private glideStepsRemaining = 0;

  /** Steps already scheduled, awaiting their moment in the render loop. */
  private visualQueue: StepEvent[] = [];

  /**
   * Times of recently scheduled beats. Because tempo glides, the grid is not
   * uniform, so beat positions cannot be derived arithmetically from a single
   * origin — they have to be remembered. The lookahead window guarantees this
   * holds a beat or two in the future as well as the recent past, which is
   * exactly what on-beat detection needs.
   */
  private recentBeatTimes: number[] = [];

  constructor(clock: Clock, onStep: StepHandler) {
    this.clock = clock;
    this.onStep = onStep;
  }

  get currentBpm(): number {
    return this.bpm;
  }

  get secondsPerStep(): number {
    return 60 / this.bpm / STEPS_PER_BEAT;
  }

  get secondsPerBeat(): number {
    return 60 / this.bpm;
  }

  start(startTime: number = this.clock.currentTime): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextStepTime = startTime;
    this.visualQueue = [];
    this.recentBeatTimes = [];
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.visualQueue = [];
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Glide to a new tempo over `overSteps` steps instead of jumping. A hard
   * tempo cut is one of the few things that reliably makes generative music
   * sound broken, so tier changes always ramp.
   */
  setBpm(bpm: number, overSteps = STEPS_PER_BAR * 2): void {
    if (overSteps <= 0) {
      this.bpm = bpm;
      this.targetBpm = bpm;
      this.glideStepsRemaining = 0;
      return;
    }
    this.targetBpm = bpm;
    this.glideStepsRemaining = overSteps;
  }

  /** Advance the tempo glide by one step. */
  private advanceTempo(): void {
    if (this.glideStepsRemaining <= 0) {
      this.bpm = this.targetBpm;
      return;
    }
    const delta = (this.targetBpm - this.bpm) / this.glideStepsRemaining;
    this.bpm += delta;
    this.glideStepsRemaining -= 1;
  }

  /** Schedule everything that lands inside the lookahead window. */
  private tick(): void {
    while (this.nextStepTime < this.clock.currentTime + LOOKAHEAD_S) {
      const event: StepEvent = {
        step: this.step,
        stepInBar: this.step % STEPS_PER_BAR,
        time: this.nextStepTime,
        bpm: this.bpm,
      };
      this.onStep(event);
      this.visualQueue.push(event);

      if (this.step % STEPS_PER_BEAT === 0) {
        this.recentBeatTimes.push(this.nextStepTime);
        if (this.recentBeatTimes.length > 16) this.recentBeatTimes.shift();
      }

      this.nextStepTime += this.secondsPerStep;
      this.step += 1;
      this.advanceTempo();
    }
  }

  /**
   * Pop every step whose moment has arrived. Called from the render loop; the
   * caller gets them in order and can drive visuals from them.
   */
  drainVisualQueue(now: number = this.clock.currentTime): StepEvent[] {
    if (this.visualQueue.length === 0) return [];
    let count = 0;
    while (count < this.visualQueue.length && this.visualQueue[count].time <= now) {
      count += 1;
    }
    if (count === 0) return [];
    return this.visualQueue.splice(0, count);
  }

  /**
   * The next 16th-note boundary at or after `time`. Used to quantize one-off
   * sounds (the scratchpad tick) onto the grid so they land in time rather than
   * wherever the player's hand happened to be.
   */
  nextStepBoundary(time: number): number {
    const sps = this.secondsPerStep;
    if (!this.isRunning || sps <= 0) return time;
    // nextStepTime is the next *unscheduled* step; walk back to find the grid
    // line immediately after `time`.
    let boundary = this.nextStepTime;
    while (boundary - sps >= time) boundary -= sps;
    return boundary;
  }

  /**
   * How far the given time sits from the nearest beat, in seconds. Used for the
   * on-beat answering bonus. Always non-negative; returns Infinity before the
   * transport has scheduled anything.
   */
  distanceToNearestBeat(time: number): number {
    let best = Infinity;
    for (const beat of this.recentBeatTimes) {
      const d = Math.abs(time - beat);
      if (d < best) best = d;
    }
    return best;
  }
}
