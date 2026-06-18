import { describe, expect, it } from 'vitest';
import { refundAllocatedAmount, type Account, type Transaction } from '@suzanne/shared';
import { accountSignedAmount, livretCeiling, touchesAccount } from './account';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1, user_id: 1, account_id: 1, to_account_id: null, category_id: null,
    recurring_transaction_id: null, refunds_transaction_id: null, amount: 100, to_amount: null, exchange_rate: null,
    type: 'expense', date: '2026-01-10', description: null, created_at: '', tags: [], splits: [], refund_allocations: [],
    ...overrides,
  };
}

function account(overrides: Partial<Account>): Account {
  return {
    id: 1, user_id: 1, institution_id: null, name: 'Livret', type: 'livret_a',
    currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01', created_at: '',
    ...overrides,
  };
}

describe('accountSignedAmount', () => {
  it('signs income and expense on the owning account', () => {
    expect(accountSignedAmount(tx({ type: 'income', amount: 100 }), 1)).toBe(100);
    expect(accountSignedAmount(tx({ type: 'expense', amount: 100 }), 1)).toBe(-100);
    expect(accountSignedAmount(tx({ type: 'expense', amount: 100, account_id: 2 }), 1)).toBe(0);
  });

  it('debits the transfer source and credits the destination', () => {
    const transfer = tx({ type: 'transfer', account_id: 1, to_account_id: 2, amount: 50, to_amount: 48 });
    expect(accountSignedAmount(transfer, 1)).toBe(-50);
    expect(accountSignedAmount(transfer, 2)).toBe(48); // foreign currency leg uses to_amount
    expect(accountSignedAmount(transfer, 3)).toBe(0);
  });

  it('falls back to amount on the destination when to_amount is null', () => {
    const transfer = tx({ type: 'transfer', account_id: 1, to_account_id: 2, amount: 50, to_amount: null });
    expect(accountSignedAmount(transfer, 2)).toBe(50);
  });

  it('touchesAccount covers both legs', () => {
    const transfer = tx({ type: 'transfer', account_id: 1, to_account_id: 2 });
    expect(touchesAccount(transfer, 1)).toBe(true);
    expect(touchesAccount(transfer, 2)).toBe(true);
    expect(touchesAccount(transfer, 3)).toBe(false);
  });
});

describe('livretCeiling', () => {
  it('returns the regulatory ceiling for an EUR livret with EUR reporting', () => {
    expect(livretCeiling(account({ type: 'livret_a' }), 'EUR')).toBe(22950);
    expect(livretCeiling(account({ type: 'ldds' }), 'EUR')).toBe(12000);
  });

  it('hides the ceiling for a livret held in a non-EUR currency', () => {
    expect(livretCeiling(account({ type: 'livret_a', currency: 'USD' }), 'EUR')).toBeNull();
  });

  it('hides the ceiling when the report currency is not EUR (balance would mismatch)', () => {
    expect(livretCeiling(account({ type: 'livret_a', currency: 'EUR' }), 'USD')).toBeNull();
  });

  it('returns null for account types without a ceiling', () => {
    expect(livretCeiling(account({ type: 'checking' }), 'EUR')).toBeNull();
    expect(livretCeiling(account({ type: 'pea' }), 'EUR')).toBeNull();
  });
});

describe('refundAllocatedAmount', () => {
  const alloc = (id: number, amount: number) => ({
    id, user_id: 1, refund_transaction_id: 9, expense_transaction_id: id, amount, created_at: '',
  });

  it('ignore les non-revenus', () => {
    expect(refundAllocatedAmount(tx({ type: 'expense', amount: 100 }))).toBe(0);
  });

  it('vaut 0 pour un revenu sans lien de remboursement', () => {
    expect(refundAllocatedAmount(tx({ type: 'income', amount: 100 }))).toBe(0);
  });

  it('somme les allocations, bornées au montant du revenu (le surplus reste revenu)', () => {
    // Revenu 120, allocation 100 → 100 annulent une dépense, 20 restent revenu.
    expect(refundAllocatedAmount(tx({ type: 'income', amount: 120, refund_allocations: [alloc(1, 100)] }))).toBe(100);
    // Allocations cumulées au-delà du revenu sont bornées au revenu.
    expect(refundAllocatedAmount(tx({ type: 'income', amount: 100, refund_allocations: [alloc(1, 60), alloc(2, 60)] }))).toBe(100);
  });

  it('gère le lien legacy refunds_transaction_id (tout le revenu)', () => {
    expect(refundAllocatedAmount(tx({ type: 'income', amount: 80, refunds_transaction_id: 5 }))).toBe(80);
  });
});
