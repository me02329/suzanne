import { describe, expect, it } from 'vitest';
import { detectTransferPairs, type PairCandidate } from './transferPairs';

const op = (id: number, account_id: number, amount: number, date: string, currency = 'EUR'): PairCandidate =>
  ({ id, account_id, amount, date: new Date(`${date}T00:00:00Z`), description: null, currency });

describe('detectTransferPairs', () => {
  it('relie une sortie et une entrée de même montant sur deux comptes, au plus près', () => {
    const pairs = detectTransferPairs([
      op(1, 1, -500, '2026-10-01'),
      op(2, 2, 500, '2026-10-02'),
      op(3, 2, 500, '2026-10-01'), // plus proche : c'est elle
    ]);
    expect(pairs.map((p) => [p.out.id, p.in.id])).toEqual([[1, 3]]);
  });

  it('ignore même compte, autre montant, autre devise, trop loin, paire écartée', () => {
    expect(detectTransferPairs([op(1, 1, -50, '2026-10-01'), op(2, 1, 50, '2026-10-01')])).toEqual([]);
    expect(detectTransferPairs([op(1, 1, -50, '2026-10-01'), op(2, 2, 49.9, '2026-10-01')])).toEqual([]);
    expect(detectTransferPairs([op(1, 1, -50, '2026-10-01'), op(2, 2, 50, '2026-10-01', 'USD')])).toEqual([]);
    expect(detectTransferPairs([op(1, 1, -50, '2026-10-01'), op(2, 2, 50, '2026-10-05')])).toEqual([]);
    expect(detectTransferPairs([op(1, 1, -50, '2026-10-01'), op(2, 2, 50, '2026-10-01')], new Set(['1-2']))).toEqual([]);
  });

  it('chaque opération ne sert qu’une fois', () => {
    const pairs = detectTransferPairs([op(1, 1, -20, '2026-10-01'), op(2, 1, -20, '2026-10-01'), op(3, 2, 20, '2026-10-01')]);
    expect(pairs).toHaveLength(1);
  });
});
