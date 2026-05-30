import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_GROUPS,
  ACCOUNT_TYPES,
  accountGroupColor,
  accountGroupLabel,
  accountTypeGroup,
  accountTypeLabel,
  nextRecurringOccurrence,
  recurringMonthlyEquivalent,
} from './index';

describe('account taxonomy', () => {
  it('keeps every account type mapped to an existing group', () => {
    const groups = new Set(ACCOUNT_GROUPS.map((group) => group.value));

    for (const accountType of ACCOUNT_TYPES) {
      expect(groups.has(accountType.group)).toBe(true);
      expect(accountTypeLabel(accountType.value)).toBe(accountType.label);
      expect(accountTypeGroup(accountType.value)).toBe(accountType.group);
    }
  });

  it('returns stable fallbacks for unknown groups', () => {
    expect(accountGroupLabel('missing')).toBe('missing');
    expect(accountGroupColor('missing')).toBe('#64748b');
  });

  it('classifies liabilities separately from assets', () => {
    expect(accountTypeGroup('credit')).toBe('liabilities');
    expect(accountTypeGroup('loan')).toBe('liabilities');
    expect(accountTypeGroup('checking')).toBe('cash');
  });
});

describe('nextRecurringOccurrence', () => {
  const base = { interval: 1, day_of_month: null, last_executed: null } as const;
  const from = new Date('2026-05-30T12:00:00.000Z');

  it('returns the next monthly date after today when never executed', () => {
    expect(
      nextRecurringOccurrence({ ...base, frequency: 'monthly', day_of_month: 1 }, from),
    ).toBe('2026-06-01');
  });

  it('uses day_of_month within the current month when it is still ahead', () => {
    expect(
      nextRecurringOccurrence({ ...base, frequency: 'monthly', day_of_month: 31 }, from),
    ).toBe('2026-05-31');
  });

  it('clamps the day to the length of a short month', () => {
    expect(
      nextRecurringOccurrence(
        { ...base, frequency: 'monthly', day_of_month: 31, last_executed: '2026-01-31' },
        new Date('2026-02-10T00:00:00.000Z'),
      ),
    ).toBe('2026-02-28');
  });

  it('steps weekly from the last execution past today', () => {
    expect(
      nextRecurringOccurrence(
        { ...base, frequency: 'weekly', last_executed: '2026-05-25' },
        from,
      ),
    ).toBe('2026-06-01');
  });

  it('honours the interval for yearly recurrences and skips past-due dates', () => {
    // last run in 2024, every 2 years → 2026-03-15 is already overdue on
    // 2026-05-30, so the next *upcoming* occurrence is 2028.
    expect(
      nextRecurringOccurrence(
        { frequency: 'yearly', interval: 2, day_of_month: 15, last_executed: '2024-03-15' },
        from,
      ),
    ).toBe('2028-03-15');
  });
});

describe('recurringMonthlyEquivalent', () => {
  it('converts a weekly amount to its monthly average', () => {
    expect(recurringMonthlyEquivalent({ amount: 30, frequency: 'weekly', interval: 1 })).toBeCloseTo(130, 0);
  });

  it('keeps a monthly amount as-is', () => {
    expect(recurringMonthlyEquivalent({ amount: 50, frequency: 'monthly', interval: 1 })).toBe(50);
  });

  it('spreads a yearly amount over twelve months', () => {
    expect(recurringMonthlyEquivalent({ amount: 120, frequency: 'yearly', interval: 1 })).toBe(10);
  });

  it('divides by the interval', () => {
    expect(recurringMonthlyEquivalent({ amount: 50, frequency: 'monthly', interval: 2 })).toBe(25);
  });
});
