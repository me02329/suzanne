import type { Transaction } from '@suzanne-lite/shared';

// Signed effect of a transaction on a given account, in that account's own
// currency. A transfer debits its source (account_id) and credits its
// destination (to_account_id, using to_amount when the currencies differ).
// Returns 0 when the transaction does not touch the account.
export function accountSignedAmount(tx: Transaction, accountId: number): number {
  if (tx.type === 'transfer') {
    if (tx.account_id === accountId) return -tx.amount;
    if (tx.to_account_id === accountId) return tx.to_amount ?? tx.amount;
    return 0;
  }
  if (tx.account_id !== accountId) return 0;
  return tx.type === 'income' ? tx.amount : -tx.amount;
}

// Whether a transaction involves the account at all (as source or destination).
export function touchesAccount(tx: Transaction, accountId: number): boolean {
  return tx.account_id === accountId || tx.to_account_id === accountId;
}
