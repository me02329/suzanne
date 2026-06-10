import { describe, expect, it } from 'vitest';
import { dueDatesFor } from './recurring.js';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const keys = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));

describe('dueDatesFor — yearly', () => {
  it('anchors on month_of_year instead of the activation month', () => {
    // « Chaque mars, le 15 » activé en juin : l'échéance de mars est due.
    const dates = dueDatesFor('yearly', 1, 15, 3, null, day('2026-06-10'));
    expect(keys(dates)).toEqual(['2026-03-15']);
  });

  it('does not generate a yearly occurrence that is still in the future', () => {
    // « Chaque novembre » vu en juin : rien à générer.
    const dates = dueDatesFor('yearly', 1, 1, 11, null, day('2026-06-10'));
    expect(keys(dates)).toEqual([]);
  });

  it('steps whole years from the last execution, on the anchored month', () => {
    const dates = dueDatesFor('yearly', 1, 15, 3, day('2024-03-15'), day('2026-06-10'));
    expect(keys(dates)).toEqual(['2025-03-15', '2026-03-15']);
  });

  it('keeps day_of_month when stepping from last_executed (no month anchor)', () => {
    const dates = dueDatesFor('yearly', 1, 20, null, day('2025-05-20'), day('2026-06-10'));
    expect(keys(dates)).toEqual(['2026-05-20']);
  });

  it('clamps the day to short months', () => {
    // 31 février n'existe pas → 28/29.
    const dates = dueDatesFor('yearly', 1, 31, 2, null, day('2026-06-10'));
    expect(keys(dates)).toEqual(['2026-02-28']);
  });
});

describe('dueDatesFor — monthly', () => {
  it('catches up missed months since last execution', () => {
    const dates = dueDatesFor('monthly', 1, 5, null, day('2026-03-05'), day('2026-06-10'));
    expect(keys(dates)).toEqual(['2026-04-05', '2026-05-05', '2026-06-05']);
  });
});
