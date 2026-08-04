/**
 * Problem generation with adaptive difficulty.
 *
 * The adaptive band is what keeps players in flow: too easy and the music never
 * escalates meaningfully, too hard and the streak never survives long enough to
 * hear tier 4. The band tracks a rolling window of recent performance rather
 * than raw streak, so a single unlucky miss does not undo the ramp.
 */

export type Operation = '+' | '-' | '×' | '÷';

export interface Problem {
  a: number;
  b: number;
  op: Operation;
  answer: number;
  band: number;
  /** Par time in seconds — what the speed bonus is measured against. */
  target: number;
  /** Hard limit before the problem counts as a miss. */
  timeout: number;
}

export const MIN_BAND = 1;
export const MAX_BAND = 8;

/** Operand ranges per band, per operation. */
interface BandSpec {
  add: [number, number];
  sub: [number, number];
  /**
   * Multiplication: [table max, multiplier max]. Both sides start at 2, so a
   * band's multiplication space is (max-1) x (max-1) problems — keep the table
   * max above 4 or the space gets smaller than the anti-repeat history and
   * every problem starts looking the same.
   */
  mul: [number, number];
  target: number;
}

const BANDS: Record<number, BandSpec> = {
  1: { add: [1, 9], sub: [1, 9], mul: [5, 5], target: 3.4 },
  2: { add: [2, 20], sub: [2, 20], mul: [6, 8], target: 3.4 },
  3: { add: [5, 40], sub: [5, 40], mul: [9, 9], target: 3.6 },
  4: { add: [10, 75], sub: [10, 75], mul: [9, 12], target: 3.8 },
  5: { add: [15, 99], sub: [15, 99], mul: [12, 12], target: 4.0 },
  6: { add: [25, 150], sub: [25, 150], mul: [12, 15], target: 4.2 },
  7: { add: [40, 250], sub: [40, 250], mul: [15, 19], target: 4.6 },
  8: { add: [60, 400], sub: [60, 400], mul: [19, 25], target: 5.0 },
};

const HISTORY_SIZE = 12;
const WINDOW_SIZE = 5;

/**
 * Roughly how many distinct problems a band/operation can produce. The
 * anti-repeat history is clamped to half of this: holding 12 problems in
 * history when only 16 exist would leave the generator rejecting nearly
 * everything it draws, which reads to the player as a stall.
 */
function problemSpace(op: Operation, spec: BandSpec): number {
  switch (op) {
    case '+': {
      const n = spec.add[1] - spec.add[0] + 1;
      return n * n;
    }
    case '-': {
      const n = spec.sub[1] - spec.sub[0] + 1;
      return (n * (n + 1)) / 2;
    }
    case '×':
    case '÷':
      return Math.max(1, spec.mul[0] - 1) * Math.max(1, spec.mul[1] - 1);
  }
}

interface Attempt {
  correct: boolean;
  elapsed: number;
  target: number;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export class ProblemGenerator {
  private band = MIN_BAND;
  private readonly recent: string[] = [];
  private readonly window: Attempt[] = [];
  private readonly enabledOps: Operation[];

  constructor(operations: Operation[] = ['+', '-', '×', '÷']) {
    this.enabledOps = operations.length > 0 ? operations : ['+'];
  }

  get currentBand(): number {
    return this.band;
  }

  next(): Problem {
    // Bounded retry: the history is already sized to leave room, so this
    // almost always succeeds on the first try. The fallback exists so a
    // pathologically narrow band can never spin the loop forever.
    for (let attempt = 0; attempt < 40; attempt++) {
      const problem = this.generate();
      const key = `${problem.a}${problem.op}${problem.b}`;
      if (!this.recent.includes(key)) {
        this.remember(problem, key);
        return problem;
      }
    }
    const fallback = this.generate();
    this.remember(fallback, `${fallback.a}${fallback.op}${fallback.b}`);
    return fallback;
  }

  private remember(problem: Problem, key: string): void {
    this.recent.push(key);
    const limit = this.historyLimit(problem.op);
    while (this.recent.length > limit) this.recent.shift();
  }

  /** History depth, capped so it can never exceed half the problem space. */
  private historyLimit(op: Operation): number {
    const space = problemSpace(op, BANDS[this.band]);
    return Math.max(2, Math.min(HISTORY_SIZE, Math.floor(space / 2)));
  }

  private generate(): Problem {
    const op = this.enabledOps[randInt(0, this.enabledOps.length - 1)];
    const spec = BANDS[this.band];
    let a: number;
    let b: number;
    let answer: number;

    switch (op) {
      case '+': {
        a = randInt(spec.add[0], spec.add[1]);
        b = randInt(spec.add[0], spec.add[1]);
        answer = a + b;
        break;
      }
      case '-': {
        // Order the operands so the result is never negative — v1 has no way to
        // type a minus sign.
        const x = randInt(spec.sub[0], spec.sub[1]);
        const y = randInt(spec.sub[0], spec.sub[1]);
        a = Math.max(x, y);
        b = Math.min(x, y);
        answer = a - b;
        break;
      }
      case '×': {
        a = randInt(2, spec.mul[0]);
        b = randInt(2, spec.mul[1]);
        answer = a * b;
        break;
      }
      case '÷': {
        // Built as the inverse of a multiplication, so division is always exact.
        const divisor = randInt(2, spec.mul[0]);
        const quotient = randInt(2, spec.mul[1]);
        a = divisor * quotient;
        b = divisor;
        answer = quotient;
        break;
      }
    }

    // Trivial forms are noise above the first band.
    if (this.band > MIN_BAND && (a === 1 || b === 1 || a === 0 || b === 0)) {
      return this.generate();
    }

    const target = spec.target;
    return { a, b, op, answer, band: this.band, target, timeout: target * 2.6 };
  }

  /** Feed back an attempt so difficulty can adapt. */
  record(correct: boolean, elapsed: number, target: number): void {
    this.window.push({ correct, elapsed, target });
    if (this.window.length > WINDOW_SIZE) this.window.shift();
    if (this.window.length < WINDOW_SIZE) return;

    const wrong = this.window.filter((a) => !a.correct).length;
    const times = this.window.filter((a) => a.correct).map((a) => a.elapsed);
    const medianTime = median(times);
    const par = this.window[0].target;

    if (wrong >= 2 && this.band > MIN_BAND) {
      this.band -= 1;
      this.window.length = 0;
    } else if (wrong <= 1 && medianTime < par * 0.8 && this.band < MAX_BAND) {
      this.band += 1;
      this.window.length = 0;
    }
  }

  reset(): void {
    this.band = MIN_BAND;
    this.recent.length = 0;
    this.window.length = 0;
  }
}

/** Number of digits in an answer — drives auto-submit. */
export function answerDigits(answer: number): number {
  return String(Math.abs(answer)).length;
}
