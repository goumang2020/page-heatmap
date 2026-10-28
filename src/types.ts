export interface HeatDatum { id: string; selector: string; value: number }
export interface HeatPoint { id: string; x: number; y: number; value: number; normalized: number; rect: { left: number; top: number; right: number; bottom: number } }
export interface Viewport { width: number; height: number; dpr: number }
/** Coordinates and dimensions are CSS pixels relative to the target viewport. */
export interface Renderer { resize(viewport: Viewport): void; draw(points: readonly HeatPoint[]): void; destroy(): void }
export type RendererFactory = (canvas: HTMLCanvasElement) => Renderer;
export interface HeatmapOptions {
  window?: Window;
  data?: readonly HeatDatum[];
  /** Fixed positive scale. If omitted, maximum is calculated on each setData and remains fixed between updates. */
  max?: number;
  /** Default: viewport. `unoccluded` checks the center of the visible intersection using elementFromPoint. */
  visibility?: 'viewport' | 'unoccluded';
  renderer?: RendererFactory;
  onHover?: (point: HeatPoint | null, event: MouseEvent) => void;
}
