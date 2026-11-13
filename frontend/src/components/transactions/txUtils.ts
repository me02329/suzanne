import { useEffect, useState } from 'react';
import type { Account, Transaction } from '@suzanne/shared';
import { money } from '../../lib/format';
import { localeTag } from '../../i18n';

// Dates « YYYY-MM-DD » : on lit les parties de la chaîne et on construit une
// date LOCALE. `new Date('2026-03-12')` est interprété en UTC et peut afficher
// la veille selon le fuseau.
function partsOf(iso: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function localDate(iso: string): Date | null {
  const parts = partsOf(iso);
  return parts ? new Date(parts[0], parts[1] - 1, parts[2]) : null;
}

// « 12/03/2026 » — date numérique courte, formatée depuis les parties.
export function formatTxDate(iso: string): string {
  const date = localDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(localeTag(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

// « 12 mars » (+ année si demandé) — colonne Date du journal.
export function formatTxDay(iso: string, withYear = false): string {
  const date = localDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(date);
}

// « Mardi 12 mars » — en-têtes de groupe de la liste mobile.
export function formatDayHeader(iso: string, withYear = false): string {
  const date = localDate(iso);
  if (!date) return iso;
  const label = new Intl.DateTimeFormat(localeTag(), { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Montant saisi à la française : « 12,50 », « 1 234,5 », « 12.50 ».
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

// Valeur initiale d'un champ montant (affiche la virgule en français).
export function amountInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  const text = String(roundAmount(value));
  return localeTag().startsWith('fr') ? text.replace('.', ',') : text;
}

export function txCurrency(t: Transaction, accountById: Map<number, Account>): string {
  return accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
}

// Montant signé affiché : + revenu, − dépense, transfert neutre (avec la
// conversion de devise le cas échéant).
export function txAmountLabel(t: Transaction, accountById: Map<number, Account>): string {
  const src = txCurrency(t, accountById);
  if (t.type === 'transfer') {
    const dest = accountById.get(t.to_account_id ?? -1)?.currency ?? src;
    if (src !== dest && t.to_amount != null && t.to_amount !== t.amount) {
      return `${money(t.amount, src)} → ${money(t.to_amount, dest)}`;
    }
    return money(t.amount, src);
  }
  return `${t.type === 'income' ? '+' : '−'}${money(t.amount, src)}`;
}

export function txTone(t: Transaction): 'income' | 'expense' | 'transfer' {
  return t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer';
}

// Opérations de bourse (mouvements d'espèces d'un ordre) : lecture seule,
// elles se modifient depuis l'ordre.
export function isReadOnly(t: Transaction): boolean {
  return t.kind === 'trade';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// ---- Ventilation (brouillons d'édition) ----------------------------------

export type SplitDraft = { key: string; category_id: string; amount: string; note: string };

let draftSeq = 0;
export function emptySplitDraft(): SplitDraft {
  draftSeq += 1;
  return { key: `split-${draftSeq}`, category_id: '', amount: '', note: '' };
}

export function splitDraftsFromTransaction(t: Transaction): SplitDraft[] {
  return (t.splits ?? []).map((split) => ({
    ...emptySplitDraft(),
    category_id: split.category_id == null ? '' : String(split.category_id),
    amount: amountInput(split.amount),
    note: split.note ?? '',
  }));
}

// 1re ligne = catégorie et montant courants (à ajuster), 2e vide : le bouton
// « solde » la complète.
export function prefilledSplitDrafts(categoryId: number | string | null, amount: string): SplitDraft[] {
  return [
    { ...emptySplitDraft(), category_id: categoryId ? String(categoryId) : '', amount },
    emptySplitDraft(),
  ];
}

// Groupe des transactions (déjà triées) par jour, en conservant l'ordre.
export function groupByDay(rows: Transaction[]): Array<{ day: string; rows: Transaction[] }> {
  const groups: Array<{ day: string; rows: Transaction[] }> = [];
  for (const t of rows) {
    const day = t.date.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(t);
    else groups.push({ day, rows: [t] });
  }
  return groups;
}
