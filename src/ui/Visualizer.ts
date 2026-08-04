/**
 * Background visualizer. Reacts to the beat and shifts palette with the tier.
 *
 * Deliberately restrained: this sits behind arithmetic the player is actively
 * doing, so anything that pulls the eye is a bug, not a feature. Everything
 * here lives in the periphery — low contrast, slow movement, no motion near the
 * centre where the problem is. `prefers-reduced-motion` disables it entirely.
 */

import { NUM_TIERS } from '../audio/patterns';

/** Base hue per tier: deep blue -> violet -> magenta -> hot orange. */
const TIER_HUES = [210, 225, 262, 292, 322, 24];

export function hueForTier(tier: number): number {
  return TIER_HUES[Math.max(0, Math.min(NUM_TIERS - 1, tier))];
}

interface Shockwave {
  radius: number;
  life: number;
  hue: number;
}

export class Visualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private width = 0;
  private height = 0;
  private dpr = 1;

  private kickEnergy = 0;
  private clapEnergy = 0;
  private acidEnergy = 0;
  private shockwaves: Shockwave[] = [];

  /** Smoothed hue so tier changes glide rather than snap. */
  private hue = TIER_HUES[0];
  private targetHue = TIER_HUES[0];

  /** Bar heights for the peripheral spectrum-ish ring. */
  private bars: number[] = new Array(48).fill(0);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setTier(tier: number): void {
    this.targetHue = hueForTier(tier);
  }

  get currentHue(): number {
    return this.hue;
  }

  pulse(kind: 'kick' | 'clap' | 'hat' | 'acid', strength: number): void {
    switch (kind) {
      case 'kick':
        this.kickEnergy = Math.min(1.4, this.kickEnergy + strength);
        this.bumpBars(strength);
        break;
      case 'clap':
        this.clapEnergy = Math.min(1, this.clapEnergy + strength);
        break;
      case 'acid':
        this.acidEnergy = Math.min(1, this.acidEnergy + strength * 0.6);
        break;
      case 'hat':
        this.bumpBars(strength * 0.4);
        break;
    }
  }

  private bumpBars(strength: number): void {
    for (let i = 0; i < this.bars.length; i++) {
      this.bars[i] = Math.min(1, this.bars[i] + strength * (0.3 + Math.random() * 0.7));
    }
  }

  shockwave(tier: number): void {
    this.shockwaves.push({ radius: 0, life: 1, hue: hueForTier(tier) });
  }

  render(dt: number, reducedMotion: boolean): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);

    // Hue glides toward the target by the shortest path around the wheel.
    const diff = ((this.targetHue - this.hue + 540) % 360) - 180;
    this.hue = (this.hue + diff * Math.min(1, dt * 1.5) + 360) % 360;

    this.kickEnergy = Math.max(0, this.kickEnergy - dt * 3.4);
    this.clapEnergy = Math.max(0, this.clapEnergy - dt * 2.6);
    this.acidEnergy = Math.max(0, this.acidEnergy - dt * 2);
    for (let i = 0; i < this.bars.length; i++) {
      this.bars[i] = Math.max(0, this.bars[i] - dt * 1.9);
    }

    this.drawBackdrop(reducedMotion);
    if (reducedMotion) {
      this.shockwaves = [];
      return;
    }
    this.drawBars();
    this.drawShockwaves(dt);
  }

  private drawBackdrop(reducedMotion: boolean): void {
    const { ctx } = this;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const pulse = reducedMotion ? 0 : this.kickEnergy;
    const radius = Math.max(this.width, this.height) * (0.55 + pulse * 0.08);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `hsla(${this.hue}, 65%, ${11 + pulse * 5}%, 1)`);
    gradient.addColorStop(0.55, `hsla(${(this.hue + 20) % 360}, 60%, ${7 + pulse * 3}%, 1)`);
    gradient.addColorStop(1, 'hsl(230, 40%, 4%)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!reducedMotion && this.acidEnergy > 0.01) {
      // Faint corner bloom on acid accents, well away from the problem text.
      const bloom = ctx.createRadialGradient(
        this.width,
        this.height,
        0,
        this.width,
        this.height,
        this.width * 0.6,
      );
      bloom.addColorStop(0, `hsla(${(this.hue + 40) % 360}, 90%, 55%, ${this.acidEnergy * 0.16})`);
      bloom.addColorStop(1, 'transparent');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawBars(): void {
    const { ctx } = this;
    const cx = this.width / 2;
    const cy = this.height / 2;
    // Ring sits outside the content area so it never crowds the arithmetic,
    // but inside the viewport — clipped at the edges it reads as scattered
    // debris rather than a deliberate frame.
    const inner = Math.min(this.width, this.height) * 0.42;
    const count = this.bars.length;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const height = this.bars[i] * 26 + 2;
      const x1 = cx + Math.cos(angle) * inner;
      const y1 = cy + Math.sin(angle) * inner;
      const x2 = cx + Math.cos(angle) * (inner + height);
      const y2 = cy + Math.sin(angle) * (inner + height);

      ctx.beginPath();
      ctx.strokeStyle = `hsla(${(this.hue + i * 1.5) % 360}, 90%, 60%, ${
        0.1 + this.bars[i] * 0.4
      })`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawShockwaves(dt: number): void {
    const { ctx } = this;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const survivors: Shockwave[] = [];

    for (const wave of this.shockwaves) {
      wave.radius += dt * 900;
      wave.life -= dt * 1.2;
      if (wave.life <= 0) continue;
      survivors.push(wave);

      ctx.beginPath();
      ctx.strokeStyle = `hsla(${wave.hue}, 100%, 65%, ${wave.life * 0.5})`;
      ctx.lineWidth = 3 * wave.life;
      ctx.arc(cx, cy, wave.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.shockwaves = survivors;
  }
}
