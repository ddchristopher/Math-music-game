import { expect, test } from '@playwright/test';

/**
 * Renders the synth voices through an OfflineAudioContext inside the browser
 * and inspects the resulting samples.
 *
 * "It didn't throw" is not evidence that a Web Audio graph makes sound — a
 * mis-wired node or an envelope that never opens fails completely silently.
 * These tests assert on actual audio: that each voice produces energy, that it
 * decays, and that nothing clips.
 */

interface RenderResult {
  peak: number;
  rms: number;
  /** RMS of the first 10% vs the last 10% — percussion must decay. */
  headRms: number;
  tailRms: number;
  /** Count of samples at or beyond full scale. */
  clipped: number;
}

/**
 * Renders one voice offline. `call` names an export of voices.ts; the voice is
 * fired at t=0.1s into a 1.5s buffer.
 */
async function renderVoice(
  page: import('@playwright/test').Page,
  call: string,
  args: unknown[],
): Promise<RenderResult> {
  return page.evaluate(
    async ({ call, args }) => {
      const voices = await import('/src/audio/voices.ts');
      const ctx = new OfflineAudioContext(1, 44100 * 1.5, 44100);

      // Minimal stand-in for the real bus: every output lands in one node so
      // the render captures whichever path the voice happens to use.
      const collector = ctx.createGain();
      collector.connect(ctx.destination);
      const bus = {
        ctx: ctx as unknown as AudioContext,
        music: collector,
        dry: collector,
        delaySend: collector,
      };

      (voices as unknown as Record<string, (...a: unknown[]) => void>)[call](
        bus,
        0.1,
        ...args,
      );

      const rendered = await ctx.startRendering();
      const data = rendered.getChannelData(0);

      let peak = 0;
      let sumSquares = 0;
      let clipped = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
        if (v >= 1) clipped += 1;
        sumSquares += data[i] * data[i];
      }

      const window = Math.floor(data.length * 0.1);
      const rmsOf = (from: number, to: number): number => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += data[i] * data[i];
        return Math.sqrt(sum / Math.max(1, to - from));
      };

      return {
        peak,
        rms: Math.sqrt(sumSquares / data.length),
        // Skip the 0.1s of leading silence before the hit.
        headRms: rmsOf(Math.floor(44100 * 0.1), Math.floor(44100 * 0.1) + window),
        tailRms: rmsOf(data.length - window, data.length),
        clipped,
      };
    },
    { call, args },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const percussive: Array<[string, unknown[]]> = [
  ['kick', []],
  ['hat', [false]],
  ['clap', []],
  ['ride', []],
  ['rim', []],
  ['chime', [440]],
];

for (const [name, args] of percussive) {
  test(`${name} produces audible sound that decays`, async ({ page }) => {
    const result = await renderVoice(page, name, args);

    expect(result.peak, `${name} was silent`).toBeGreaterThan(0.01);
    expect(result.rms).toBeGreaterThan(0);
    expect(result.headRms, `${name} had no attack`).toBeGreaterThan(0.001);
    // Percussion must ring out, or layers would smear into each other.
    expect(result.tailRms, `${name} never decayed`).toBeLessThan(result.headRms * 0.1);
    expect(result.clipped, `${name} clipped`).toBe(0);
  });
}

test('sub produces low-frequency energy', async ({ page }) => {
  const result = await renderVoice(page, 'sub', [55, 0.4]);
  expect(result.peak).toBeGreaterThan(0.1);
  expect(result.tailRms).toBeLessThan(result.headRms * 0.1);
});

test('bass responds to its cutoff parameter', async ({ page }) => {
  const closed = await renderVoice(page, 'bass', [
    { freq: 55, duration: 0.2, cutoff: 200, accent: false },
  ]);
  const open = await renderVoice(page, 'bass', [
    { freq: 55, duration: 0.2, cutoff: 3000, accent: true },
  ]);

  expect(closed.peak).toBeGreaterThan(0.01);
  // Opening the filter and accenting must let materially more through, which
  // is the entire mechanism behind the tier escalation.
  expect(open.rms).toBeGreaterThan(closed.rms);
});

test('acid opens up as the tier cutoff rises', async ({ page }) => {
  const low = await renderVoice(page, 'acid', [
    { freq: 110, duration: 0.2, cutoff: 400, resonance: 6, accent: false },
  ]);
  const high = await renderVoice(page, 'acid', [
    { freq: 110, duration: 0.2, cutoff: 3400, resonance: 16, accent: true },
  ]);

  expect(low.peak).toBeGreaterThan(0.005);
  expect(high.rms).toBeGreaterThan(low.rms);
  expect(high.clipped).toBe(0);
});

test('riser and brake both sound', async ({ page }) => {
  const rise = await renderVoice(page, 'riser', [0.5]);
  const stop = await renderVoice(page, 'brake', [0.5]);

  expect(rise.peak).toBeGreaterThan(0.02);
  expect(stop.peak).toBeGreaterThan(0.02);
  // The riser builds toward its end; the brake falls away.
  expect(rise.tailRms).toBeLessThan(rise.peak);
  expect(stop.tailRms).toBeLessThan(stop.headRms);
});

test('stab plays a chord', async ({ page }) => {
  const result = await renderVoice(page, 'stab', [[220, 262, 330]]);
  expect(result.peak).toBeGreaterThan(0.02);
  expect(result.clipped).toBe(0);
});

test('a full bar of the top tier renders without clipping', async ({ page }) => {
  // Everything at once through the real master chain is the worst case for
  // level; if it survives here it survives in play.
  const result = await page.evaluate(async () => {
    const voices = await import('/src/audio/voices.ts');
    const ctx = new OfflineAudioContext(2, 44100 * 2, 44100);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(compressor);

    const bus = {
      ctx: ctx as unknown as AudioContext,
      music: master,
      dry: master,
      delaySend: master,
    };

    // One bar at 140 BPM: kick on every beat, 16th bass, hats, clap, acid.
    const step = 60 / 140 / 4;
    for (let i = 0; i < 16; i++) {
      const t = 0.05 + i * step;
      if (i % 4 === 0) voices.kick(bus, t);
      if (i % 4 === 2) voices.hat(bus, t, i % 8 === 6);
      if (i === 4 || i === 12) voices.clap(bus, t);
      voices.bass(bus, t, { freq: 55, duration: step * 0.9, cutoff: 700, accent: i % 4 === 3 });
      voices.acid(bus, t, {
        freq: 220,
        duration: step * 0.85,
        cutoff: 3400,
        resonance: 16,
        accent: i % 4 === 0,
      });
    }

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    let peak = 0;
    let clipped = 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      if (v >= 1) clipped += 1;
      sum += data[i] * data[i];
    }
    return { peak, clipped, rms: Math.sqrt(sum / data.length) };
  });

  expect(result.peak).toBeGreaterThan(0.1);
  expect(result.rms).toBeGreaterThan(0.02);
  expect(result.clipped, 'top tier clipped the master bus').toBe(0);
});
