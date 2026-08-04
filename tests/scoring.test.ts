import { describe, expect, it } from 'vitest';
import {
  ON_BEAT_BONUS,
  bandMultiplier,
  isOnBeat,
  scoreAnswer,
  speedMultiplier,
  streakMultiplier,
} from '../src/game/scoring';

describe('bandMultiplier', () => {
  it('scales from 1.0 at band 1 to 2.4 at band 8', () => {
    expect(bandMultiplier(1)).toBeCloseTo(1);
    expect(bandMultiplier(8)).toBeCloseTo(2.4);
  });

  it('clamps out-of-range bands', () => {
    expect(bandMultiplier(0)).toBeCloseTo(1);
    expect(bandMultiplier(99)).toBeCloseTo(2.4);
  });
});

describe('speedMultiplier', () => {
  it('caps at 2x for an instant answer', () => {
    expect(speedMultiplier(0, 4)).toBe(2);
    expect(speedMultiplier(-1, 4)).toBe(2);
  });

  it('is 1x at exactly par', () => {
    expect(speedMultiplier(4, 4)).toBe(1);
  });

  it('never drops below 1x, however slow', () => {
    expect(speedMultiplier(60, 4)).toBe(1);
  });

  it('interpolates between par and instant', () => {
    expect(speedMultiplier(2, 4)).toBeCloseTo(1.5);
  });

  it('survives a zero target without dividing by zero', () => {
    expect(speedMultiplier(1, 0)).toBe(1);
  });
});

describe('streakMultiplier', () => {
  it('runs 1.0 at tier 0 to 1.5 at tier 5', () => {
    expect(streakMultiplier(0)).toBeCloseTo(1);
    expect(streakMultiplier(5)).toBeCloseTo(1.5);
  });

  it('clamps above the top tier', () => {
    expect(streakMultiplier(50)).toBeCloseTo(1.5);
  });
});

describe('isOnBeat', () => {
  it('accepts distances inside the window', () => {
    expect(isOnBeat(0)).toBe(true);
    expect(isOnBeat(0.09)).toBe(true);
  });

  it('rejects distances outside it', () => {
    expect(isOnBeat(0.2)).toBe(false);
  });

  it('rejects Infinity, which means no beat grid exists yet', () => {
    expect(isOnBeat(Infinity)).toBe(false);
  });
});

describe('scoreAnswer', () => {
  it('multiplies base, speed, streak and on-beat together', () => {
    const result = scoreAnswer({ band: 1, elapsed: 4, target: 4, tier: 0, onBeat: false });
    expect(result.points).toBe(100);
  });

  it('applies the on-beat bonus exactly once', () => {
    const plain = scoreAnswer({ band: 3, elapsed: 2, target: 4, tier: 2, onBeat: false });
    const bonus = scoreAnswer({ band: 3, elapsed: 2, target: 4, tier: 2, onBeat: true });
    expect(bonus.points).toBe(Math.round(plain.points * ON_BEAT_BONUS));
  });

  it('reaches its maximum with a top band, instant answer and top tier', () => {
    const result = scoreAnswer({ band: 8, elapsed: 0, target: 4, tier: 5, onBeat: true });
    // 100 * 2.4 * 2 * 1.5 * 1.15
    expect(result.points).toBe(828);
  });

  it('reports the component multipliers it used', () => {
    const result = scoreAnswer({ band: 5, elapsed: 1, target: 4, tier: 3, onBeat: true });
    expect(result.base).toBeCloseTo(180);
    expect(result.speedMultiplier).toBeCloseTo(1.75);
    expect(result.streakMultiplier).toBeCloseTo(1.3);
    expect(result.onBeatMultiplier).toBeCloseTo(1.15);
  });
});
