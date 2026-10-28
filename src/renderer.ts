import SimpleHeat from 'simpleheat';
import type { HeatPoint, Renderer, Viewport } from './types.js';

export interface CanvasRendererOptions {
  /** Solid radius in CSS pixels. Default: 28. */
  radius?: number;
  /** Blur radius in CSS pixels. Default: 30. */
  blur?: number;
  /** Minimum opacity of nonzero points, between 0 and 1. Default: 0. */
  minOpacity?: number;
}

/** A viewport-sized renderer. simpleheat is pinned in package-lock.json. */
export class CanvasRenderer implements Renderer {
  private heat: SimpleHeat;
  private context: CanvasRenderingContext2D;
  private viewport: Viewport = { width: 0, height: 0, dpr: 1 };
  private radius: number;
  private blur: number;
  private minOpacity: number;
  private configuredDpr?: number;
  private destroyed = false;

  constructor(private canvas: HTMLCanvasElement, options: CanvasRendererOptions = {}) {
    this.radius = options.radius ?? 28;
    this.blur = options.blur ?? 30;
    this.minOpacity = options.minOpacity ?? 0;
    if (!Number.isFinite(this.radius) || this.radius <= 0) throw new TypeError('radius must be finite and positive');
    if (!Number.isFinite(this.blur) || this.blur < 0) throw new TypeError('blur must be finite and non-negative');
    if (!Number.isFinite(this.minOpacity) || this.minOpacity < 0 || this.minOpacity > 1) throw new TypeError('minOpacity must be between 0 and 1');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    this.heat = new SimpleHeat(canvas);
  }

  resize(viewport: Viewport): void {
    if (this.destroyed) return;
    if (![viewport.width, viewport.height, viewport.dpr].every(Number.isFinite) || viewport.width < 0 || viewport.height < 0 || viewport.dpr <= 0) {
      throw new TypeError('viewport dimensions must be non-negative and DPR must be positive');
    }
    this.viewport = { ...viewport };
    this.canvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
    this.canvas.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
    this.canvas.style.setProperty('width', `${viewport.width}px`, 'important');
    this.canvas.style.setProperty('height', `${viewport.height}px`, 'important');
    if (this.configuredDpr !== viewport.dpr) {
      this.heat.radius(this.radius * viewport.dpr, this.blur * viewport.dpr);
      this.configuredDpr = viewport.dpr;
    }
  }

  draw(points: readonly HeatPoint[]): void {
    if (this.destroyed) return;
    const dpr = this.viewport.dpr;
    const data: [number, number, number][] = [];
    for (const point of points) {
      if (point.normalized > 0) data.push([point.x * dpr, point.y * dpr, point.normalized]);
    }
    // Empty data must clear, but need not read/colorize every backing pixel.
    if (data.length === 0) {
      this.heat.clear();
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.heat.data(data).max(1).draw(this.minOpacity);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.heat.clear();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
