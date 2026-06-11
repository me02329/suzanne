import type { BillMonthStatus } from '@suzanne-lite/shared';
import { round2 } from './money.js';

// Logique pure de rapprochement des factures attendues (modèle Firefly Bill) :
// une facture est « due » sur les mois alignés sur sa cadence depuis
// `start_date`, et « payée » quand une dépense du mois matche son motif.

export interface BillShape {
  name: string;
  amount_min: number;
  amount_max: number;
  start_date: Date;
  frequency: 'monthly' | 'yearly';
  interval: number;
  pattern: string | null;
  account_id: number | null;
  category_id: number | null;
  active: boolean;
}

export interface BillCandidateTx {
  id: number;
  type: string;
  amount: number;
  date: Date;
  description: string | null;
  account_id: number | null;
  category_id: number | null;
}

export interface BillMonthResult {
  due: boolean;
  expected_date: string | null;
  status: BillMonthStatus;
  paid_amount: number;
  in_range: boolean | null;
  matched_transactions: Array<{ id: number; amount: number; date: string; description: string | null }>;
}

function monthIndex(year: number, month0: number): number {
  return year * 12 + month0;
}

// La facture est-elle attendue sur `month` (YYYY-MM) ? Vrai pour les mois
// alignés sur la cadence depuis le mois de `start_date` (inactive = jamais due).
export function billDueInMonth(bill: Pick<BillShape, 'start_date' | 'frequency' | 'interval' | 'active'>, month: string): boolean {
  if (!bill.active) return false;
  const [yearRaw, monthRaw] = month.split('-');
  const target = monthIndex(Number(yearRaw), Number(monthRaw) - 1);
  const start = monthIndex(bill.start_date.getUTCFullYear(), bill.start_date.getUTCMonth());
  if (target < start) return false;
  const step = Math.max(1, bill.interval) * (bill.frequency === 'yearly' ? 12 : 1);
  return (target - start) % step === 0;
}

// Échéance attendue dans le mois : le jour de `start_date`, clampé aux mois
// plus courts (facture du 31 → 28/29 février).
export function billExpectedDate(bill: Pick<BillShape, 'start_date'>, month: string): string {
  const [yearRaw, monthRaw] = month.split('-');
  const daysInMonth = new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 0)).getUTCDate();
  const day = Math.min(bill.start_date.getUTCDate(), daysInMonth);
  return `${month}-${String(day).padStart(2, '0')}`;
}

// Une dépense matche si sa description contient le motif (insensible à la
// casse ; motif vide = le nom de la facture) et respecte les filtres
// compte/catégorie éventuels. La fourchette de montant n'exclut pas le match :
// une facture payée hors fourchette doit être signalée, pas ignorée.
export function billMatchesTransaction(
  bill: Pick<BillShape, 'name' | 'pattern' | 'account_id' | 'category_id'>,
  tx: BillCandidateTx,
): boolean {
  if (tx.type !== 'expense') return false;
  if (bill.account_id != null && tx.account_id !== bill.account_id) return false;
  if (bill.category_id != null && tx.category_id !== bill.category_id) return false;
  const needle = (bill.pattern?.trim() || bill.name).toLowerCase();
  return (tx.description ?? '').toLowerCase().includes(needle);
}

export function billStatusForMonth(
  bill: BillShape,
  monthTransactions: BillCandidateTx[],
  month: string,
  today: Date,
): BillMonthResult {
  if (!billDueInMonth(bill, month)) {
    return { due: false, expected_date: null, status: 'not_due', paid_amount: 0, in_range: null, matched_transactions: [] };
  }
  const expectedDate = billExpectedDate(bill, month);
  const matched = monthTransactions
    .filter((tx) => billMatchesTransaction(bill, tx))
    .map((tx) => ({ id: tx.id, amount: tx.amount, date: tx.date.toISOString().slice(0, 10), description: tx.description }));
  const paidAmount = round2(matched.reduce((sum, tx) => sum + tx.amount, 0));
  if (matched.length > 0) {
    const inRange = paidAmount >= bill.amount_min - 0.005 && paidAmount <= bill.amount_max + 0.005;
    return {
      due: true,
      expected_date: expectedDate,
      status: inRange ? 'paid' : 'paid_out_of_range',
      paid_amount: paidAmount,
      in_range: inRange,
      matched_transactions: matched,
    };
  }
  const todayKey = today.toISOString().slice(0, 10);
  return {
    due: true,
    expected_date: expectedDate,
    status: expectedDate < todayKey ? 'late' : 'pending',
    paid_amount: 0,
    in_range: null,
    matched_transactions: [],
  };
}
