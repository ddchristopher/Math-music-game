/**
 * Bootstrap and game loop.
 *
 * Responsibilities are deliberately thin here: this file wires the audio engine,
 * game state and UI together and runs the frame loop. All the interesting logic
 * lives in the modules it imports.
 */

import './style.css';

import { AudioEngine } from './audio/AudioEngine';
import { MusicDirector } from './audio/MusicDirector';
import { TIERS } from './audio/patterns';
import * as voices from './audio/voices';
import { GameState, RUN_SECONDS } from './game/GameState';
import { answerDigits } from './game/ProblemGenerator';
import { Hud } from './ui/Hud';
import { Keypad } from './ui/Keypad';
import { Results } from './ui/Results';
import { Scratchpad } from './ui/Scratchpad';
import { SettingsPanel, loadSettings, type Settings } from './ui/Settings';
import { Visualizer, hueForTier } from './ui/Visualizer';

const app = document.getElementById('app') as HTMLElement;
const startScreen = byId('start-screen');
const playScreen = byId('play-screen');
const resultsScreen = byId('results-screen');
const settingsScreenEl = byId('settings-panel');
const visualizerCanvas = byId('visualizer') as HTMLCanvasElement;
const scratchpadCanvas = byId('scratchpad') as HTMLCanvasElement;

let settings: Settings = loadSettings();

const state = new GameState();
const hud = new Hud(app);
const results = new Results(resultsScreen);
const visualizer = new Visualizer(visualizerCanvas);

/**
 * Audio is created lazily on the Start click — browsers refuse to let an
 * AudioContext make sound unless it was created or resumed inside a gesture.
 */
let engine: AudioEngine | null = null;
let music: MusicDirector | null = null;

/** Rate-limits scratchpad ticks to at most one per 16th note. */
let lastTickAt = 0;

const scratchpad = new Scratchpad(scratchpadCanvas, {
  onStrokeStart: () => {
    if (!engine || !music || settings.muted) return;
    const now = engine.ctx.currentTime;
    const stepDuration = music.transport.secondsPerStep;
    // At most one tick per 16th, so a fast scribble colours the track instead
    // of burying it.
    if (now - lastTickAt < stepDuration) return;
    lastTickAt = now;
    // Quantize onto the grid so scribbling stays in time with the beat.
    voices.rim(engine.bus, music.transport.nextStepBoundary(now), 0.45);
  },
});

const keypad = new Keypad(byId('keypad'), {
  onDigit: (digit) => {
    if (state.phase !== 'playing') return;
    state.appendDigit(digit);
    hud.setEntry(state.entry);
    if (!settings.requireEnter && state.problem) {
      // Auto-submit the moment the entry is as long as the answer: this game is
      // scored on speed, and making players press Enter taxes every answer.
      if (state.entry.length >= answerDigits(state.problem.answer)) {
        submit();
      }
    }
  },
  onBackspace: () => {
    state.backspace();
    hud.setEntry(state.entry);
  },
  onSubmit: submit,
  onClear: () => scratchpad.clear(),
});

const settingsPanel = new SettingsPanel(settingsScreenEl, settings, {
  onChange: (next) => {
    settings = next;
    engine?.setVolume(next.volume);
    engine?.setMuted(next.muted);
    document.body.classList.toggle('high-contrast', next.highContrast);
  },
});

document.body.classList.toggle('high-contrast', settings.highContrast);

// --- Wiring --------------------------------------------------------------

byId('start-button').addEventListener('click', () => void startRun());
byId('again-button').addEventListener('click', () => void startRun());
byId('open-settings').addEventListener('click', () => settingsPanel.toggle());
byId('close-settings').addEventListener('click', () => settingsPanel.close());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && state.phase !== 'playing' && settingsScreenEl.hidden) {
    event.preventDefault();
    void startRun();
  }
});

window.addEventListener('resize', resize);
resize();

async function startRun(): Promise<void> {
  if (!engine) {
    engine = new AudioEngine();
    engine.setVolume(settings.volume);
    engine.setMuted(settings.muted);
    music = new MusicDirector(engine);
    music.onTierChange = (tier, previous) => {
      visualizer.setTier(tier);
      scratchpad.setHue(hueForTier(tier));
      hud.setTierClass(tier);
      if (tier > previous) {
        visualizer.shockwave(tier);
        hud.floatMessage(TIERS[tier].label, 'good');
      }
    };
  }
  await engine.resume();

  startScreen.hidden = true;
  resultsScreen.hidden = true;
  settingsPanel.close();
  playScreen.hidden = false;
  keypad.setEnabled(true);

  resize();
  scratchpad.clear();
  hud.resetScoreDisplay();
  hud.setTierClass(0);
  visualizer.setTier(0);
  scratchpad.setHue(hueForTier(0), true);

  state.start();
  hud.setProblem(state.problem);
  hud.setEntry('');
  music!.start();
}

function submit(): void {
  if (state.phase !== 'playing' || !music || !engine) return;
  const distance = music.distanceToBeat(engine.ctx.currentTime);
  const result = state.submit(distance);
  if (!result) return;

  if (result.correct) {
    hud.flashEntry('correct');
    hud.floatPoints(result.breakdown!.points, result.onBeat);
    music.fireCorrect(result.onBeat);
    // Ink flies toward the score readout — the working turns into points.
    scratchpad.dissolve(scratchpadCanvas.clientWidth * 0.12, -40);
  } else {
    hud.flashEntry('wrong');
    hud.floatMessage(`= ${result.problem.answer}`, 'bad');
    music.fireBrake();
    scratchpad.clear();
  }

  music.requestTier(state.tier);
  state.nextProblem();
  hud.setProblem(state.problem);
  hud.setEntry('');
}

function timeOutProblem(): void {
  if (state.phase !== 'playing' || !music) return;
  const result = state.timeOut();
  if (!result) return;
  hud.flashEntry('wrong');
  hud.floatMessage(`= ${result.problem.answer}`, 'bad');
  music.fireBrake();
  scratchpad.clear();
  music.requestTier(state.tier);
  state.nextProblem();
  hud.setProblem(state.problem);
  hud.setEntry('');
}

function endRun(): void {
  state.end();
  keypad.setEnabled(false);
  music?.stop();
  hud.setProblem(null);
  hud.setEntry('');
  scratchpad.clear();
  results.show(state);
}

function resize(): void {
  visualizer.resize();
  scratchpad.resize();
}

// --- Frame loop ----------------------------------------------------------

let lastFrame = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (engine && music) {
    // Pulses are drained at audio time, so visuals land with the sound rather
    // than with when it was scheduled.
    for (const pulse of music.drainPulses(engine.ctx.currentTime)) {
      visualizer.pulse(pulse.kind, pulse.strength);
      if (pulse.kind === 'kick') scratchpad.pulse(pulse.strength * 0.8);
    }
  }

  if (state.phase === 'playing') {
    if (state.timeRemaining <= 0) {
      endRun();
    } else if (state.problemProgress >= 1) {
      timeOutProblem();
    }
  }

  visualizer.render(dt, settings.reducedMotion);
  scratchpad.render(dt, settings.reducedMotion);

  if (state.phase === 'playing') {
    hud.update(
      {
        score: state.score,
        streak: state.streak,
        musicTier: music?.currentTier ?? 0,
        timeRemaining: state.timeRemaining,
        runLength: RUN_SECONDS,
        problemProgress: state.problemProgress,
      },
      dt,
    );
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
