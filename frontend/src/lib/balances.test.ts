import { describe, expect, it } from 'vitest';
import type { Account, RecurringTransaction } from '@suzanne-lite/shared';
import { isLiquidRecurring } from './balances';

function account(overrides: Partial<Account>): Account {
  return {
    id: 1, user_id: 1, institution_id: null, name: 'Compte', type: 'checking',
    currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01', created_at: '',
    ...overrides,
  };
}

function recurring(overrides: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: 1, user_id: 1, account_id: null, category_id: null, amount: 100, type: 'expense',
    description: 'Test', frequency: 'monthly', interval: 1, day_of_month: 1, month_of_year: null, active: true,
    last_executed: null, created_at: '',
    ...overrides,
  };
}

describe('isLiquidRecurring', () => {
  const accountById = new Map<number, Account>([
    [1, account({ id: 1, type: 'checking' })],   // cash
    [2, account({ id: 2, type: 'livret_a' })],   // regulated_savings
    [3, account({ id: 3, type: 'pea' })],        // investments
    [4, account({ id: 4, type: 'crypto' })],     // crypto
    [5, account({ id: 5, type: 'loan' })],       // liabilities
  ]);

  it('keeps recurring on a liquid account (cash or regulated savings)', () => {
    expect(isLiquidRecurring(recurring({ account_id: 1 }), accountById)).toBe(true);
    expect(isLiquidRecurring(recurring({ account_id: 2 }), accountById)).toBe(true);
  });

  it('excludes recurring tied to a non-liquid account', () => {
    expect(isLiquidRecurring(recurring({ account_id: 3 }), accountById)).toBe(false);
    expect(isLiquidRecurring(recurring({ account_id: 4 }), accountById)).toBe(false);
    expect(isLiquidRecurring(recurring({ account_id: 5 }), accountById)).toBe(false);
  });

  it('keeps a recurring with no account as a generic cashflow', () => {
    expect(isLiquidRecurring(recurring({ account_id: null }), accountById)).toBe(true);
  });

  it('keeps an orphaned account_id rather than silently dropping it', () => {
    expect(isLiquidRecurring(recurring({ account_id: 999 }), accountById)).toBe(true);
  });
});
