import { describe, expect, it } from 'vitest';
import { computeAccountBalances } from './dashboard';

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('computeAccountBalances', () => {
  it('applies same-day transfer debits and credits from snapshot anchors', () => {
    const balances = computeAccountBalances(
      [
        {
          id: 1,
          name: 'Courant',
          type: 'checking',
          currency: 'EUR',
          initial_balance: 0,
          initial_balance_date: date('2026-01-01'),
        },
        {
          id: 2,
          name: 'Livret',
          type: 'savings',
          currency: 'EUR',
          initial_balance: 0,
          initial_balance_date: date('2026-01-01'),
        },
      ],
      [
        {
          type: 'transfer',
          amount: 100,
          to_amount: null,
          date: date('2026-05-31'),
          category_id: null,
          account_id: 1,
          to_account_id: 2,
        },
      ],
      [
        { account_id: 1, date: date('2026-05-31'), balance: 500 },
        { account_id: 2, date: date('2026-05-31'), balance: 200 },
      ],
      new Map([['EUR', 1]]),
    );

    expect(balances.find((row) => row.account_id === 1)?.signed_balance).toBe(400);
    expect(balances.find((row) => row.account_id === 2)?.signed_balance).toBe(300);
  });
});
