/**
 * Pure scoring math. No audio, no DOM — everything here is unit tested.
 */

export const ON_BEAT_WINDOW_S = 0.1;
export const ON_BEAT_BONUS = 1.15;

export interface ScoreInput {
  /** Difficulty band, 1..8. */
  band: number;
  /** Seconds taken to answer. */
  elapsed: number;
  /** Par time for this band, seconds. */
  target: number;
  /** Music intensity tier, 0..5. */
  tier: number;
  /** Whether the answer landed inside the on-beat window. */
  onBeat: boolean;
}

export interface ScoreBreakdown {
  base: number;
  speedMultiplier: number;
  streakMultiplier: number;
  onBeatMultiplier: number;
  points: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Harder bands are worth more: band 1 -> 1.0, band 8 -> 2.4. */
export function bandMultiplier(band: number): number {
  const b = clamp(band, 1, 8);
  return 1 + (b - 1) * 0.2;
}

/**
 * Answering instantly is worth double; answering at exactly par is worth face
 * value; taking longer than par never drops below face value, because the
 * streak is already the real punishment for being slow.
 */
export function speedMultiplier(elapsed: number, target: number): number {
  if (target <= 0) return 1;
  return clamp(1 + (target - elapsed) / target, 1, 2);
}

export function streakMultiplier(tier: number): number {
  return 1 + 0.1 * clamp(tier, 0, 5);
}

export function scoreAnswer(input: ScoreInput): ScoreBreakdown {
  const base = 100 * bandMultiplier(input.band);
  const speed = speedMultiplier(input.elapsed, input.target);
  const streak = streakMultiplier(input.tier);
  const onBeatMultiplier = input.onBeat ? ON_BEAT_BONUS : 1;
  return {
    base,
    speedMultiplier: speed,
    streakMultiplier: streak,
    onBeatMultiplier,
    points: Math.round(base * speed * streak * onBeatMultiplier),
  };
}

/** Whether a moment counts as "in the pocket". */
export function isOnBeat(distanceToBeat: number): boolean {
  return Number.isFinite(distanceToBeat) && distanceToBeat <= ON_BEAT_WINDOW_S;
}
