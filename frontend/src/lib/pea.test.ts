import { describe, expect, it } from 'vitest';
import type { AccountSnapshot, Transaction } from '@suzanne/shared';
import { accountCash, envelopeFlows, parseDecimal } from './pea';
import type { AccountWithInvestment } from './api-accounts';

const tx = (id: number, kind: Transaction['kind'], date: string, lines: Array<[number | null, number]>) =>
  ({ id, kind, date: `${date}T00:00:00.000Z`, description: null, lines: lines.map(([account_id, amount]) => ({ account_id, amount, category_id: null, refund: false, note: null })) }) as unknown as Transaction;

const account = { id: 6, initial_balance: 0, initial_balance_date: '2022-01-01T00:00:00.000Z' } as AccountWithInvestment;
const txs = [
  tx(1, 'transfer', '2022-01-09', [[6, 500]]),
  tx(2, 'transfer', '2022-02-09', [[2, -300], [6, 300]]),
  tx(3, 'trade', '2022-02-10', [[6, -700]]),
  tx(4, 'transfer', '2023-01-09', [[6, -50], [2, 50]]),
];

describe('envelopeFlows', () => {
  it('garde les lignes de virement du compte (source absente comprise)', () => {
    expect(envelopeFlows(txs, 6).map((f) => f.amount)).toEqual([-50, 300, 500]);
  });
});

describe('accountCash', () => {
  it('solde initial + toutes les lignes du compte', () => {
    expect(accountCash(account, txs, [])).toBe(50);
  });
  it('repart du dernier relevé (mouvements strictement après)', () => {
    const snaps = [{ account_id: 6, date: '2022-02-10T00:00:00.000Z', balance: 120 } as AccountSnapshot];
    expect(accountCash(account, txs, snaps)).toBe(70);
  });
});

describe('parseDecimal', () => {
  it('accepte la virgule et les espaces, arrondit', () => {
    expect(parseDecimal('1 234,5')).toBe(1234.5);
    expect(parseDecimal('0,123456789', 8)).toBe(0.12345679);
    expect(parseDecimal('abc')).toBeNaN();
  });
});
