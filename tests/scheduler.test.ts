import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STEPS_PER_BAR, Scheduler, type StepEvent } from '../src/audio/Scheduler';

/** Stand-in for AudioContext: a clock we advance by hand. */
class FakeClock {
  currentTime = 0;
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

describe('Scheduler', () => {
  let clock: FakeClock;
  let events: StepEvent[];
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = new FakeClock();
    events = [];
    scheduler = new Scheduler(clock, (e) => events.push(e));
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  /** Run the scheduler's interval N times, advancing the audio clock in step. */
  function run(ticks: number, secondsPerTick = 0.025): void {
    for (let i = 0; i < ticks; i++) {
      clock.advance(secondsPerTick);
      vi.advanceTimersByTime(secondsPerTick * 1000);
    }
  }

  it('schedules steps at exact, evenly spaced times at a fixed tempo', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(40);

    expect(events.length).toBeGreaterThan(4);
    // 120 BPM -> 0.5s per beat -> 0.125s per 16th.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time - events[i - 1].time).toBeCloseTo(0.125, 6);
    }
  });

  it('numbers steps consecutively and wraps stepInBar every 16', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(80);

    expect(events.length).toBeGreaterThan(STEPS_PER_BAR);
    events.forEach((event, index) => {
      expect(event.step).toBe(index);
      expect(event.stepInBar).toBe(index % STEPS_PER_BAR);
    });
  });

  it('never schedules further ahead than the lookahead window', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(40);

    for (const event of events) {
      // Every event was scheduled within the lookahead of the clock at the time.
      expect(event.time).toBeLessThanOrEqual(clock.currentTime + 0.13);
    }
  });

  it('glides tempo across a change rather than jumping', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(20);
    const before = scheduler.currentBpm;
    expect(before).toBeCloseTo(120, 6);

    scheduler.setBpm(140, STEPS_PER_BAR);
    run(10);
    const mid = scheduler.currentBpm;
    // Partway through the glide: past 120, not yet 140.
    expect(mid).toBeGreaterThan(120);
    expect(mid).toBeLessThan(140);

    run(200);
    expect(scheduler.currentBpm).toBeCloseTo(140, 4);
  });

  it('shortens step spacing as the tempo rises', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(20);
    scheduler.setBpm(160, STEPS_PER_BAR);
    run(300);

    const gaps = events.slice(1).map((e, i) => e.time - events[i].time);
    const first = gaps[0];
    const last = gaps[gaps.length - 1];
    expect(first).toBeCloseTo(0.125, 4);
    // 160 BPM -> 0.09375s per 16th.
    expect(last).toBeCloseTo(0.09375, 4);
    expect(last).toBeLessThan(first);
  });

  it('releases visual events only once their moment has arrived', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(4);

    // Scheduled ahead of the clock, so nothing is due yet at time 0.
    expect(scheduler.drainVisualQueue(-0.001)).toHaveLength(0);

    const due = scheduler.drainVisualQueue(clock.currentTime);
    expect(due.length).toBeGreaterThan(0);
    for (const event of due) {
      expect(event.time).toBeLessThanOrEqual(clock.currentTime);
    }
    // Draining is destructive — the same events are not handed out twice.
    expect(scheduler.drainVisualQueue(clock.currentTime)).toHaveLength(0);
  });

  it('measures distance to the nearest beat', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(40);

    // Beats land every 0.5s from 0 at 120 BPM.
    expect(scheduler.distanceToNearestBeat(0.5)).toBeCloseTo(0, 6);
    expect(scheduler.distanceToNearestBeat(0.55)).toBeCloseTo(0.05, 6);
    expect(scheduler.distanceToNearestBeat(0.45)).toBeCloseTo(0.05, 6);
    // Exactly between two beats.
    expect(scheduler.distanceToNearestBeat(0.75)).toBeCloseTo(0.25, 6);
  });

  it('reports an infinite beat distance before the transport starts', () => {
    expect(scheduler.distanceToNearestBeat(1)).toBe(Infinity);
  });

  it('quantizes a moment forward onto the 16th-note grid', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(40);

    const boundary = scheduler.nextStepBoundary(0.3);
    expect(boundary).toBeCloseTo(0.375, 6);
    expect(boundary).toBeGreaterThanOrEqual(0.3);

    // A moment already on the grid stays put.
    expect(scheduler.nextStepBoundary(0.25)).toBeCloseTo(0.25, 6);
  });

  it('stops cleanly and schedules nothing further', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(20);
    const count = events.length;
    expect(scheduler.isRunning).toBe(true);

    scheduler.stop();
    run(40);

    expect(scheduler.isRunning).toBe(false);
    expect(events.length).toBe(count);
    expect(scheduler.drainVisualQueue(clock.currentTime)).toHaveLength(0);
  });

  it('restarts from step 0 on a fresh start', () => {
    scheduler.setBpm(120, 0);
    scheduler.start(0);
    run(20);
    scheduler.stop();

    events = [];
    scheduler.start(clock.currentTime);
    run(10);

    expect(events[0].step).toBe(0);
  });
});
