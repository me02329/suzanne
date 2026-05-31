import { describe, expect, it } from 'vitest';
import { fitDomain } from './chartScale';

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
