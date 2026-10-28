import { beforeEach, describe, expect, it, vi } from 'vitest';
import SimpleHeat from 'simpleheat';
import { CanvasRenderer } from '../src/renderer';
import type { CanvasRendererOptions } from '../src/renderer';
import type { HeatPoint, Viewport } from '../src/types';

const heat = vi.hoisted(() => ({ radius: vi.fn(), data: vi.fn(), max: vi.fn(), draw: vi.fn(), clear: vi.fn() }));
vi.mock('simpleheat', () => ({ default: vi.fn(function () { return heat; }) }));

function canvasFixture() {
  const context = { clearRect: vi.fn() };
  const properties = new Map<string, string>();
  const canvas = {
    width: 300,
    height: 150,
    style: { setProperty: vi.fn((name: string, value: string) => properties.set(name, value)) },
    getContext: vi.fn(() => context)
  };
  return { canvas, context, properties, element: canvas as unknown as HTMLCanvasElement };
}

function point(normalized: number, x = 20, y = 30): HeatPoint {
  return Object.freeze({ id: 'point', x, y, value: normalized, normalized, rect: Object.freeze({ left: 0, top: 0, right: 40, bottom: 60 }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of Object.values(heat)) method.mockReturnValue(heat);
});

describe('CanvasRenderer adapter (mocked simpleheat, no browser pixel claims)', () => {
  it('acquires a 2D context and passes the supplied canvas to simpleheat', () => {
    const fixture = canvasFixture();
    new CanvasRenderer(fixture.element);
    expect(fixture.canvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(SimpleHeat).toHaveBeenCalledWith(fixture.element);
  });

  it('fails clearly when Canvas 2D is unavailable', () => {
    const fixture = canvasFixture();
    fixture.canvas.getContext.mockReturnValue(null as unknown as typeof fixture.context);
    expect(() => new CanvasRenderer(fixture.element)).toThrow('Canvas 2D');
    expect(SimpleHeat).not.toHaveBeenCalled();
  });

  it.each([
    { radius: 0 }, { radius: -1 }, { radius: Infinity }, { radius: NaN },
    { blur: -1 }, { blur: Infinity }, { blur: NaN },
    { minOpacity: -0.1 }, { minOpacity: 1.1 }, { minOpacity: Infinity }, { minOpacity: NaN }
  ])('rejects invalid renderer options before acquiring a context: %s', options => {
    const fixture = canvasFixture();
    expect(() => new CanvasRenderer(fixture.element, options as CanvasRendererOptions)).toThrow(TypeError);
    expect(fixture.canvas.getContext).not.toHaveBeenCalled();
  });

  it('keeps CSS dimensions distinct from rounded backing dimensions', () => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element);
    const viewport = { width: 800, height: 600, dpr: 2 };
    renderer.resize(viewport);
    expect(fixture.canvas.width).toBe(1600);
    expect(fixture.canvas.height).toBe(1200);
    expect(fixture.canvas.style.setProperty).toHaveBeenCalledWith('width', '800px', 'important');
    expect(fixture.canvas.style.setProperty).toHaveBeenCalledWith('height', '600px', 'important');
    expect(heat.radius).toHaveBeenCalledWith(56, 60);
    viewport.dpr = 1;
    renderer.draw([point(0.5)]);
    expect(heat.data).toHaveBeenCalledWith([[40, 60, 0.5]]);
    renderer.resize({ width: 10.25, height: 5.75, dpr: 1.5 });
    expect(fixture.canvas.width).toBe(15);
    expect(fixture.canvas.height).toBe(9);
    expect(fixture.properties.get('width')).toBe('10.25px');
    expect(heat.radius).toHaveBeenLastCalledWith(42, 45);
  });

  it('uses at least one backing pixel for zero dimensions', () => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element);
    renderer.resize({ width: 0, height: 0, dpr: 2 });
    expect(fixture.canvas.width).toBe(1);
    expect(fixture.canvas.height).toBe(1);
    expect(fixture.properties.get('width')).toBe('0px');
  });

  it('only rebuilds the radius kernel when DPR changes', () => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element, { radius: 10, blur: 0, minOpacity: 1 });
    renderer.resize({ width: 800, height: 600, dpr: 2 });
    renderer.resize({ width: 1200, height: 900, dpr: 2 });
    expect(heat.radius).toHaveBeenCalledTimes(1);
    expect(heat.radius).toHaveBeenLastCalledWith(20, 0);
    renderer.resize({ width: 1200, height: 900, dpr: 1 });
    expect(heat.radius).toHaveBeenCalledTimes(2);
    expect(heat.radius).toHaveBeenLastCalledWith(10, 0);
    renderer.draw([point(0.5)]);
    expect(heat.draw).toHaveBeenLastCalledWith(1);
  });

  it.each([
    { width: -1, height: 10, dpr: 1 }, { width: 10, height: -1, dpr: 1 },
    { width: Infinity, height: 10, dpr: 1 }, { width: 10, height: NaN, dpr: 1 },
    { width: 10, height: 10, dpr: 0 }, { width: 10, height: 10, dpr: -1 },
    { width: 10, height: 10, dpr: Infinity }, { width: 10, height: 10, dpr: NaN }
  ])('rejects invalid viewport sizes without changing canvas dimensions: %s', viewport => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element);
    expect(() => renderer.resize(viewport as Viewport)).toThrow('viewport');
    expect(fixture.canvas.width).toBe(300);
    expect(fixture.canvas.height).toBe(150);
    expect(heat.radius).not.toHaveBeenCalled();
  });

  it('converts CSS coordinates to backing pixels without mutating points', () => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element, { minOpacity: 0.2 });
    renderer.resize({ width: 800, height: 600, dpr: 2 });
    const points = Object.freeze([point(0), point(0.5, 20.5, 30.25), point(1, 0, 0)]);
    renderer.draw(points);
    expect(heat.data).toHaveBeenCalledWith([[41, 60.5, 0.5], [0, 0, 1]]);
    expect(heat.max).toHaveBeenCalledWith(1);
    expect(heat.draw).toHaveBeenCalledWith(0.2);
    expect(fixture.context.clearRect).not.toHaveBeenCalled();
  });

  it('clears empty and all-zero frames without calling colorization', () => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element);
    renderer.resize({ width: 800, height: 600, dpr: 2 });
    renderer.draw([]);
    renderer.draw([point(0)]);
    expect(heat.clear).toHaveBeenCalledTimes(2);
    expect(fixture.context.clearRect).toHaveBeenNthCalledWith(1, 0, 0, 1600, 1200);
    expect(fixture.context.clearRect).toHaveBeenNthCalledWith(2, 0, 0, 1600, 1200);
    expect(heat.data).not.toHaveBeenCalled();
    expect(heat.draw).not.toHaveBeenCalled();
  });

  it('releases the backing canvas once and ignores calls after destroy', () => {
    const fixture = canvasFixture();
    const renderer = new CanvasRenderer(fixture.element);
    renderer.resize({ width: 800, height: 600, dpr: 2 });
    renderer.destroy(); renderer.destroy();
    expect(heat.clear).toHaveBeenCalledTimes(1);
    expect(fixture.canvas.width).toBe(1);
    expect(fixture.canvas.height).toBe(1);
    renderer.draw([point(1)]);
    renderer.resize({ width: 800, height: 600, dpr: 2 });
    expect(fixture.canvas.width).toBe(1);
    expect(heat.data).not.toHaveBeenCalled();
    expect(heat.radius).toHaveBeenCalledTimes(1);
  });
});
