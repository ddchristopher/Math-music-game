/**
 * End-of-run summary and personal best persistence.
 */

import { TIERS } from '../audio/patterns';
import type { GameState } from '../game/GameState';
import type { Operation } from '../game/ProblemGenerator';

const BEST_KEY = 'mmg.best.v1';

export interface BestScore {
  score: number;
  streak: number;
  tier: number;
  at: number;
}

export function loadBest(): BestScore | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BestScore;
    if (typeof parsed?.score !== 'number') return null;
    return parsed;
  } catch {
    // Private browsing, disabled storage, corrupted value — none of these are
    // worth interrupting a run over.
    return null;
  }
}

export function saveBest(best: BestScore): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* not fatal */
  }
}

export class Results {
  private readonly root: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly newBestEl: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.scoreEl = required(root, '#result-score');
    this.bestEl = required(root, '#result-best');
    this.statsEl = required(root, '#result-stats');
    this.newBestEl = required(root, '#result-new-best');
  }

  show(state: GameState): void {
    const previous = loadBest();
    const isNewBest = !previous || state.score > previous.score;

    if (isNewBest) {
      saveBest({
        score: state.score,
        streak: state.bestStreak,
        tier: state.peakTier,
        at: Date.now(),
      });
    }

    this.scoreEl.textContent = String(state.score);
    this.bestEl.textContent = String(
      isNewBest ? state.score : previous ? previous.score : state.score,
    );
    this.newBestEl.hidden = !isNewBest;

    this.statsEl.innerHTML = '';
    this.addStat('Best streak', String(state.bestStreak));
    this.addStat('Peak intensity', TIERS[state.peakTier].label);
    this.addStat('Accuracy', `${Math.round(state.accuracy * 100)}%`);
    this.addStat('Correct', `${state.correctCount} / ${state.attemptCount}`);

    for (const [op, stat] of state.stats) {
      if (stat.attempts === 0) continue;
      const avg = stat.correct > 0 ? stat.totalTime / stat.correct : 0;
      this.addStat(
        `${opLabel(op)}`,
        `${stat.correct}/${stat.attempts}${avg > 0 ? ` · ${avg.toFixed(1)}s` : ''}`,
      );
    }

    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private addStat(label: string, value: string): void {
    const row = document.createElement('div');
    row.className = 'stat';
    const l = document.createElement('span');
    l.className = 'stat__label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'stat__value';
    v.textContent = value;
    row.append(l, v);
    this.statsEl.appendChild(row);
  }
}

function required(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

function opLabel(op: Operation): string {
  switch (op) {
    case '+':
      return 'Addition';
    case '-':
      return 'Subtraction';
    case '×':
      return 'Multiplication';
    case '÷':
      return 'Division';
  }
}
