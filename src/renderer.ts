import SimpleHeat from 'simpleheat';
import type { HeatPoint, Renderer, Viewport } from './types';
/** A viewport-sized renderer. simpleheat is pinned in package-lock.json. */
export class CanvasRenderer implements Renderer {
  private heat: SimpleHeat;
  private viewport: Viewport = { width: 0, height: 0, dpr: 1 };
  constructor(private canvas: HTMLCanvasElement) { this.heat = new SimpleHeat(canvas); }
  resize(viewport: Viewport): void {
    this.viewport = { ...viewport };
    this.canvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
    this.canvas.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
    this.canvas.style.width = `${viewport.width}px`;
    this.canvas.style.height = `${viewport.height}px`;
    this.heat.radius(28 * viewport.dpr, 30 * viewport.dpr);
  }
  draw(points: readonly HeatPoint[]): void {
    const dpr = this.viewport.dpr;
    this.heat.data(points.filter(p => p.normalized > 0).map(p => [p.x * dpr, p.y * dpr, p.normalized])).max(1).draw(0);
  }
  destroy(): void { this.heat.clear(); this.canvas.width = 1; this.canvas.height = 1; }
}
