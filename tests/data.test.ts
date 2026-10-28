import { describe, expect, it } from 'vitest';
import { scaleFor, validateData, validateMax } from '../src/data';
const doc = { querySelector(selector: string) { if (selector === '[') throw new Error('invalid'); return null; } } as unknown as Document;
describe('heatmap input', () => {
  it('copies data and supports zero values and id "0"', () => {
    const original = [{ id: '0', selector: '#zero', value: 0 }];
    const result = validateData(original, doc);
    expect(result).toEqual(original); expect(result[0]).not.toBe(original[0]); expect(scaleFor(result)).toBe(1);
  });
  it('rejects duplicates, bad selectors and invalid values before use', () => {
    expect(() => validateData([{ id: 'a', selector: '#x', value: 1 }, { id: 'a', selector: '#y', value: 2 }], doc)).toThrow('duplicate');
    expect(() => validateData([{ id: 'a', selector: '[', value: 1 }], doc)).toThrow('selector');
    for (const value of [-1, Infinity, NaN]) expect(() => validateData([{ id: 'a', selector: '#x', value }], doc)).toThrow('value');
  });
  it('keeps a fixed positive max and handles fractional and empty data', () => {
    expect(scaleFor([{ id: 'a', selector: '#x', value: .2 }])).toBe(.2);
    expect(scaleFor([], 10)).toBe(10);
    expect(() => validateMax(0)).toThrow();
    expect(() => validateMax(Infinity)).toThrow();
  });
});
