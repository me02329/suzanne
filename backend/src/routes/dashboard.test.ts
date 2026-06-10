import { describe, expect, it } from 'vitest';
import { computeAccountBalances, computeAccountBalancesAt, computeWealthSeries } from './dashboard';

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const r2 = (value: number) => Math.round(value * 100) / 100;

describe('computeAccountBalances', () => {
  it('applies opening-day transfer debits and credits from initial balances', () => {
    const balances = computeAccountBalances(
      [
        {
          id: 1,
          name: 'Courant',
          type: 'checking',
          currency: 'EUR',
          initial_balance: 500,
          initial_balance_date: date('2026-05-31'),
        },
        {
          id: 2,
          name: 'Livret',
          type: 'savings',
          currency: 'EUR',
          initial_balance: 200,
          initial_balance_date: date('2026-05-31'),
        },
      ],
      [
        {
          id: 1,
          type: 'transfer',
          amount: 100,
          to_amount: null,
          date: date('2026-05-31'),
          category_id: null,
          account_id: 1,
          to_account_id: 2,
          refunds_transaction_id: null,
          splits: [],
          refund_allocations_sent: [],
        },
      ],
      [],
      new Map([['EUR', 1]]),
    );

    expect(balances.find((row) => row.account_id === 1)?.signed_balance).toBe(400);
    expect(balances.find((row) => row.account_id === 2)?.signed_balance).toBe(300);
  });

  it('does not double-count same-day transfers already covered by snapshots', () => {
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
          id: 1,
          type: 'transfer',
          amount: 4000,
          to_amount: null,
          date: date('2026-05-31'),
          category_id: null,
          account_id: 1,
          to_account_id: 2,
          refunds_transaction_id: null,
          splits: [],
          refund_allocations_sent: [],
        },
      ],
      [
        { account_id: 1, date: date('2026-05-31'), balance: 1000 },
        { account_id: 2, date: date('2026-05-31'), balance: 5000 },
      ],
      new Map([['EUR', 1]]),
    );

    expect(balances.find((row) => row.account_id === 1)?.signed_balance).toBe(1000);
    expect(balances.find((row) => row.account_id === 2)?.signed_balance).toBe(5000);
  });
});

describe('computeWealthSeries', () => {
  // A scenario covering every tricky path: a snapshot that resets a base, a
  // later transfer that adds on top, a back-dated snapshot anchoring an account
  // before its opening date, two snapshots in a row, a liability, a foreign
  // currency, and an account-less transaction. The series must equal calling
  // computeAccountBalancesAt at each date one by one.
  const accounts = [
    { id: 1, name: 'Courant', type: 'checking', currency: 'EUR', initial_balance: 500, initial_balance_date: date('2026-01-01') },
    { id: 2, name: 'Livret', type: 'savings', currency: 'EUR', initial_balance: 0, initial_balance_date: date('2026-01-01') },
    { id: 3, name: 'Crypto', type: 'crypto', currency: 'EUR', initial_balance: 0, initial_balance_date: date('2026-06-01') },
    { id: 4, name: 'Prêt', type: 'loan', currency: 'EUR', initial_balance: 10000, initial_balance_date: date('2026-01-01') },
    { id: 5, name: 'Dollars', type: 'checking', currency: 'USD', initial_balance: 1000, initial_balance_date: date('2026-01-01') },
  ];
  const transactions = [
    { id: 1, type: 'expense', amount: 100, to_amount: null, date: date('2026-02-15'), category_id: null, account_id: 1, to_account_id: null, refunds_transaction_id: null, splits: [], refund_allocations_sent: [] },
    { id: 2, type: 'income', amount: 50, to_amount: null, date: date('2026-03-10'), category_id: null, account_id: 1, to_account_id: null, refunds_transaction_id: null, splits: [], refund_allocations_sent: [] },
    { id: 3, type: 'transfer', amount: 200, to_amount: null, date: date('2026-04-01'), category_id: null, account_id: 1, to_account_id: 2, refunds_transaction_id: null, splits: [], refund_allocations_sent: [] },
    { id: 4, type: 'expense', amount: 75, to_amount: null, date: date('2026-03-05'), category_id: null, account_id: null, to_account_id: null, refunds_transaction_id: null, splits: [], refund_allocations_sent: [] },
  ];
  const snapshots = [
    { account_id: 2, date: date('2026-03-31'), balance: 1000 },
    { account_id: 3, date: date('2026-02-28'), balance: 3000 },
    { account_id: 3, date: date('2026-05-31'), balance: 5000 },
    { account_id: 4, date: date('2026-04-30'), balance: 8000 },
  ];
  const fx = new Map([['EUR', 1], ['USD', 0.9]]);
  const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31'].map(date);

  it('matches computeAccountBalancesAt at every date', () => {
    const series = computeWealthSeries(accounts, transactions, snapshots, dates, fx);
    dates.forEach((d, di) => {
      const reference = computeAccountBalancesAt(accounts, transactions, snapshots, d, fx)
        .map((row) => [row.account_id, r2(row.signed_balance)] as const)
        .sort((a, b) => a[0] - b[0]);
      const swept = series[di]!.accountBalances
        .map((row) => [row.account_id, r2(row.signed_balance)] as const)
        .sort((a, b) => a[0] - b[0]);
      expect(swept, `date ${dates[di]!.toISOString().slice(0, 10)}`).toEqual(reference);
    });
  });

  it('tracks the account-less running balance per date', () => {
    const series = computeWealthSeries(accounts, transactions, snapshots, dates, fx);
    // The -75 expense lands on 2026-03-05.
    expect(series[1]!.unassignedBalance).toBe(0);   // 2026-02-28, before it
    expect(series[2]!.unassignedBalance).toBe(-75);  // 2026-03-31, after it
  });
});
