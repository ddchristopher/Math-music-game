/**
 * HUD: problem, entry, score, streak meter, run clock.
 *
 * Plain DOM rather than canvas — text layout, font scaling and screen-reader
 * output all come free, and none of it needs to run at 60fps.
 */

import { TIERS, tierForStreak } from '../audio/patterns';
import type { Problem } from '../game/ProblemGenerator';

export class Hud {
  private readonly problemEl: HTMLElement;
  private readonly entryEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly streakEl: HTMLElement;
  private readonly tierLabelEl: HTMLElement;
  private readonly tierFillEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly timeFillEl: HTMLElement;
  private readonly floatLayer: HTMLElement;
  private readonly problemTimerEl: HTMLElement;

  /** Score is eased toward its true value so it counts up rather than jumps. */
  private displayedScore = 0;

  constructor(root: HTMLElement) {
    this.problemEl = must(root, '#problem');
    this.entryEl = must(root, '#entry');
    this.scoreEl = must(root, '#score');
    this.streakEl = must(root, '#streak');
    this.tierLabelEl = must(root, '#tier-label');
    this.tierFillEl = must(root, '#tier-fill');
    this.timeEl = must(root, '#time');
    this.timeFillEl = must(root, '#time-fill');
    this.floatLayer = must(root, '#floaters');
    this.problemTimerEl = must(root, '#problem-timer');
  }

  setProblem(problem: Problem | null): void {
    if (!problem) {
      this.problemEl.textContent = '';
      return;
    }
    this.problemEl.textContent = `${problem.a} ${problem.op} ${problem.b}`;
    this.problemEl.setAttribute(
      'aria-label',
      `${problem.a} ${opName(problem.op)} ${problem.b}`,
    );
  }

  setEntry(entry: string): void {
    this.entryEl.textContent = entry || ' ';
    this.entryEl.classList.toggle('is-empty', entry.length === 0);
  }

  /** Flash the entry field — red for wrong, green for right. */
  flashEntry(kind: 'correct' | 'wrong'): void {
    this.entryEl.classList.remove('flash-correct', 'flash-wrong');
    // Force reflow so the animation restarts on consecutive answers.
    void this.entryEl.offsetWidth;
    this.entryEl.classList.add(kind === 'correct' ? 'flash-correct' : 'flash-wrong');
  }

  update(state: {
    score: number;
    streak: number;
    /**
     * The tier the *music* is actually playing. Layers commit on the bar line,
     * so this lags the streak by up to a bar — and the label has to lag with
     * it. Announcing OVERDRIVE a beat before the drop lands reads as a bug.
     */
    musicTier: number;
    timeRemaining: number;
    runLength: number;
    problemProgress: number;
  }, dt: number): void {
    this.displayedScore += (state.score - this.displayedScore) * Math.min(1, dt * 9);
    if (Math.abs(state.score - this.displayedScore) < 1) this.displayedScore = state.score;
    this.scoreEl.textContent = String(Math.round(this.displayedScore));

    this.streakEl.textContent = String(state.streak);
    this.tierLabelEl.textContent = TIERS[state.musicTier].label;

    // The meter, unlike the label, tracks the live streak — it is showing
    // progress toward the next layer, so it should move on every answer.
    const liveTier = tierForStreak(state.streak);
    const current = TIERS[liveTier].streak;
    const next = liveTier < TIERS.length - 1 ? TIERS[liveTier + 1].streak : current + 1;
    const progress =
      liveTier >= TIERS.length - 1
        ? 1
        : Math.min(1, (state.streak - current) / Math.max(1, next - current));
    this.tierFillEl.style.transform = `scaleX(${progress})`;

    this.timeEl.textContent = state.timeRemaining.toFixed(1);
    this.timeFillEl.style.transform = `scaleX(${Math.min(
      1,
      state.timeRemaining / state.runLength,
    )})`;

    this.problemTimerEl.style.transform = `scaleX(${1 - state.problemProgress})`;
    this.problemTimerEl.classList.toggle('is-urgent', state.problemProgress > 0.7);
  }

  setTierClass(tier: number): void {
    this.tierLabelEl.dataset.tier = String(tier);
  }

  /** Points popup that drifts up from the entry field. */
  floatPoints(points: number, onBeat: boolean): void {
    const el = document.createElement('div');
    el.className = 'floater' + (onBeat ? ' floater--onbeat' : '');
    el.textContent = onBeat ? `+${points} ON BEAT` : `+${points}`;
    this.floatLayer.appendChild(el);
    // Self-cleaning: remove once the CSS animation is done.
    el.addEventListener('animationend', () => el.remove());
  }

  floatMessage(text: string, kind: 'good' | 'bad'): void {
    const el = document.createElement('div');
    el.className = `floater floater--${kind}`;
    el.textContent = text;
    this.floatLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  resetScoreDisplay(): void {
    this.displayedScore = 0;
    this.scoreEl.textContent = '0';
  }
}

function must(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

function opName(op: string): string {
  switch (op) {
    case '+':
      return 'plus';
    case '-':
      return 'minus';
    case '×':
      return 'times';
    case '÷':
      return 'divided by';
    default:
      return op;
  }
}
