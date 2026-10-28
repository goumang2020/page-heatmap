import type { HeatDatum } from './types.js';
export function validateData(input: readonly HeatDatum[], doc: Document): HeatDatum[] {
  if (!Array.isArray(input)) throw new TypeError('data must be an array');
  const ids = new Set<string>();
  return Array.from(input, item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) throw new TypeError('each item needs a non-empty id');
    if (ids.has(item.id)) throw new TypeError(`duplicate id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.selector !== 'string' || !item.selector.trim()) throw new TypeError(`invalid selector for ${item.id}`);
    try { doc.querySelector(item.selector); } catch { throw new TypeError(`invalid selector for ${item.id}`); }
    if (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0) throw new TypeError(`value for ${item.id} must be finite and non-negative`);
    return { id: item.id, selector: item.selector, value: item.value };
  });
}
export function validateMax(max: number | undefined): number | undefined {
  if (max !== undefined && (!Number.isFinite(max) || max <= 0)) throw new TypeError('max must be finite and greater than zero');
  return max;
}
export function scaleFor(data: readonly HeatDatum[], fixedMax?: number): number {
  return fixedMax ?? (data.reduce((max, item) => Math.max(max, item.value), 0) || 1);
}
