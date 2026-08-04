import { describe, expect, it } from 'vitest';
import {
  MAX_BAND,
  MIN_BAND,
  ProblemGenerator,
  answerDigits,
  type Operation,
} from '../src/game/ProblemGenerator';

/** Applies each op's own definition of correctness to a generated problem. */
function evaluate(a: number, op: Operation, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return a / b;
  }
}

describe('ProblemGenerator', () => {
  it('always produces problems whose stated answer is arithmetically right', () => {
    const gen = new ProblemGenerator();
    for (let i = 0; i < 2000; i++) {
      const p = gen.next();
      expect(evaluate(p.a, p.op, p.b)).toBe(p.answer);
    }
  });

  it('never produces a negative subtraction result', () => {
    const gen = new ProblemGenerator(['-']);
    for (let i = 0; i < 500; i++) {
      const p = gen.next();
      expect(p.answer).toBeGreaterThanOrEqual(0);
    }
  });

  it('only produces exact division', () => {
    const gen = new ProblemGenerator(['÷']);
    for (let i = 0; i < 500; i++) {
      const p = gen.next();
      expect(p.a % p.b).toBe(0);
      expect(Number.isInteger(p.answer)).toBe(true);
    }
  });

  it('suppresses trivial operands above band 1', () => {
    const gen = new ProblemGenerator();
    // Climb out of band 1 first.
    while (gen.currentBand === MIN_BAND) {
      gen.next();
      gen.record(true, 0.5, 4);
    }
    for (let i = 0; i < 500; i++) {
      const p = gen.next();
      expect(p.a).not.toBe(0);
      expect(p.b).not.toBe(0);
      expect(p.a).not.toBe(1);
      expect(p.b).not.toBe(1);
    }
  });

  it('does not repeat a problem within the recent-history window', () => {
    const gen = new ProblemGenerator();
    const seen: string[] = [];
    for (let i = 0; i < 500; i++) {
      const p = gen.next();
      const key = `${p.a}${p.op}${p.b}`;
      // History is clamped to half the problem space, which bottoms out at 8
      // for the narrowest band; 7 is the guarantee that holds everywhere.
      expect(seen.slice(-7)).not.toContain(key);
      seen.push(key);
    }
  });

  it('keeps its no-repeat guarantee in the narrowest problem space', () => {
    // Band 1 multiplication is only 4x4 = 16 problems. The history has to
    // shrink to match, or the generator would reject nearly every draw.
    const gen = new ProblemGenerator(['×']);
    const seen: string[] = [];
    for (let i = 0; i < 300; i++) {
      const p = gen.next();
      const key = `${p.a}${p.op}${p.b}`;
      expect(seen.slice(-7)).not.toContain(key);
      seen.push(key);
    }
    // ...and it still reaches the whole space rather than cycling a few.
    expect(new Set(seen).size).toBeGreaterThanOrEqual(12);
  });

  it('climbs bands on fast, accurate play', () => {
    const gen = new ProblemGenerator();
    const startBand = gen.currentBand;
    for (let i = 0; i < 30; i++) {
      const p = gen.next();
      gen.record(true, p.target * 0.4, p.target);
    }
    expect(gen.currentBand).toBeGreaterThan(startBand);
  });

  it('drops bands on repeated misses', () => {
    const gen = new ProblemGenerator();
    for (let i = 0; i < 30; i++) {
      const p = gen.next();
      gen.record(true, p.target * 0.4, p.target);
    }
    const peak = gen.currentBand;
    expect(peak).toBeGreaterThan(MIN_BAND);

    for (let i = 0; i < 20; i++) {
      const p = gen.next();
      gen.record(false, p.timeout, p.target);
    }
    expect(gen.currentBand).toBeLessThan(peak);
  });

  it('never leaves the band range', () => {
    const gen = new ProblemGenerator();
    for (let i = 0; i < 400; i++) {
      const p = gen.next();
      gen.record(true, 0.1, p.target);
      expect(gen.currentBand).toBeGreaterThanOrEqual(MIN_BAND);
      expect(gen.currentBand).toBeLessThanOrEqual(MAX_BAND);
    }
    for (let i = 0; i < 400; i++) {
      const p = gen.next();
      gen.record(false, 99, p.target);
      expect(gen.currentBand).toBeGreaterThanOrEqual(MIN_BAND);
      expect(gen.currentBand).toBeLessThanOrEqual(MAX_BAND);
    }
  });

  it('honours a restricted operation set', () => {
    const gen = new ProblemGenerator(['+']);
    for (let i = 0; i < 100; i++) {
      expect(gen.next().op).toBe('+');
    }
  });

  it('resets back to band 1', () => {
    const gen = new ProblemGenerator();
    for (let i = 0; i < 30; i++) {
      const p = gen.next();
      gen.record(true, p.target * 0.3, p.target);
    }
    gen.reset();
    expect(gen.currentBand).toBe(MIN_BAND);
  });

  it('gives every problem a timeout longer than its par time', () => {
    const gen = new ProblemGenerator();
    for (let i = 0; i < 200; i++) {
      const p = gen.next();
      expect(p.timeout).toBeGreaterThan(p.target);
    }
  });
});

describe('answerDigits', () => {
  it('counts digits, which is what drives auto-submit', () => {
    expect(answerDigits(7)).toBe(1);
    expect(answerDigits(42)).toBe(2);
    expect(answerDigits(100)).toBe(3);
    expect(answerDigits(0)).toBe(1);
  });
});
