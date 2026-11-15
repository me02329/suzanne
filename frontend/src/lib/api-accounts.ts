import type { Account, CreateAccountBody, Transaction } from '@suzanne/shared';
import { http } from './api';

// Champs d'investissement renvoyés par l'API compte (pas encore dans le type
// partagé `Account`) : acceptés en POST/PATCH.
export interface InvestmentAccountFields {
  orders_affect_cash?: boolean;
  fiscal_start_date?: string | null;
  /** Compte professionnel (société) : hors des finances personnelles. */
  professional?: boolean;
  /** Bien : prêt qui le finance. */
  linked_account_id?: number | null;
  /** Frais annuels en %. */
  annual_fee_rate?: number | null;
}
export type AccountWithInvestment = Account & InvestmentAccountFields;

export type AccountWriteBody = Partial<CreateAccountBody> & InvestmentAccountFields & { archived?: boolean };

export const accountsApi = {
  create: (userId: number, body: CreateAccountBody & InvestmentAccountFields) =>
    http<AccountWithInvestment>(`/users/${userId}/accounts`, { method: 'POST', body: JSON.stringify(body) }),
  update: (userId: number, id: number, body: AccountWriteBody) =>
    http<AccountWithInvestment>(`/users/${userId}/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // Toutes les opérations qui ont au moins une ligne sur le compte.
  transactions: (userId: number, accountId: number) =>
    http<Transaction[]>(`/users/${userId}/transactions?account_id=${accountId}`),
  // Rapprochement : écart entre deux ancres (solde initial / relevés) et les opérations.
  reconciliation: (userId: number, accountId: number) =>
    http<Reconciliation>(`/users/${userId}/accounts/${accountId}/reconciliation`),
  adjust: (userId: number, accountId: number, body: { date: string; amount: number; description?: string }) =>
    http<{ id: number }>(`/users/${userId}/accounts/${accountId}/adjustments`, { method: 'POST', body: JSON.stringify(body) }),
};

export interface ReconciliationAnchor { date: string; kind: 'initial' | 'snapshot'; value: number; snapshot_id?: number | null }
export interface ReconciliationPeriod {
  from: ReconciliationAnchor;
  to: ReconciliationAnchor;
  expected: number;
  movements: number;
  gap: number;
  count: number;
  /** Période antérieure à la première opération du compte (rien à rapprocher). */
  no_history?: boolean;
  adjustments: number;
}
export interface Reconciliation {
  account_id: number;
  currency: string;
  periods: ReconciliationPeriod[];
  open: { from: ReconciliationAnchor; movements: number; count: number };
  unreconciled: number;
  total_gap: number;
}

// Types pour lesquels les ordres de bourse peuvent débiter les espèces du compte.
export const ORDER_CASH_TYPES: ReadonlyArray<Account['type']> = ['pea', 'securities', 'crypto', 'retirement'];
// Types qui ont une date fiscale (ancienneté du plan / contrat).
export const FISCAL_DATE_TYPES: ReadonlyArray<Account['type']> = ['pea', 'life_insurance', 'retirement'];
