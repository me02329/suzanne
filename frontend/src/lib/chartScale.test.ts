import { describe, expect, it } from 'vitest';
import { canUseLogScale, fitDomain, fitPositiveLogDomain, toBase100 } from './chartScale';

describe('fitDomain', () => {
  it('fits a band sitting well above zero (zoomed in, not flattened to 0)', () => {
    // range 10, pad 12% = 1.2 → [98.8, 111.2], never touching 0
    expect(fitDomain([100, 101, 110])).toEqual([98.8, 111.2]);
  });

  it('keeps a small 5% air below zero when a positive series reaches 0', () => {
    // range 110, would pad to -13.2 below; clamp to -5% of range = -5.5
    expect(fitDomain([0, 50, 110])).toEqual([-5.5, 123.2]);
  });

  it('pads normally when the series genuinely crosses zero', () => {
    // min is negative, so the one-sided guard does not apply
    expect(fitDomain([-50, 0, 110])).toEqual([-69.2, 129.2]);
  });

  it('fits a negative-only series tightly with air above', () => {
    expect(fitDomain([-1100, -1050, -1000])).toEqual([-1112, -988]);
  });

  it('pads a flat series by 10% of its value', () => {
    expect(fitDomain([100, 100])).toEqual([90, 110]);
  });

  it('falls back gracefully on empty input', () => {
    expect(fitDomain([])).toEqual([0, 1]);
  });
});

describe('canUseLogScale', () => {
  it('accepts only strictly positive finite values', () => {
    expect(canUseLogScale([1, 10, 100])).toBe(true);
    expect(canUseLogScale([1, 0, 100])).toBe(false);
    expect(canUseLogScale([1, -10, 100])).toBe(false);
  });
});

describe('fitPositiveLogDomain', () => {
  it('pads a positive log range without crossing zero', () => {
    expect(fitPositiveLogDomain([100, 1000])).toEqual([86.96, 1150]);
  });
});

describe('toBase100', () => {
  it('normalizes each series from its first non-zero value', () => {
    expect(toBase100([
      { label: 'A', big: 1000, small: 10 },
      { label: 'B', big: 1100, small: 15 },
    ], ['big', 'small'])).toEqual([
      { label: 'A', big: 100, small: 100, big__raw: 1000, small__raw: 10 },
      { label: 'B', big: 110, small: 150, big__raw: 1100, small__raw: 15 },
    ]);
  });

  it('skips leading zeroes until a real base exists', () => {
    expect(toBase100([
      { label: 'A', value: 0 },
      { label: 'B', value: 50 },
      { label: 'C', value: 75 },
    ], ['value']).map((row) => row.value)).toEqual([0, 100, 150]);
  });
});
