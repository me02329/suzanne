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
  // Taux constant sur toutes les dates : l'équivalence avec computeAccountBalancesAt
  // (qui prend un taux unique) tient toujours.
  const fxByDate = dates.map(() => fx);

  it('matches computeAccountBalancesAt at every date', () => {
    const series = computeWealthSeries(accounts, transactions, snapshots, dates, fxByDate);
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
    const series = computeWealthSeries(accounts, transactions, snapshots, dates, fxByDate);
    // The -75 expense lands on 2026-03-05.
    expect(series[1]!.unassignedBalance).toBe(0);   // 2026-02-28, before it
    expect(series[2]!.unassignedBalance).toBe(-75);  // 2026-03-31, after it
  });
});

describe('historique importé après coup (antérieur au solde saisi)', () => {
  // L'utilisateur saisit « 1000 € au 1er septembre », puis importe deux mois
  // plus tard ses opérations de mars à août.
  const tx = (id: number, type: string, amount: number, iso: string, account_id: number | null, to_account_id: number | null = null) => ({
    id, type, amount, to_amount: null, date: date(iso), category_id: null, account_id, to_account_id,
    refunds_transaction_id: null, splits: [], refund_allocations_sent: [],
  });
  const accounts = [
    { id: 1, name: 'Courant', type: 'checking', currency: 'EUR', initial_balance: 1000, initial_balance_date: date('2026-09-01') },
    { id: 2, name: 'Livret', type: 'savings', currency: 'EUR', initial_balance: 0, initial_balance_date: date('2026-10-15') },
  ];
  const transactions = [
    tx(1, 'expense', 100, '2026-03-10', 1),
    tx(2, 'income', 2000, '2026-05-01', 1),
    tx(3, 'transfer', 300, '2026-08-31', 1, 2),
    tx(4, 'expense', 50, '2026-09-01', 1),   // jour d'ouverture : compte dans le solde
    tx(5, 'expense', 20, '2026-09-20', 2),
  ];
  // Livret : relevé connu au 30/09 (avant sa date d'ouverture saisie).
  const snapshots = [{ account_id: 2, date: date('2026-09-30'), balance: 1500 }];
  const fx = new Map([['EUR', 1]]);
  const dates = ['2026-02-28', '2026-03-10', '2026-03-31', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-30', '2026-10-31'].map(date);

  it("ne modifie pas le solde actuel", () => {
    const now = computeAccountBalances(accounts, transactions, snapshots, fx);
    expect(now.find((r) => r.account_id === 1)?.balance).toBe(950);
    expect(now.find((r) => r.account_id === 2)?.balance).toBe(1500);
  });

  it("reconstruit l'historique à rebours depuis le solde connu", () => {
    const series = computeWealthSeries(accounts, transactions, snapshots, dates, dates.map(() => fx));
    const courant = series.map((p) => p.accountBalances.find((r) => r.account_id === 1)?.balance ?? null);
    expect(courant).toEqual([null, -700, -700, 1300, 1000, 950, 950, 950]);
    const livret = series.map((p) => p.accountBalances.find((r) => r.account_id === 2)?.balance ?? null);
    // Avant le 31/08 le livret n'a aucun mouvement : absent. Puis relevé 1500 au
    // 30/09 moins les mouvements de ]t, 30/09] : +300 (31/08) et -20 (20/09).
    expect(livret).toEqual([null, null, null, null, 1520, 1520, 1500, 1500]);
  });

  it('reste équivalent au calcul ponctuel de référence', () => {
    const series = computeWealthSeries(accounts, transactions, snapshots, dates, dates.map(() => fx));
    dates.forEach((d, di) => {
      const reference = computeAccountBalancesAt(accounts, transactions, snapshots, d, fx)
        .map((row) => [row.account_id, r2(row.signed_balance)] as const).sort((a, b) => a[0] - b[0]);
      const swept = series[di]!.accountBalances
        .map((row) => [row.account_id, r2(row.signed_balance)] as const).sort((a, b) => a[0] - b[0]);
      expect(swept, `date ${d.toISOString().slice(0, 10)}`).toEqual(reference);
    });
  });
});
