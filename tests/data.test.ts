import { describe, expect, it } from 'vitest';
import { scaleFor, validateData, validateMax } from '../src/data';
import type { HeatDatum } from '../src/types';

const doc = {
  querySelector(selector: string) {
    if (selector === '[') throw new Error('invalid selector');
    return null;
  }
} as unknown as Document;
const datum = (value = 1): HeatDatum => ({ id: '0', selector: '#point', value });
const input = (value: unknown): readonly HeatDatum[] => value as readonly HeatDatum[];

describe('data validation', () => {
  it('copies frozen input, preserves zero and id "0", and strips unrelated fields', () => {
    const item = Object.freeze({ ...datum(0), unrelated: true });
    const original = Object.freeze([item]);
    const result = validateData(original, doc);
    expect(result).toEqual([datum(0)]);
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(item);
  });

  it('accepts empty input and selectors that do not currently match', () => {
    expect(validateData([], doc)).toEqual([]);
    expect(validateData([datum()], doc)).toEqual([datum()]);
  });

  it.each([null, undefined, {}, 'data', 1])('rejects a non-array: %s', value => {
    expect(() => validateData(input(value), doc)).toThrow('array');
  });

  it.each([null, undefined, {}, { ...datum(), id: '' }, { ...datum(), id: ' ' }, { ...datum(), id: 0 }])(
    'rejects a missing or invalid item identity: %s', item => {
      expect(() => validateData(input([item]), doc)).toThrow();
    }
  );

  it('rejects sparse input rather than letting holes reach layout', () => {
    expect(() => validateData(new Array<HeatDatum>(2), doc)).toThrow();
  });

  it('rejects duplicate identities, not repeated selectors', () => {
    expect(() => validateData([datum(), { ...datum(), selector: '#other' }], doc)).toThrow('duplicate');
    expect(validateData([datum(), { ...datum(), id: 'other' }], doc)).toHaveLength(2);
  });

  it.each(['', ' ', '[', null, 10])('rejects an invalid selector: %s', selector => {
    expect(() => validateData(input([{ ...datum(), selector }]), doc)).toThrow('selector');
  });

  it.each([-1, Infinity, -Infinity, NaN, undefined, null, '1'])('rejects an invalid value: %s', value => {
    expect(() => validateData(input([{ ...datum(), value }]), doc)).toThrow('value');
  });

  it('accepts finite non-negative values without coercion or mutation', () => {
    for (const value of [0, -0, Number.MIN_VALUE, 0.25, Number.MAX_VALUE]) {
      expect(validateData([datum(value)], doc)[0]?.value).toBe(value);
    }
  });
});

describe('stable scale', () => {
  it('uses a positive fallback for empty and all-zero datasets', () => {
    expect(scaleFor([])).toBe(1);
    expect(scaleFor([datum(0)])).toBe(1);
  });

  it('uses the full data maximum, including unmatched selectors', () => {
    expect(scaleFor([datum(0.2), { id: 'missing', selector: '#missing', value: 10 }])).toBe(10);
    expect(scaleFor([datum(0.2)])).toBe(0.2);
    expect(scaleFor([datum(Number.MAX_VALUE)])).toBe(Number.MAX_VALUE);
  });

  it('preserves an explicit positive scale independently of the data', () => {
    expect(scaleFor([], 10)).toBe(10);
    expect(scaleFor([datum(100)], 10)).toBe(10);
    expect(validateMax(undefined)).toBeUndefined();
    expect(validateMax(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
    expect(validateMax(0.5)).toBe(0.5);
  });

  it.each([0, -0, -1, Infinity, -Infinity, NaN, null, '10'])('rejects an invalid max: %s', value => {
    expect(() => validateMax(value as number)).toThrow('max');
  });
});
