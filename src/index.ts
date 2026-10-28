import { validateData, validateMax, scaleFor } from './data.js';
import { CanvasRenderer } from './renderer.js';
import type { HeatDatum, HeatmapOptions, HeatPoint, Renderer, Viewport } from './types.js';
export type { HeatDatum, HeatmapOptions, HeatPoint, Renderer, RendererFactory, Viewport } from './types.js';
export { CanvasRenderer } from './renderer.js';
export type { CanvasRendererOptions } from './renderer.js';

// A WeakSet also recognizes detached overlays without reserving an ID or selector.
// Ignore every instance's rendering mutations, not only our own canvas writes.
const overlays = new WeakSet<Node>();
function isOverlayNode(node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (overlays.has(current)) return true;
  }
  return false;
}
function affectsPage(record: MutationRecord): boolean {
  if (isOverlayNode(record.target)) return false;
  if (record.type !== 'childList') return true;
  return [...record.addedNodes, ...record.removedNodes].some(node => !isOverlayNode(node));
}
const clips = /^(auto|scroll|hidden|clip)$/;
type PositionedEscape = 'absolute' | 'fixed' | undefined;
const positionedEscape = (style: CSSStyleDeclaration): PositionedEscape => style.position === 'absolute' || style.position === 'fixed' ? style.position : undefined;
const nonNone = (value: string): boolean => !!value && value !== 'none';
const hasContainment = (style: CSSStyleDeclaration): boolean => nonNone(style.contain) || style.contentVisibility === 'auto' || style.contentVisibility === 'hidden';
const hasPaintContainment = (style: CSSStyleDeclaration): boolean => /\b(paint|strict|content)\b/.test(style.contain) || style.contentVisibility === 'auto';
function establishesContainingBlock(style: CSSStyleDeclaration, position: PositionedEscape, isRoot: boolean): boolean {
  if (style.display === 'none' || style.display === 'contents') return false;
  if (position === 'absolute' && ((!!style.position && style.position !== 'static') || /\bposition\b/.test(style.willChange))) return true;
  // CSS Position/Transforms/Containment and Filter Effects define these CBs.
  // Being a stacking context alone (e.g. opacity or z-index) is not sufficient.
  return [style.transform, style.perspective, style.translate, style.rotate, style.scale].some(nonNone)
    || style.transformStyle === 'preserve-3d'
    || (!isRoot && (nonNone(style.filter) || nonNone(style.backdropFilter)))
    || /\b(layout|paint|strict|content)\b/.test(style.contain)
    || style.contentVisibility === 'auto'
    || /\b(transform|perspective|translate|rotate|scale|filter|backdrop-filter|contain)\b/.test(style.willChange);
}

/** Displays supplied element values in an isolated, viewport-sized overlay. */
export class PageHeatmap {
  private win: Window & typeof globalThis;
  private doc: Document;
  private data: HeatDatum[];
  private scale: number;
  private max?: number;
  private overlay: HTMLDivElement;
  private renderer: Renderer;
  private mutation: MutationObserver;
  private resize: ResizeObserver;
  private elements = new Map<string, Element>();
  private observed = new Set<Element>();
  private points: HeatPoint[] = [];
  private viewport?: Viewport;
  private frame: number | null = null;
  private dirtyElements = true;
  private paused = false;
  private destroyed = false;
  private listening = false;
  private resolution?: MediaQueryList;
  private lastPaint = '';
  private visibility: 'viewport' | 'unoccluded';
  private hover?: HeatmapOptions['onHover'];

  constructor(options: HeatmapOptions = {}) {
    const target = options.window ?? (typeof window === 'undefined' ? undefined : window);
    if (!target) throw new Error('PageHeatmap requires a browser window');
    this.win = target as Window & typeof globalThis;
    this.doc = this.win.document;
    if (!this.doc.body) throw new Error('document.body must exist before creating a heatmap');
    if (!this.win.MutationObserver || !this.win.ResizeObserver) {
      throw new Error('PageHeatmap requires MutationObserver and ResizeObserver');
    }
    this.max = validateMax(options.max);
    this.data = validateData(options.data === undefined ? [] : options.data, this.doc);
    this.scale = scaleFor(this.data, this.max);
    this.visibility = options.visibility ?? 'viewport';
    if (this.visibility !== 'viewport' && this.visibility !== 'unoccluded') throw new TypeError('invalid visibility');
    if (options.onHover !== undefined && typeof options.onHover !== 'function') throw new TypeError('onHover must be a function');
    this.hover = options.onHover;
    this.overlay = this.doc.createElement('div');
    this.overlay.dataset.pageHeatmap = '';
    this.overlay.setAttribute('aria-hidden', 'true');
    // A documentElement child is unaffected by transforms on body. Transforms on
    // the root element itself are outside the viewport-overlay coordinate model.
    const styles = { position: 'fixed', inset: '0', 'z-index': '2147483647', 'pointer-events': 'none', overflow: 'hidden', display: 'block', margin: '0', padding: '0', border: '0', transform: 'none', opacity: '1', contain: 'strict' };
    for (const [name, value] of Object.entries(styles)) this.overlay.style.setProperty(name, value, 'important');
    const canvas = this.doc.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    this.overlay.append(canvas);
    this.mutation = new this.win.MutationObserver(records => {
      if (records.some(affectsPage)) { this.dirtyElements = true; this.schedule(); }
    });
    this.resize = new this.win.ResizeObserver(() => this.schedule());
    this.renderer = (options.renderer ?? (element => new CanvasRenderer(element)))(canvas);
    if (!this.renderer || !['resize', 'draw', 'destroy'].every(method => typeof this.renderer[method as keyof Renderer] === 'function')) {
      throw new TypeError('renderer must implement resize, draw and destroy');
    }
    overlays.add(this.overlay);
    try {
      this.doc.documentElement.append(this.overlay);
      this.connect();
      this.schedule();
    } catch (error) {
      // Preserve the setup error even if a custom renderer's cleanup also fails.
      try { this.destroy(); } catch { /* Cleanup is best effort during construction. */ }
      throw error;
    }
  }

  private onChange = (): void => { this.schedule(); };
  private onSelectorChange = (): void => { this.dirtyElements = true; this.schedule(); };
  private onResolutionChange = (): void => { this.watchResolution(); this.schedule(); };
  private onMouse = (event: MouseEvent): void => {
    const point = [...this.points].reverse().find(p => event.clientX >= p.rect.left && event.clientX < p.rect.right && event.clientY >= p.rect.top && event.clientY < p.rect.bottom) ?? null;
    this.hover?.(point, event);
  };
  private onMouseLeave = (event: MouseEvent): void => { this.hover?.(null, event); };

  private watchResolution(): void {
    this.resolution?.removeEventListener('change', this.onResolutionChange);
    this.resolution = this.win.matchMedia(`(resolution: ${this.win.devicePixelRatio || 1}dppx)`);
    this.resolution.addEventListener('change', this.onResolutionChange);
  }
  private connect(): void {
    if (this.listening) return;
    this.listening = true;
    this.mutation.observe(this.doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    this.resize.observe(this.doc.documentElement);
    this.observed.add(this.doc.documentElement);
    this.doc.addEventListener('scroll', this.onChange, true);
    this.doc.addEventListener('load', this.onChange, true);
    this.doc.addEventListener('transitionend', this.onChange, true);
    this.doc.addEventListener('transitioncancel', this.onChange, true);
    this.doc.addEventListener('animationend', this.onChange, true);
    this.doc.addEventListener('animationcancel', this.onChange, true);
    this.doc.addEventListener('input', this.onSelectorChange, true);
    this.doc.addEventListener('change', this.onSelectorChange, true);
    this.doc.addEventListener('focusin', this.onSelectorChange, true);
    this.doc.addEventListener('focusout', this.onSelectorChange, true);
    this.win.addEventListener('resize', this.onChange);
    this.win.visualViewport?.addEventListener('resize', this.onChange);
    this.win.visualViewport?.addEventListener('scroll', this.onChange);
    this.doc.fonts?.addEventListener('loadingdone', this.onChange);
    if (this.hover) {
      this.doc.addEventListener('mousemove', this.onMouse);
      this.doc.addEventListener('mouseleave', this.onMouseLeave);
    }
    this.watchResolution();
  }
  private disconnect(): void {
    this.mutation.disconnect();
    this.resize.disconnect();
    this.observed.clear();
    this.resolution?.removeEventListener('change', this.onResolutionChange);
    this.resolution = undefined;
    if (!this.listening) return;
    this.listening = false;
    this.doc.removeEventListener('scroll', this.onChange, true);
    this.doc.removeEventListener('load', this.onChange, true);
    this.doc.removeEventListener('transitionend', this.onChange, true);
    this.doc.removeEventListener('transitioncancel', this.onChange, true);
    this.doc.removeEventListener('animationend', this.onChange, true);
    this.doc.removeEventListener('animationcancel', this.onChange, true);
    this.doc.removeEventListener('input', this.onSelectorChange, true);
    this.doc.removeEventListener('change', this.onSelectorChange, true);
    this.doc.removeEventListener('focusin', this.onSelectorChange, true);
    this.doc.removeEventListener('focusout', this.onSelectorChange, true);
    this.win.removeEventListener('resize', this.onChange);
    this.win.visualViewport?.removeEventListener('resize', this.onChange);
    this.win.visualViewport?.removeEventListener('scroll', this.onChange);
    this.doc.fonts?.removeEventListener('loadingdone', this.onChange);
    if (this.hover) {
      this.doc.removeEventListener('mousemove', this.onMouse);
      this.doc.removeEventListener('mouseleave', this.onMouseLeave);
    }
  }
  private schedule(): void {
    if (this.destroyed || this.paused || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => { this.frame = null; this.paint(); });
  }
  private resolveElements(): void {
    this.elements.clear();
    const observed = new Set<Element>([this.doc.documentElement]);
    for (const item of this.data) {
      const element = this.doc.querySelector(item.selector);
      if (!element || isOverlayNode(element)) continue;
      this.elements.set(item.id, element);
      // Ancestor resizes can move a target even when its own size is unchanged.
      for (let current: Element | null = element; current; current = current.parentElement) observed.add(current);
    }
    for (const element of this.observed) if (!observed.has(element)) this.resize.unobserve(element);
    for (const element of observed) if (!this.observed.has(element)) this.resize.observe(element);
    this.observed = observed;
    this.dirtyElements = false;
  }
  private paint(): void {
    if (this.destroyed || this.paused) return;
    if (this.dirtyElements) this.resolveElements();
    const viewport = { width: this.win.innerWidth, height: this.win.innerHeight, dpr: this.win.devicePixelRatio || 1 };
    const sizeChanged = !this.viewport || viewport.width !== this.viewport.width || viewport.height !== this.viewport.height || viewport.dpr !== this.viewport.dpr;
    if (sizeChanged) {
      this.renderer.resize(viewport);
      this.viewport = viewport;
      this.lastPaint = ''; // resize may clear the surface even if its callback pauses.
      if (this.destroyed || this.paused) return;
    }
    const points: HeatPoint[] = [];
    const styles = new Map<Element, CSSStyleDeclaration>();
    const styleFor = (element: Element): CSSStyleDeclaration => {
      let style = styles.get(element);
      if (!style) { style = this.win.getComputedStyle(element); styles.set(element, style); }
      return style;
    };
    const rootStyle = styleFor(this.doc.documentElement);
    const body = this.doc.body;
    const bodyStyle = body ? styleFor(body) : undefined;
    // Propagated overflow clips the viewport, not the scrolling root/body box:
    // https://www.w3.org/TR/css-overflow-3/#overflow-propagation
    const bodyOverflowPropagates = !!bodyStyle && this.doc.documentElement.localName === 'html'
      && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
      && bodyStyle.display !== 'none' && !hasContainment(rootStyle) && !hasContainment(bodyStyle);
    for (const item of this.data) {
      const element = this.elements.get(item.id);
      if (!element?.isConnected || item.value === 0) continue;
      const rect = element.getBoundingClientRect();
      const style = styleFor(element);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') continue;
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(viewport.width, rect.right), bottom = Math.min(viewport.height, rect.bottom);
      let transparent = style.opacity === '0';
      let escape = positionedEscape(style);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const parentStyle = styleFor(ancestor);
        if (parentStyle.opacity === '0' || parentStyle.contentVisibility === 'hidden') { transparent = true; break; }
        // A positioned subtree escapes overflow on ancestors below its containing
        // block. Repeating this at each positioned ancestor follows the CB chain,
        // including ordinary children nested inside fixed/absolute wrappers.
        // https://drafts.csswg.org/css2/#overflow-clipping
        if (escape && establishesContainingBlock(parentStyle, escape, ancestor === this.doc.documentElement)) escape = undefined;
        if (escape) continue;
        escape = positionedEscape(parentStyle);
        const propagated = ancestor === this.doc.documentElement || (ancestor === body && bodyOverflowPropagates);
        const paintClip = hasPaintContainment(parentStyle);
        const clipX = (!propagated && clips.test(parentStyle.overflowX)) || paintClip;
        const clipY = (!propagated && clips.test(parentStyle.overflowY)) || paintClip;
        if (!clipX && !clipY) continue;
        const box = ancestor.getBoundingClientRect();
        // Correct for ordinary axis-aligned scale transforms; arbitrary rotated
        // clipping paths are deliberately not approximated as hit-test coverage.
        const width = ancestor instanceof this.win.HTMLElement ? ancestor.offsetWidth : box.width;
        const height = ancestor instanceof this.win.HTMLElement ? ancestor.offsetHeight : box.height;
        const scaleX = width ? box.width / width : 1, scaleY = height ? box.height / height : 1;
        if (clipX) { left = Math.max(left, box.left + ancestor.clientLeft * scaleX); right = Math.min(right, box.left + (ancestor.clientLeft + ancestor.clientWidth) * scaleX); }
        if (clipY) { top = Math.max(top, box.top + ancestor.clientTop * scaleY); bottom = Math.min(bottom, box.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY); }
      }
      if (transparent || left >= right || top >= bottom) continue;
      const x = (left + right) / 2, y = (top + bottom) / 2;
      if (this.visibility === 'unoccluded') {
        const hit = this.doc.elementFromPoint(x, y);
        if (!hit || !(element === hit || element.contains(hit))) continue;
      }
      points.push({ id: item.id, x, y, value: item.value, normalized: Math.min(1, item.value / this.scale), rect: { left, top, right, bottom } });
    }
    this.points = points;
    const signature = JSON.stringify(points);
    if (sizeChanged || signature !== this.lastPaint) { this.renderer.draw(points); this.lastPaint = signature; }
  }

  /** Atomically replace all data. Values are copied; zero values do not draw. */
  setData(input: readonly HeatDatum[]): void {
    if (this.destroyed) throw new Error('heatmap is destroyed');
    const data = validateData(input, this.doc);
    this.data = data;
    this.scale = scaleFor(data, this.max);
    this.dirtyElements = true;
    this.schedule();
  }
  /** Re-query selectors and positions; call during animations or unobserved layout changes. */
  refresh(): void { this.dirtyElements = true; this.schedule(); }
  /** Freeze the last frame and release observers/listeners until start(). */
  pause(): void {
    if (this.destroyed || this.paused) return;
    this.paused = true;
    if (this.frame !== null) { this.win.cancelAnimationFrame(this.frame); this.frame = null; }
    this.disconnect();
  }
  stop(): void { this.pause(); }
  /** Resume observation and render current data/layout; repeated calls are harmless. */
  start(): void {
    if (this.destroyed || !this.paused) return;
    this.paused = false;
    this.dirtyElements = true;
    try { this.connect(); this.schedule(); } catch (error) {
      this.paused = true;
      this.disconnect();
      throw error;
    }
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) { this.win.cancelAnimationFrame(this.frame); this.frame = null; }
    this.disconnect();
    try { this.renderer.destroy(); } finally {
      this.overlay.remove();
      this.elements.clear();
      this.points = [];
      this.data = [];
    }
  }
}
