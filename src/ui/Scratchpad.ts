/**
 * Reactive ink scratchpad.
 *
 * The point of this is to keep players inside the game instead of reaching for
 * paper. That only works if writing here is *nicer* than paper, so the ink is
 * beat-reactive: strokes glow on the downbeat, carry the current tier's hue,
 * fade out on their own, and each stroke fires a quantized percussive tick so
 * that working the problem plays along with the track.
 *
 * Two canvases: strokes are redrawn every frame (they fade, so caching buys
 * little) while particles live on the same surface. Stroke count is capped so
 * per-frame cost stays bounded no matter how much someone scribbles.
 */

export interface StrokePoint {
  x: number;
  y: number;
  /** Stroke width at this point, derived from draw velocity. */
  width: number;
}

interface Stroke {
  points: StrokePoint[];
  /** performance.now() when the stroke ended; 0 while still being drawn. */
  endedAt: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

const MAX_STROKES = 40;
const FADE_START_MS = 1800;
const FADE_DURATION_MS = 2200;
const BASE_WIDTH = 4.5;

export interface ScratchpadCallbacks {
  /** Fired on stroke start — the game quantizes a tick to the next 16th. */
  onStrokeStart?: () => void;
  /** Fired continuously while drawing, with 0..1 normalized speed. */
  onDraw?: (speed: number) => void;
}

export class Scratchpad {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: ScratchpadCallbacks;

  private strokes: Stroke[] = [];
  private active: Stroke | null = null;
  private particles: Particle[] = [];

  private lastPoint: { x: number; y: number; t: number } | null = null;

  /** Set by the game loop; drives the beat glow and the ink colour. */
  private beatEnergy = 0;
  /**
   * All live ink shares one hue, glided toward the current tier's colour, so a
   * tier change recolours the whole scratchpad rather than leaving strokes
   * drawn a moment earlier stranded on the old palette.
   */
  private hue = 210;
  private targetHue = 210;

  private dpr = 1;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: ScratchpadCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.callbacks = callbacks;

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerUp);
    // Stop touch-drawing from scrolling the page.
    canvas.style.touchAction = 'none';
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

  setHue(hue: number, immediate = false): void {
    this.targetHue = hue;
    if (immediate) this.hue = hue;
  }

  /** Called on each kick so the ink pulses with the track. */
  pulse(strength: number): void {
    this.beatEnergy = Math.min(1, this.beatEnergy + strength);
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    const { x, y } = this.localPoint(event);
    this.active = { points: [{ x, y, width: BASE_WIDTH }], endedAt: 0 };
    this.lastPoint = { x, y, t: performance.now() };
    this.callbacks.onStrokeStart?.();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.lastPoint) return;
    event.preventDefault();
    const { x, y } = this.localPoint(event);
    const now = performance.now();
    const dt = Math.max(1, now - this.lastPoint.t);
    const dist = Math.hypot(x - this.lastPoint.x, y - this.lastPoint.y);
    if (dist < 1.2) return;

    // Faster strokes are thinner, the way a real pen behaves.
    const speed = Math.min(1, dist / dt / 2.2);
    const pressure = event.pressure > 0 && event.pressure !== 0.5 ? event.pressure : 0.5;
    const width = BASE_WIDTH * (1.35 - speed * 0.7) * (0.6 + pressure * 0.8);

    this.active.points.push({ x, y, width });
    this.lastPoint = { x, y, t: now };
    this.callbacks.onDraw?.(speed);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.active) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.active.endedAt = performance.now();
    // A tap with no travel leaves a dot rather than nothing.
    this.strokes.push(this.active);
    if (this.strokes.length > MAX_STROKES) this.strokes.shift();
    this.active = null;
    this.lastPoint = null;
  };

  /** Wipe instantly, no animation. Used when a new problem appears. */
  clear(): void {
    this.strokes = [];
    this.active = null;
    this.particles = [];
  }

  /**
   * Dissolve the ink into particles flying toward a target point — used on a
   * correct answer so the working visibly turns into score.
   */
  dissolve(targetX: number, targetY: number): void {
    const all = this.active ? [...this.strokes, this.active] : this.strokes;
    for (const stroke of all) {
      // Sample rather than emit per point: dense strokes would spawn thousands.
      for (let i = 0; i < stroke.points.length; i += 3) {
        const p = stroke.points[i];
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const speed = 0.6 + Math.random() * 0.9;
        this.particles.push({
          x: p.x,
          y: p.y,
          vx: (dx / dist) * speed * 4 + (Math.random() - 0.5) * 1.5,
          vy: (dy / dist) * speed * 4 + (Math.random() - 0.5) * 1.5,
          life: 1,
          hue: this.hue,
        });
      }
    }
    if (this.particles.length > 600) {
      this.particles = this.particles.slice(-600);
    }
    this.strokes = [];
    this.active = null;
    this.lastPoint = null;
  }

  get isEmpty(): boolean {
    return this.strokes.length === 0 && this.active === null;
  }

  render(dt: number, reducedMotion: boolean): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);

    // Glide the hue by the shortest path around the colour wheel.
    const hueDelta = ((this.targetHue - this.hue + 540) % 360) - 180;
    this.hue = (this.hue + hueDelta * Math.min(1, dt * 1.5) + 360) % 360;

    this.beatEnergy = Math.max(0, this.beatEnergy - dt * 3.2);
    const glow = reducedMotion ? 0.25 : 0.25 + this.beatEnergy * 0.75;
    const now = performance.now();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Drop fully faded strokes before drawing.
    this.strokes = this.strokes.filter(
      (s) => s.endedAt === 0 || now - s.endedAt < FADE_START_MS + FADE_DURATION_MS,
    );

    const toDraw = this.active ? [...this.strokes, this.active] : this.strokes;
    for (const stroke of toDraw) {
      const age = stroke.endedAt === 0 ? 0 : now - stroke.endedAt;
      const fade =
        age <= FADE_START_MS ? 1 : 1 - (age - FADE_START_MS) / FADE_DURATION_MS;
      if (fade <= 0) continue;
      this.drawStroke(stroke, fade, glow, reducedMotion);
    }

    this.renderParticles(dt);
  }

  private drawStroke(
    stroke: Stroke,
    fade: number,
    glow: number,
    reducedMotion: boolean,
  ): void {
    const { ctx } = this;
    const pts = stroke.points;
    if (pts.length === 0) return;
    const hue = this.hue;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, 90%, ${60 + glow * 20}%, ${fade})`;
      ctx.arc(pts[0].x, pts[0].y, pts[0].width * 0.6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (!reducedMotion) {
      ctx.shadowBlur = 8 + glow * 14;
      ctx.shadowColor = `hsla(${hue}, 100%, 65%, ${fade * 0.8})`;
    }
    ctx.strokeStyle = `hsla(${hue}, 95%, ${62 + glow * 18}%, ${fade})`;

    // Quadratic smoothing through midpoints: cheap, and removes the polygonal
    // look that plain lineTo gives at speed.
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      ctx.beginPath();
      ctx.lineWidth = curr.width * (0.85 + glow * 0.35);
      ctx.moveTo(prev.x, prev.y);
      if (i < pts.length - 1) {
        const next = pts[i + 1];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      } else {
        ctx.lineTo(curr.x, curr.y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  private renderParticles(dt: number): void {
    if (this.particles.length === 0) return;
    const { ctx } = this;
    const survivors: Particle[] = [];

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt * 1.6;
      if (p.life <= 0) continue;
      survivors.push(p);

      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.life})`;
      ctx.arc(p.x, p.y, 2.2 * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    this.particles = survivors;
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
  }
}
