# PULSE

A mental arithmetic game where your streak builds the music.

You start with a bare kick and a sub. Every few correct answers in a row adds
another layer — a rolling 16th bassline, claps, open hats, an acid line whose
filter opens as you climb — and the tempo creeps from 124 to 140 BPM. Miss one
and it brakes, hard, dropping two layers. The track is a readout of how well
you're doing.

## Playing

- **Answer fast.** Speed multiplies your score up to 2×. Answering at par is
  worth face value; being slow never scores below that, because losing the
  streak is already the real penalty.
- **Land on the beat.** Answers within ±100ms of a beat take a 1.15× bonus.
  Ignorable if you just want to do arithmetic; satisfying if you don't.
- **Use the scratchpad.** Draw anywhere on the play area with mouse, finger or
  stylus. The ink glows on the beat, fades on its own, and each stroke fires a
  percussive tick quantized to the grid.
- Type digits to answer — it submits as soon as your entry is as long as the
  answer. Enter-to-submit is available in settings. There's an on-screen keypad
  for touch.

Runs are 90 seconds, extended half a second per correct answer, capped at 120.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

## Tests

```bash
npm test         # unit: scoring, problem generation, scheduler timing
npm run test:e2e # browser: game loop, input paths, and audio synthesis
```

The e2e suite needs a Chromium. If your environment ships one at a
non-standard path, point at it:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

The audio tests are worth a note: they render each synth voice through an
`OfflineAudioContext` and assert on the samples — that the voice produces
energy, that percussion decays, that opening a filter actually passes more
signal, and that a full top-tier bar doesn't clip the master bus. "It didn't
throw" proves nothing about a Web Audio graph; a mis-wired node fails silently.

## How it works

The music is **synthesized, not sampled** — there are no audio assets. Techno
decomposes cleanly into things you can build from oscillators and filtered
noise, and doing it this way means layers are phase-locked by construction, the
tempo can glide continuously, and the track responds to game events instantly.

```
src/
  audio/
    Scheduler.ts       lookahead step scheduler — the timing backbone
    voices.ts          kick, sub, bass, hats, clap, ride, acid, stab, riser, brake
    patterns.ts        scale, 16-step patterns, the six-tier ladder
    AudioEngine.ts     master chain: sidechain -> soft clip -> compressor
    MusicDirector.ts   game state -> music, with bar-quantized tier changes
  game/
    ProblemGenerator.ts  operations, adaptive difficulty bands
    scoring.ts           pure scoring math
    GameState.ts         run lifecycle
  ui/
    Scratchpad.ts  Visualizer.ts  Hud.ts  Keypad.ts  Results.ts  Settings.ts
```

Three decisions carry most of the feel:

**Audio is scheduled ahead, never from the render loop.** A coarse 25ms timer
looks 120ms into the future and schedules each 16th note at an exact
`AudioContext` time. Scheduling from `requestAnimationFrame` would put frame
jitter directly into the groove.

**Tier changes commit on the bar line.** A layer that appears mid-bar reads as
a glitch; the same layer entering on the downbeat reads as a drop. Tempo glides
over two bars rather than jumping. The HUD's tier label waits for the music, so
the name of the new tier lands with the layer instead of a beat ahead of it.

**Difficulty adapts to a rolling window**, not to the raw streak — band up on
4-of-5 correct under par, band down on two misses. One unlucky miss shouldn't
undo the ramp, or nobody ever hears the top tier.

## Not in this version

Progression meta and unlocks, multiple run lengths, online leaderboards,
negative results and remainders, the abacus scratchpad variant.
