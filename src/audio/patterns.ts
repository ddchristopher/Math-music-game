/**
 * Musical material: the scale, and what each intensity tier plays.
 *
 * Everything is written as 16-step bars. A tier's definition is *additive* —
 * tier N plays its own layers plus every layer below it — which is what makes
 * the streak escalation feel like one track thickening rather than six
 * different tracks.
 */

export const NUM_TIERS = 6;

/** A minor, the natural home of acid techno. */
const ROOT = 55; // A1
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/** Semitone offset -> Hz, relative to the root. */
export function noteHz(semitones: number): number {
  return ROOT * Math.pow(2, semitones / 12);
}

/** Degree within A minor (may exceed one octave) -> semitone offset. */
export function scaleDegree(degree: number): number {
  const octave = Math.floor(degree / MINOR_SCALE.length);
  const index = ((degree % MINOR_SCALE.length) + MINOR_SCALE.length) % MINOR_SCALE.length;
  return MINOR_SCALE[index] + octave * 12;
}

export interface TierConfig {
  /** Streak required to reach this tier. */
  streak: number;
  bpm: number;
  /** Layer switches. Each tier turns on what the tier below already had. */
  kick: boolean;
  sub: boolean;
  closedHat: boolean;
  bassline: boolean;
  clap: boolean;
  openHat: boolean;
  acid: boolean;
  ride: boolean;
  rideSixteenths: boolean;
  stabs: boolean;
  /** Acid filter cutoff in Hz — the single most audible escalation cue. */
  acidCutoff: number;
  acidResonance: number;
  /** How much acid goes to the delay line. */
  acidSend: number;
  /** Depth of the kick-triggered sidechain duck, 0..1. */
  sidechainDepth: number;
  /** Display name, shown when the tier changes. */
  label: string;
}

export const TIERS: TierConfig[] = [
  {
    streak: 0,
    bpm: 124,
    kick: true,
    sub: true,
    closedHat: true,
    bassline: false,
    clap: false,
    openHat: false,
    acid: false,
    ride: false,
    rideSixteenths: false,
    stabs: false,
    acidCutoff: 400,
    acidResonance: 6,
    acidSend: 0,
    sidechainDepth: 0.3,
    label: 'WARMING UP',
  },
  {
    streak: 3,
    bpm: 126,
    kick: true,
    sub: true,
    closedHat: true,
    bassline: true,
    clap: false,
    openHat: false,
    acid: false,
    ride: false,
    rideSixteenths: false,
    stabs: false,
    acidCutoff: 500,
    acidResonance: 7,
    acidSend: 0,
    sidechainDepth: 0.4,
    label: 'ROLLING',
  },
  {
    streak: 6,
    bpm: 128,
    kick: true,
    sub: true,
    closedHat: true,
    bassline: true,
    clap: true,
    openHat: true,
    acid: false,
    ride: false,
    rideSixteenths: false,
    stabs: false,
    acidCutoff: 600,
    acidResonance: 8,
    acidSend: 0,
    sidechainDepth: 0.45,
    label: 'LOCKED IN',
  },
  {
    streak: 10,
    bpm: 132,
    kick: true,
    sub: true,
    closedHat: true,
    bassline: true,
    clap: true,
    openHat: true,
    acid: true,
    ride: true,
    rideSixteenths: false,
    stabs: false,
    acidCutoff: 900,
    acidResonance: 10,
    acidSend: 0.15,
    sidechainDepth: 0.5,
    label: 'ACID',
  },
  {
    streak: 15,
    bpm: 136,
    kick: true,
    sub: true,
    closedHat: true,
    bassline: true,
    clap: true,
    openHat: true,
    acid: true,
    ride: true,
    rideSixteenths: false,
    stabs: true,
    acidCutoff: 1800,
    acidResonance: 13,
    acidSend: 0.25,
    sidechainDepth: 0.58,
    label: 'PEAK TIME',
  },
  {
    streak: 21,
    bpm: 140,
    kick: true,
    sub: true,
    closedHat: true,
    bassline: true,
    clap: true,
    openHat: true,
    acid: true,
    ride: true,
    rideSixteenths: true,
    stabs: true,
    acidCutoff: 3400,
    acidResonance: 16,
    acidSend: 0.4,
    sidechainDepth: 0.65,
    label: 'OVERDRIVE',
  },
];

/** Highest tier whose streak requirement is met. */
export function tierForStreak(streak: number): number {
  let tier = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (streak >= TIERS[i].streak) tier = i;
  }
  return tier;
}

// --- Step patterns -------------------------------------------------------
// Index is the step within the bar, 0..15. Truthy means "play here".

/** Four on the floor. */
export const KICK_PATTERN = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Offbeat 8ths — the "tss, tss" between kicks. */
export const CLOSED_HAT_PATTERN = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];

/** Open hats on the offbeat 8th, giving the track its lift. */
export const OPEN_HAT_PATTERN = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0];

/** Backbeat. */
export const CLAP_PATTERN = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];

export const RIDE_PATTERN = [0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0];

export const STAB_PATTERN = [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Rolling 16th bassline. `null` is a rest; numbers are scale degrees. The
 * pattern leaves the downbeat to the sub and kick and fills the gaps, which is
 * what gives the groove its forward roll.
 */
export const BASS_LINE: (number | null)[] = [
  0, null, 0, 0, null, 0, 0, null, 2, null, 0, 0, null, 4, 0, 3,
];

/** Steps where the bass hits harder and the filter opens further. */
export const BASS_ACCENTS = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0];

/**
 * Two-bar acid line — 32 steps. Two bars rather than one because a one-bar acid
 * loop gets tiring fast, and this is the layer players hear longest.
 */
export const ACID_LINE: (number | null)[] = [
  7, null, 7, 9, null, 7, 10, null, 7, null, 11, 9, null, 7, null, 9,
  7, null, 7, 12, null, 11, 9, null, 7, null, 9, 7, null, 4, 7, null,
];

export const ACID_ACCENTS = [
  1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0,
  1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
];

/** Steps where the acid slides into the next note. */
export const ACID_SLIDES = [
  0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1,
  0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
];

/** Minor triad voicing for the stabs, as scale degrees above the root. */
export const STAB_CHORD = [7, 9, 11];
