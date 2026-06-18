import { LIVRET_CEILINGS, type Account, type Transaction } from '@suzanne/shared';

// Regulatory livret ceiling to display for an account, or null when none
// applies. The ceiling is a French amount in EUR, and the bar compares it
// against a balance shown in the report currency — so it is only meaningful
// when the account itself is in EUR *and* the report currency is EUR. Either
// being non-EUR would compare or display mismatched currencies.
export function livretCeiling(account: Account, reportCurrency: string): number | null {
  if (account.currency !== 'EUR' || reportCurrency !== 'EUR') return null;
  return LIVRET_CEILINGS[account.type] ?? null;
}

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

// Comptes proposables à la saisie : on masque les comptes archivés (clôturés)
// pour ne pas encombrer les sélecteurs, tout en gardant le compte déjà
// sélectionné (`keepId`) afin de ne pas vider un formulaire d'édition pointant
// vers un compte archivé.
export function pickableAccounts(accounts: Account[], keepId?: number | null): Account[] {
  return accounts.filter((account) => !account.archived || account.id === keepId);
}
