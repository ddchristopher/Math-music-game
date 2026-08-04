/**
 * Run lifecycle and scoring state. Knows nothing about rendering; the UI reads
 * from it and the music director is driven from its tier.
 */

import { ProblemGenerator, type Operation, type Problem } from './ProblemGenerator';
import { isOnBeat, scoreAnswer, type ScoreBreakdown } from './scoring';
import { NUM_TIERS, TIERS, tierForStreak } from '../audio/patterns';

export const RUN_SECONDS = 90;
export const MAX_RUN_SECONDS = 120;
export const TIME_BONUS_PER_CORRECT = 0.5;
/** A miss costs two tiers — harsh enough to matter, shallow enough to recover. */
export const TIER_DROP_ON_MISS = 2;

export type Phase = 'idle' | 'playing' | 'over';

export interface AnswerResult {
  correct: boolean;
  problem: Problem;
  elapsed: number;
  onBeat: boolean;
  breakdown: ScoreBreakdown | null;
  tier: number;
  tierChanged: boolean;
}

export interface OperationStat {
  attempts: number;
  correct: number;
  totalTime: number;
}

export class GameState {
  readonly generator: ProblemGenerator;

  phase: Phase = 'idle';
  score = 0;
  streak = 0;
  bestStreak = 0;
  peakTier = 0;
  correctCount = 0;
  attemptCount = 0;

  problem: Problem | null = null;
  entry = '';

  /** Wall-clock (performance.now) references, in ms. */
  private problemStartedAt = 0;
  private runEndsAt = 0;

  readonly stats = new Map<Operation, OperationStat>();

  constructor(operations?: Operation[]) {
    this.generator = new ProblemGenerator(operations);
  }

  get tier(): number {
    return Math.min(NUM_TIERS - 1, tierForStreak(this.streak));
  }

  get timeRemaining(): number {
    if (this.phase !== 'playing') return 0;
    return Math.max(0, (this.runEndsAt - performance.now()) / 1000);
  }

  /** 0..1 progress through the current problem's timeout. */
  get problemProgress(): number {
    if (!this.problem || this.phase !== 'playing') return 0;
    const elapsed = (performance.now() - this.problemStartedAt) / 1000;
    return Math.min(1, elapsed / this.problem.timeout);
  }

  get elapsedOnProblem(): number {
    return (performance.now() - this.problemStartedAt) / 1000;
  }

  start(): void {
    this.phase = 'playing';
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.peakTier = 0;
    this.correctCount = 0;
    this.attemptCount = 0;
    this.entry = '';
    this.stats.clear();
    this.generator.reset();
    this.runEndsAt = performance.now() + RUN_SECONDS * 1000;
    this.nextProblem();
  }

  end(): void {
    this.phase = 'over';
    this.problem = null;
    this.entry = '';
  }

  nextProblem(): void {
    this.problem = this.generator.next();
    this.entry = '';
    this.problemStartedAt = performance.now();
  }

  appendDigit(digit: string): void {
    if (this.phase !== 'playing') return;
    if (this.entry.length >= 6) return;
    this.entry += digit;
  }

  backspace(): void {
    this.entry = this.entry.slice(0, -1);
  }

  /**
   * Grade the current entry. `beatDistance` is seconds from the nearest beat,
   * already latency-compensated by the caller.
   */
  submit(beatDistance: number): AnswerResult | null {
    if (this.phase !== 'playing' || !this.problem || this.entry.length === 0) return null;
    const value = Number(this.entry);
    return this.resolve(value === this.problem.answer, beatDistance);
  }

  /** The problem's timeout expired. Counts as a miss. */
  timeOut(): AnswerResult | null {
    if (this.phase !== 'playing' || !this.problem) return null;
    return this.resolve(false, Infinity);
  }

  private resolve(correct: boolean, beatDistance: number): AnswerResult {
    const problem = this.problem!;
    const elapsed = this.elapsedOnProblem;
    const tierBefore = this.tier;
    const onBeat = correct && isOnBeat(beatDistance);

    this.attemptCount += 1;
    this.recordStat(problem.op, correct, elapsed);
    this.generator.record(correct, elapsed, problem.target);

    let breakdown: ScoreBreakdown | null = null;

    if (correct) {
      this.correctCount += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      breakdown = scoreAnswer({
        band: problem.band,
        elapsed,
        target: problem.target,
        tier: tierBefore,
        onBeat,
      });
      this.score += breakdown.points;
      this.runEndsAt = Math.min(
        this.runEndsAt + TIME_BONUS_PER_CORRECT * 1000,
        performance.now() + MAX_RUN_SECONDS * 1000,
      );
    } else {
      this.streak = streakForTier(Math.max(0, tierBefore - TIER_DROP_ON_MISS));
    }

    const tierAfter = this.tier;
    this.peakTier = Math.max(this.peakTier, tierAfter);

    return {
      correct,
      problem,
      elapsed,
      onBeat,
      breakdown,
      tier: tierAfter,
      tierChanged: tierAfter !== tierBefore,
    };
  }

  private recordStat(op: Operation, correct: boolean, elapsed: number): void {
    const stat = this.stats.get(op) ?? { attempts: 0, correct: 0, totalTime: 0 };
    stat.attempts += 1;
    if (correct) {
      stat.correct += 1;
      stat.totalTime += elapsed;
    }
    this.stats.set(op, stat);
  }

  get accuracy(): number {
    return this.attemptCount === 0 ? 0 : this.correctCount / this.attemptCount;
  }
}

/** Lowest streak that still sits in the given tier. */
export function streakForTier(tier: number): number {
  return TIERS[Math.max(0, Math.min(NUM_TIERS - 1, tier))].streak;
}
