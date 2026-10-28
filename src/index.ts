import { validateData, validateMax, scaleFor } from './data';
import { CanvasRenderer } from './renderer';
import type { HeatDatum, HeatmapOptions, HeatPoint, Renderer, Viewport } from './types';
export type { HeatDatum, HeatmapOptions, HeatPoint, Renderer, RendererFactory, Viewport } from './types';
export { CanvasRenderer } from './renderer';

/** Displays supplied element values in an isolated, viewport-sized overlay. */
export class PageHeatmap {
  private win: Window;
  private doc: Document;
  private data: HeatDatum[];
  private scale: number;
  private max?: number;
  private overlay: HTMLDivElement;
  private renderer: Renderer;
  private mutation: MutationObserver;
  private resize: ResizeObserver;
  private elements = new Map<string, Element>();
  private points: HeatPoint[] = [];
  private viewport?: Viewport;
  private frame: number | null = null;
  private dirtyElements = true;
  private paused = false;
  private destroyed = false;
  private lastPaint = '';
  private visibility: 'viewport' | 'unoccluded';
  private hover?: HeatmapOptions['onHover'];

  constructor(options: HeatmapOptions = {}) {
    this.win = options.window ?? window;
    this.doc = this.win.document;
    if (!this.doc.body) throw new Error('document.body must exist before creating a heatmap');
    this.max = validateMax(options.max);
    this.data = validateData(options.data ?? [], this.doc);
    this.scale = scaleFor(this.data, this.max);
    this.visibility = options.visibility ?? 'viewport';
    if (this.visibility !== 'viewport' && this.visibility !== 'unoccluded') throw new TypeError('invalid visibility');
    this.hover = options.onHover;
    this.overlay = this.doc.createElement('div');
    this.overlay.dataset.pageHeatmap = '';
    Object.assign(this.overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none', overflow: 'hidden' });
    const canvas = this.doc.createElement('canvas');
    this.overlay.append(canvas);
    this.renderer = (options.renderer ?? (el => new CanvasRenderer(el)))(canvas);
    this.doc.body.append(this.overlay);
    this.mutation = new MutationObserver(records => {
      if (records.some(record => !this.overlay.contains(record.target))) {
        this.dirtyElements = true; this.schedule();
      }
    });
    this.resize = new ResizeObserver(() => this.schedule());
    this.mutation.observe(this.doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    this.resize.observe(this.doc.documentElement);
    this.doc.addEventListener('scroll', this.onChange, true);
    this.win.addEventListener('resize', this.onChange);
    this.win.visualViewport?.addEventListener('resize', this.onChange);
    this.win.visualViewport?.addEventListener('scroll', this.onChange);
    this.doc.fonts?.addEventListener('loadingdone', this.onChange);
    if (this.hover) this.doc.addEventListener('mousemove', this.onMouse);
    this.schedule();
  }
  private onChange = (): void => { this.schedule(); };
  private onMouse = (event: MouseEvent): void => {
    const point = [...this.points].reverse().find(p => event.clientX >= p.rect.left && event.clientX <= p.rect.right && event.clientY >= p.rect.top && event.clientY <= p.rect.bottom) ?? null;
    this.hover?.(point, event);
  };
  private schedule(): void {
    if (this.destroyed || this.paused || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => { this.frame = null; this.paint(); });
  }
  private resolveElements(): void {
    this.elements.clear();
    this.resize.disconnect();
    this.resize.observe(this.doc.documentElement);
    for (const item of this.data) {
      const el = this.doc.querySelector(item.selector);
      if (el) { this.elements.set(item.id, el); this.resize.observe(el); }
    }
    this.dirtyElements = false;
  }
  private paint(): void {
    if (this.destroyed || this.paused) return;
    if (this.dirtyElements) this.resolveElements();
    const viewport = { width: this.win.innerWidth, height: this.win.innerHeight, dpr: this.win.devicePixelRatio || 1 };
    const sizeChanged = !this.viewport || viewport.width !== this.viewport.width || viewport.height !== this.viewport.height || viewport.dpr !== this.viewport.dpr;
    if (sizeChanged) { this.viewport = viewport; this.renderer.resize(viewport); }
    const points: HeatPoint[] = [];
    for (const item of this.data) {
      const el = this.elements.get(item.id);
      if (!el || !el.isConnected || item.value === 0) continue;
      const rect = el.getBoundingClientRect();
      const style = this.win.getComputedStyle(el);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') continue;
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(viewport.width, rect.right), bottom = Math.min(viewport.height, rect.bottom);
      if (left >= right || top >= bottom) continue;
      const x = (left + right) / 2, y = (top + bottom) / 2;
      if (this.visibility === 'unoccluded') {
        const hit = this.doc.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit))) continue;
      }
      points.push({ id: item.id, x, y, value: item.value, normalized: Math.min(1, item.value / this.scale), rect: { left, top, right, bottom } });
    }
    this.points = points;
    const signature = JSON.stringify(points);
    if (sizeChanged || signature !== this.lastPaint) { this.renderer.draw(points); this.lastPaint = signature; }
  }
  setData(input: readonly HeatDatum[]): void {
    if (this.destroyed) throw new Error('heatmap is destroyed');
    const data = validateData(input, this.doc);
    this.data = data; this.scale = scaleFor(data, this.max); this.dirtyElements = true; this.schedule();
  }
  /** Re-check positions; use this during CSS animations or other unobserved changes. */
  refresh(): void { this.schedule(); }
  pause(): void {
    if (this.destroyed || this.paused) return;
    this.paused = true;
    if (this.frame !== null) { this.win.cancelAnimationFrame(this.frame); this.frame = null; }
  }
  stop(): void { this.pause(); }
  start(): void { if (this.destroyed || !this.paused) return; this.paused = false; this.dirtyElements = true; this.schedule(); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) { this.win.cancelAnimationFrame(this.frame); this.frame = null; }
    this.mutation.disconnect(); this.resize.disconnect();
    this.doc.removeEventListener('scroll', this.onChange, true);
    this.win.removeEventListener('resize', this.onChange);
    this.win.visualViewport?.removeEventListener('resize', this.onChange);
    this.win.visualViewport?.removeEventListener('scroll', this.onChange);
    this.doc.fonts?.removeEventListener('loadingdone', this.onChange);
    if (this.hover) this.doc.removeEventListener('mousemove', this.onMouse);
    this.renderer.destroy(); this.overlay.remove(); this.elements.clear(); this.points = [];
  }
}
