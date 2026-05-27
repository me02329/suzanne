import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateRequired } from './dates';

describe('date formatting helpers', () => {
  it('formats dates as ISO calendar days', () => {
    expect(fmtDate(new Date('2026-05-28T18:30:00.000Z'))).toBe('2026-05-28');
    expect(fmtDateRequired(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
  });

  it('returns null for absent optional dates', () => {
    expect(fmtDate(null)).toBeNull();
    expect(fmtDate(undefined)).toBeNull();
  });
});
