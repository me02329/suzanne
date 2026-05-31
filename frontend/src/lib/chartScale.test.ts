import { describe, expect, it } from 'vitest';
import { fitDomain, symlog, symlogConstant, symlogInverse, toBase100, toSymlog } from './chartScale';

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

  it('leaves a gap (null) before the first real value, then indexes from it', () => {
    // The leading 0 (account not yet existing) becomes null so the line starts
    // at 100 instead of spiking up from 0.
    expect(toBase100([
      { label: 'A', value: 0 },
      { label: 'B', value: 50 },
      { label: 'C', value: 75 },
    ], ['value']).map((row) => row.value)).toEqual([null, 100, 150]);
  });

  it('keeps a genuine zero that occurs after the series has started', () => {
    // A drop back to 0 mid-history is real (-100%), not a leading gap.
    expect(toBase100([
      { label: 'A', value: 50 },
      { label: 'B', value: 0 },
      { label: 'C', value: 25 },
    ], ['value']).map((row) => row.value)).toEqual([100, 0, 50]);
  });
});

describe('symlog', () => {
  it('keeps zero and supports both positive and negative values', () => {
    expect(symlog(0, 100)).toBe(0);
    expect(symlog(900, 100)).toBe(1);
    expect(symlog(-900, 100)).toBe(-1);
  });

  it('can be inverted back to the original magnitude', () => {
    expect(symlogInverse(symlog(1234, 100), 100)).toBeCloseTo(1234);
    expect(symlogInverse(symlog(-250, 100), 100)).toBeCloseTo(-250);
  });

  it('derives a stable transition constant from typical values', () => {
    expect(symlogConstant([0, 100, 1000, 10_000])).toBe(100);
  });
});

describe('toSymlog', () => {
  it('transforms selected series and keeps raw values for tooltips', () => {
    expect(toSymlog([{ label: 'A', value: -900 }, { label: 'B', value: 0 }, { label: 'C', value: 900 }], ['value'], 100))
      .toEqual([
        { label: 'A', value: -1, value__raw: -900 },
        { label: 'B', value: 0, value__raw: 0 },
        { label: 'C', value: 1, value__raw: 900 },
      ]);
  });
});
