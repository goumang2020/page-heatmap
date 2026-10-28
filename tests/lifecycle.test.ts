import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHeatmap } from '../src/index';
import type { HeatmapOptions, HeatPoint, Viewport } from '../src/types';

// These explicit fakes verify ownership and scheduling in Node. They deliberately
// do not emulate browser layout, painting, observer timing, or event propagation.
type Listener = (event: unknown) => void;
type ListenerOptions = boolean | { capture?: boolean };
class EventHub {
  listeners: { type: string; listener: Listener; capture: boolean }[] = [];
  addEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    if (!this.listeners.some(item => item.type === type && item.listener === listener && item.capture === capture)) {
      this.listeners.push({ type, listener, capture });
    }
  }
  removeEventListener(type: string, listener: Listener, options?: ListenerOptions): void {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.listeners = this.listeners.filter(item => item.type !== type || item.listener !== listener || item.capture !== capture);
  }
  emit(type: string, event: unknown = {}): void {
    for (const item of [...this.listeners]) if (item.type === type) item.listener(event);
  }
}
class FakeElement {
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style = { display: '', pointerEvents: '', setProperty: vi.fn() };
  computed = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', contentVisibility: 'visible', position: 'static', transform: 'none', perspective: 'none', translate: 'none', rotate: 'none', scale: 'none', transformStyle: 'flat', filter: 'none', backdropFilter: 'none', contain: 'none', willChange: 'auto' };
  rect = { left: 10, top: 20, right: 50, bottom: 50, width: 40, height: 30 };
  root = false;
  localName = 'div';
  clientHeightOverride?: number;
  clientLeft = 0;
  clientTop = 0;
  get clientWidth(): number { return this.rect.width; }
  get clientHeight(): number { return this.clientHeightOverride ?? this.rect.height; }
  get offsetWidth(): number { return this.rect.width; }
  get offsetHeight(): number { return this.rect.height; }
  get parentElement(): FakeElement | null { return this.parentNode; }
  get isConnected(): boolean { return this.root || !!this.parentNode?.isConnected; }
  getBoundingClientRect = vi.fn(() => ({ ...this.rect }));
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  append(...children: FakeElement[]): void {
    for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); }
  }
  remove(): void {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  contains(node: FakeElement): boolean {
    for (let current: FakeElement | null = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
}
function harness() {
  const documentElement = new FakeElement();
  documentElement.root = true;
  documentElement.localName = 'html';
  const body = new FakeElement();
  body.localName = 'body';
  const point = new FakeElement();
  documentElement.append(body);
  body.append(point);
  const elements = new Map([['#point', point]]);
  const fonts = new EventHub();
  const visualViewport = new EventHub();
  const mediaQueries: EventHub[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const mutations: FakeMutationObserver[] = [];
  const resizes: FakeResizeObserver[] = [];
  class FakeMutationObserver {
    active = false;
    constructor(private callback: (records: MutationRecord[]) => void) { mutations.push(this); }
    observe = vi.fn(() => { this.active = true; });
    disconnect = vi.fn(() => { this.active = false; });
    notify(records: Partial<MutationRecord>[]): void { if (this.active) this.callback(records as MutationRecord[]); }
  }
  class FakeResizeObserver {
    targets = new Set<FakeElement>();
    constructor(private callback: () => void) { resizes.push(this); }
    observe = vi.fn((target: FakeElement) => { this.targets.add(target); });
    unobserve = vi.fn((target: FakeElement) => { this.targets.delete(target); });
    disconnect = vi.fn(() => { this.targets.clear(); });
    notify(): void { if (this.targets.size) this.callback(); }
  }
  const doc = Object.assign(new EventHub(), {
    documentElement, body, fonts,
    createElement: vi.fn(() => new FakeElement()),
    querySelector: vi.fn((selector: string) => {
      if (selector === '[') throw new Error('invalid selector');
      return elements.get(selector) ?? null;
    }),
    elementFromPoint: vi.fn(() => point)
  });
  const win = Object.assign(new EventHub(), {
    document: doc, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    MutationObserver: FakeMutationObserver, ResizeObserver: FakeResizeObserver,
    HTMLElement: FakeElement, visualViewport,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
    getComputedStyle: vi.fn((element: FakeElement) => element.computed),
    matchMedia: vi.fn(() => { const query = new EventHub(); mediaQueries.push(query); return query; })
  });
  const renderer = {
    resize: vi.fn<(viewport: Viewport) => void>(),
    draw: vi.fn<(points: readonly HeatPoint[]) => void>(),
    destroy: vi.fn<() => void>()
  };
  const factory = vi.fn(() => renderer);
  const instances: PageHeatmap[] = [];
  const create = (options: Partial<HeatmapOptions> = {}): PageHeatmap => {
    const instance = new PageHeatmap({ window: win as unknown as Window, renderer: factory, data: [{ id: 'point', selector: '#point', value: 2 }], ...options });
    instances.push(instance);
    return instance;
  };
  const flush = (): void => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); }
  };
  const resources = () => ({
    frames: frames.size,
    listeners: [win, doc, fonts, visualViewport, ...mediaQueries].reduce((sum, target) => sum + target.listeners.length, 0),
    observers: mutations.filter(observer => observer.active).length + resizes.filter(observer => observer.targets.size).length,
    overlays: documentElement.children.filter(element => 'pageHeatmap' in element.dataset).length
  });
  return { win, doc, point, elements, renderer, factory, mutations, resizes, mediaQueries, frames, create, flush, resources, instances };
}
const emptyResources = { frames: 0, listeners: 0, observers: 0, overlays: 0 };
const activeHarnesses: ReturnType<typeof harness>[] = [];
function setup() { const result = harness(); activeHarnesses.push(result); return result; }
afterEach(() => {
  for (const env of activeHarnesses.splice(0)) for (const instance of env.instances) {
    try { instance.destroy(); } catch { /* Exception cleanup is asserted in its own test. */ }
  }
  vi.unstubAllGlobals();
});

describe('lifecycle and scheduling with explicit Node fakes (not browser layout)', () => {
  it('coalesces notifications into one frame and does not run an idle loop', () => {
    const h = setup();
    const heatmap = h.create();
    heatmap.refresh(); heatmap.refresh();
    h.win.emit('resize'); h.doc.emit('scroll'); h.resizes[0]!.notify();
    expect(h.frames.size).toBe(1);
    h.flush();
    expect(h.renderer.resize).toHaveBeenCalledTimes(1);
    expect(h.renderer.draw).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
    h.flush(); h.flush();
    expect(h.win.requestAnimationFrame).toHaveBeenCalledTimes(1);
    h.win.emit('resize'); h.flush();
    expect(h.renderer.draw).toHaveBeenCalledTimes(1); // No output change means no repaint.
    expect(h.frames.size).toBe(0);
  });

  it('pause cancels pending work, disconnects resources, and start resumes once', () => {
    const h = setup();
    const hover = vi.fn();
    const heatmap = h.create({ onHover: hover });
    heatmap.pause(); heatmap.pause();
    expect(h.resources()).toEqual({ ...emptyResources, overlays: 1 });
    h.doc.emit('mousemove', { clientX: 20, clientY: 30 });
    h.win.emit('resize'); h.mutations[0]!.notify([{ type: 'attributes', target: h.point as unknown as Node }]);
    heatmap.setData([{ id: 'new', selector: '#point', value: 10 }]);
    heatmap.refresh(); h.flush();
    expect(hover).not.toHaveBeenCalled();
    expect(h.renderer.draw).not.toHaveBeenCalled();
    heatmap.start(); const listeners = h.resources().listeners; heatmap.start();
    expect(h.resources()).toMatchObject({ frames: 1, observers: 2, listeners });
    h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]?.id).toBe('new');
    heatmap.stop();
    expect(h.resources()).toEqual({ ...emptyResources, overlays: 1 });
  });

  it('destroy is idempotent and prevents later events or public methods from rescheduling', () => {
    const h = setup();
    const heatmap = h.create();
    heatmap.destroy(); heatmap.destroy();
    expect(h.resources()).toEqual(emptyResources);
    expect(h.renderer.destroy).toHaveBeenCalledTimes(1);
    heatmap.refresh(); heatmap.start(); heatmap.stop(); heatmap.pause();
    h.win.emit('resize'); h.doc.emit('scroll'); h.flush();
    expect(h.resources()).toEqual(emptyResources);
    expect(h.renderer.draw).not.toHaveBeenCalled();
    expect(() => heatmap.setData([])).toThrow('destroyed');
  });

  it('copies input and keeps data and scale unchanged after a failed setData', () => {
    const h = setup();
    const data = [{ id: 'point', selector: '#point', value: 2 }, { id: 'missing', selector: '#missing', value: 10 }];
    const heatmap = h.create({ data });
    data[0]!.value = 99;
    h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]).toMatchObject({ value: 2, normalized: 0.2 });
    expect(() => heatmap.setData([{ id: 'bad', selector: '#point', value: -1 }])).toThrow('value');
    expect(h.frames.size).toBe(0);
    h.point.rect.left = 20;
    heatmap.refresh(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]).toMatchObject({ id: 'point', value: 2, normalized: 0.2 });
    heatmap.setData([{ id: 'updated', selector: '#point', value: 5 }]); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]).toMatchObject({ id: 'updated', normalized: 1 });
  });

  it('refresh re-resolves a replacement and drops stale resize-observer targets', () => {
    const h = setup();
    const heatmap = h.create(); h.flush();
    const replacement = new FakeElement();
    replacement.rect = { left: 100, top: 20, right: 140, bottom: 50, width: 40, height: 30 };
    h.point.remove(); h.doc.body.append(replacement); h.elements.set('#point', replacement);
    heatmap.refresh(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]?.x).toBe(120);
    expect(h.resizes[0]!.targets.has(h.point)).toBe(false);
    expect(h.resizes[0]!.targets.has(replacement)).toBe(true);
  });

  it('uses the supplied window observer constructors instead of ambient globals', () => {
    const ambient = vi.fn(() => { throw new Error('wrong realm'); });
    vi.stubGlobal('MutationObserver', ambient); vi.stubGlobal('ResizeObserver', ambient);
    const first = setup(), second = setup();
    first.create(); second.create(); first.flush(); second.flush();
    expect(first.mutations).toHaveLength(1); expect(second.mutations).toHaveLength(1);
    expect(first.resizes).toHaveLength(1); expect(second.resizes).toHaveLength(1);
    expect(first.win.MutationObserver).not.toBe(second.win.MutationObserver);
    expect(ambient).not.toHaveBeenCalled();
  });

  it('ignores every instance overlay mutation, including overlay-only child-list records', () => {
    const h = setup();
    const first = h.create(), second = h.create(); h.flush();
    const secondOverlay = h.doc.documentElement.children.at(-1)!;
    for (const observer of h.mutations) observer.notify([
      { type: 'attributes', target: secondOverlay.children[0] as unknown as Node },
      { type: 'childList', target: h.doc.documentElement as unknown as Node, addedNodes: [secondOverlay] as unknown as NodeList, removedNodes: [] as unknown as NodeList }
    ]);
    expect(h.frames.size).toBe(0);
    first.destroy();
    expect(h.resources()).toMatchObject({ observers: 2, overlays: 1 });
    h.win.emit('resize'); expect(h.frames.size).toBe(1); h.flush();
    second.destroy(); expect(h.resources()).toEqual(emptyResources);
  });

  it('schedules a real page mutation and refreshes data matches', () => {
    const h = setup();
    h.create(); h.flush();
    h.elements.delete('#point');
    h.mutations[0]!.notify([{ type: 'attributes', target: h.point as unknown as Node }]);
    expect(h.frames.size).toBe(1); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
  });

  it('clears while the document body is absent and resumes after reinsertion', () => {
    const h = setup();
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toHaveLength(1);
    const body = h.doc.body;
    body.remove();
    Object.defineProperty(h.doc, 'body', { value: null, configurable: true });
    h.mutations[0]!.notify([{ type: 'childList', target: h.doc.documentElement as unknown as Node, addedNodes: [] as unknown as NodeList, removedNodes: [body] as unknown as NodeList }]);
    expect(h.flush).not.toThrow();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
    h.doc.documentElement.append(body);
    Object.defineProperty(h.doc, 'body', { value: body, configurable: true });
    h.mutations[0]!.notify([{ type: 'childList', target: h.doc.documentElement as unknown as Node, addedNodes: [body] as unknown as NodeList, removedNodes: [] as unknown as NodeList }]);
    h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toHaveLength(1);
  });

  it('moves the DPR media-query listener and removes it on destroy', () => {
    const h = setup();
    const heatmap = h.create(); h.flush();
    const oldQuery = h.mediaQueries[0]!;
    h.win.devicePixelRatio = 2; oldQuery.emit('change');
    expect(oldQuery.listeners).toHaveLength(0);
    expect(h.mediaQueries.at(-1)!.listeners).toHaveLength(1);
    h.flush(); expect(h.renderer.resize.mock.lastCall?.[0].dpr).toBe(2);
    heatmap.destroy(); expect(h.resources()).toEqual(emptyResources);
  });

  it('cleans all resources even when renderer destruction throws', () => {
    const h = setup();
    const heatmap = h.create(); h.flush(); heatmap.refresh();
    h.renderer.destroy.mockImplementation(() => { throw new Error('renderer cleanup'); });
    expect(() => heatmap.destroy()).toThrow('renderer cleanup');
    expect(h.resources()).toEqual(emptyResources);
    expect(() => heatmap.destroy()).not.toThrow();
    expect(h.renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('rolls back partial construction and preserves the original setup error', () => {
    const h = setup();
    h.win.matchMedia.mockImplementation(() => { throw new Error('setup failed'); });
    h.renderer.destroy.mockImplementation(() => { throw new Error('cleanup failed'); });
    expect(() => h.create()).toThrow('setup failed');
    expect(h.resources()).toEqual(emptyResources);
    expect(h.renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input before creating renderers or observers', () => {
    const h = setup();
    expect(() => h.create({ data: [{ id: 'bad', selector: '[', value: 1 }] })).toThrow('selector');
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.mutations).toHaveLength(0); expect(h.resizes).toHaveLength(0);
    expect(h.resources()).toEqual(emptyResources);
  });

  it('does not draw after a custom resize callback destroys the instance', () => {
    const h = setup();
    const heatmap = h.create();
    h.renderer.resize.mockImplementation(() => heatmap.destroy()); h.flush();
    expect(h.renderer.draw).not.toHaveBeenCalled();
    expect(h.resources()).toEqual(emptyResources);
  });

  it('allows refresh to retry a failed resize or draw instead of caching a failed frame', () => {
    const h = setup();
    const heatmap = h.create();
    h.renderer.resize.mockImplementationOnce(() => { throw new Error('resize failed'); });
    expect(h.flush).toThrow('resize failed');
    expect(h.frames.size).toBe(0);
    h.renderer.draw.mockImplementationOnce(() => { throw new Error('draw failed'); });
    heatmap.refresh(); expect(h.flush).toThrow('draw failed');
    expect(h.renderer.resize).toHaveBeenCalledTimes(2);
    heatmap.refresh(); h.flush();
    expect(h.renderer.draw).toHaveBeenCalledTimes(2);
    expect(h.frames.size).toBe(0);
  });

  it('rolls back a failed restart and permits a later successful retry', () => {
    const h = setup();
    const heatmap = h.create(); h.flush(); heatmap.pause();
    h.win.matchMedia.mockImplementationOnce(() => { throw new Error('restart failed'); });
    expect(() => heatmap.start()).toThrow('restart failed');
    expect(h.resources()).toEqual({ ...emptyResources, overlays: 1 });
    heatmap.start(); h.flush();
    expect(h.resources()).toMatchObject({ observers: 2, overlays: 1, frames: 0 });
  });

  it('repaints after resize pauses, even if point geometry has not changed', () => {
    const h = setup();
    const heatmap = h.create(); h.flush();
    h.renderer.resize.mockImplementationOnce(() => heatmap.pause());
    h.win.devicePixelRatio = 2; h.win.emit('resize'); h.flush();
    expect(h.renderer.draw).toHaveBeenCalledTimes(1);
    heatmap.start(); h.flush();
    expect(h.renderer.draw).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid renderer without attaching overlays or observers', () => {
    const h = setup();
    expect(() => h.create({ renderer: (() => ({})) as unknown as HeatmapOptions['renderer'] })).toThrow('renderer');
    expect(h.resources()).toEqual(emptyResources);
  });

  it('delivers the last matching point and a leave notification while active only', () => {
    const h = setup();
    const hover = vi.fn();
    const heatmap = h.create({ onHover: hover, data: [{ id: 'first', selector: '#point', value: 1 }, { id: 'last', selector: '#point', value: 2 }] });
    h.flush(); h.doc.emit('mousemove', { clientX: 20, clientY: 30 });
    expect(hover.mock.lastCall?.[0].id).toBe('last');
    h.doc.emit('mouseleave'); expect(hover.mock.lastCall?.[0]).toBeNull();
    heatmap.pause(); const count = hover.mock.calls.length;
    h.doc.emit('mousemove', { clientX: 20, clientY: 30 });
    expect(hover).toHaveBeenCalledTimes(count);
  });
});


describe('clipping decisions with supplied mock geometry (not browser layout)', () => {
  function wrappedPoint(h: ReturnType<typeof harness>, position = 'static') {
    const wrapper = new FakeElement();
    wrapper.rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
    wrapper.computed.overflowX = 'hidden'; wrapper.computed.overflowY = 'hidden';
    h.doc.body.append(wrapper); wrapper.append(h.point); h.point.computed.position = position;
    h.point.rect = { left: 100, top: 100, right: 150, bottom: 120, width: 50, height: 20 };
    return wrapper;
  }

  it.each(['fixed', 'absolute'])('does not clip %s descendants against an intermediate static overflow ancestor', position => {
    const h = setup(); wrappedPoint(h, position);
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]).toMatchObject({ x: 125, y: 110 });
  });

  it('also follows an escaped positioned wrapper for a normal-flow descendant', () => {
    const h = setup(); const clipper = wrappedPoint(h);
    const fixed = new FakeElement(); fixed.computed.position = 'fixed';
    clipper.append(fixed); fixed.append(h.point);
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toHaveLength(1);
  });

  it.each([
    ['transform', 'matrix(1, 0, 0, 1, 0, 0)'], ['filter', 'blur(0px)'],
    ['perspective', '100px'], ['translate', '0px'], ['contain', 'layout'],
    ['contain', 'paint'], ['willChange', 'transform'], ['contentVisibility', 'auto']
  ])('clips fixed descendants when %s: %s establishes the containing block', (property, value) => {
    const h = setup(); const wrapper = wrappedPoint(h, 'fixed');
    Object.assign(wrapper.computed, { [property]: value });
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
  });

  it('clips absolute descendants at their positioned containing block, but not a fixed descendant', () => {
    const h = setup(); const wrapper = wrappedPoint(h, 'absolute'); wrapper.computed.position = 'relative';
    const heatmap = h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
    h.point.computed.position = 'fixed'; heatmap.refresh(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toHaveLength(1);
  });

  it('retains clipping beyond the containing block while skipping intermediate clippers', () => {
    const h = setup(); const intermediate = wrappedPoint(h, 'absolute');
    const containingBlock = new FakeElement(); containingBlock.computed.position = 'relative';
    const outer = new FakeElement(); outer.computed.overflowX = 'hidden'; outer.computed.overflowY = 'hidden';
    outer.rect = { left: 0, top: 0, right: 110, bottom: 110, width: 110, height: 110 };
    h.doc.body.append(outer); outer.append(containingBlock); containingBlock.append(intermediate);
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]).toMatchObject({ x: 105, y: 105 });
  });

  it.each([500, 800])('does not combine scrolled root rect with root viewport clientHeight (scroll=%s)', scroll => {
    const h = setup();
    h.doc.documentElement.computed.overflowY = 'scroll';
    h.doc.documentElement.rect = { left: 0, top: -scroll, right: 800, bottom: 2200 - scroll, width: 800, height: 2200 };
    h.doc.documentElement.clientHeightOverride = 600;
    h.point.rect = { left: 20, top: 200, right: 60, bottom: 230, width: 40, height: 30 };
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]?.y).toBe(215);
  });

  it('does not clip against body overflow propagated to the viewport', () => {
    const h = setup();
    h.doc.body.computed.overflowY = 'scroll';
    h.doc.body.rect = { left: 0, top: -500, right: 800, bottom: -400, width: 800, height: 100 };
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toHaveLength(1);
  });

  it.each(['html', 'body'])('does not propagate body overflow when %s has containment', target => {
    const h = setup();
    h.doc.body.computed.overflowY = 'hidden';
    h.doc.body.rect = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
    (target === 'html' ? h.doc.documentElement : h.doc.body).computed.contain = 'style';
    h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
  });

  it('clips normal flow to the visible ancestor intersection and rejects transparent ancestors', () => {
    const h = setup(); const wrapper = wrappedPoint(h);
    wrapper.rect = { left: 110, top: 105, right: 140, bottom: 115, width: 30, height: 10 };
    const heatmap = h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0][0]).toMatchObject({ x: 125, y: 110, rect: { left: 110, top: 105, right: 140, bottom: 115 } });
    wrapper.computed.opacity = '0'; heatmap.refresh(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
  });

  it('checks transparency even on ancestors skipped by fixed positioning', () => {
    const h = setup(); const wrapper = wrappedPoint(h, 'fixed'); wrapper.computed.opacity = '0';
    h.create(); h.flush(); expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
  });

  it('unoccluded uses the supplied center hit-test, whereas viewport does not', () => {
    const h = setup(); h.doc.elementFromPoint.mockReturnValue(new FakeElement());
    const first = h.create({ visibility: 'unoccluded' }); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toEqual([]);
    first.destroy(); h.create(); h.flush();
    expect(h.renderer.draw.mock.lastCall?.[0]).toHaveLength(1);
  });
});
