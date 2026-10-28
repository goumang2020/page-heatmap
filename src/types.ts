/** Stable identity plus a CSS selector matching the first element in the target document. */
export interface HeatDatum { readonly id: string; readonly selector: string; readonly value: number }
/** CSS-pixel coordinates relative to the target layout viewport, not page coordinates. */
export interface HeatPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly value: number;
  /** Value / scale, clamped to [0, 1]. Scale never depends on which points are visible. */
  readonly normalized: number;
  readonly rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
}
export interface Viewport { readonly width: number; readonly height: number; readonly dpr: number }
/** Resize owns CSS-to-backing-pixel scaling; draw receives CSS pixels. Do not mutate points. */
export interface Renderer {
  resize(viewport: Viewport): void;
  draw(points: readonly HeatPoint[]): void;
  destroy(): void;
}
export type RendererFactory = (canvas: HTMLCanvasElement) => Renderer;
export interface HeatmapOptions {
  /** Target same-origin window. Defaults to the current window; construction needs document.body. */
  window?: Window;
  data?: readonly HeatDatum[];
  /** Fixed positive scale. Otherwise recomputed on setData, never on scroll or DOM changes. */
  max?: number;
  /** Both modes clip to viewport/overflow ancestors. `unoccluded` also hit-tests the visible center. */
  visibility?: 'viewport' | 'unoccluded';
  renderer?: RendererFactory;
  /** Last matching data item wins overlapping rectangles; not a DOM stacking-order hit-test. */
  onHover?: (point: HeatPoint | null, event: MouseEvent) => void;
}
