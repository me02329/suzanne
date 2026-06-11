import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, Transaction } from '@suzanne/shared';
import {
  currentMonthIso,
  formatMonth,
  formatMonthLong,
  lastDayOfPreviousMonthIso,
  recurringFrequencyLabel,
  todayIso,
  truncate,
  txLabel,
  typeLabel,
} from './format';

const category = {
  id: 1,
  user_id: 1,
  name: 'Courses',
  type: 'expense',
  color: '#22c55e',
  icon: null,
  created_at: '2026-01-01T00:00:00.000Z',
} satisfies Category;

const baseTransaction = {
  id: 1,
  user_id: 1,
  account_id: 1,
  to_account_id: null,
  category_id: 1,
  recurring_transaction_id: null,
  refunds_transaction_id: null,
  amount: 12,
  to_amount: null,
  exchange_rate: null,
  type: 'expense',
  date: '2026-05-28T00:00:00.000Z',
  description: null,
  created_at: '2026-05-28T00:00:00.000Z',
  tags: [],
  splits: [],
  refund_allocations: [],
} satisfies Transaction;

describe('format helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats month labels in French', () => {
    expect(formatMonth('2026-05')).toMatch(/mai/i);
    expect(formatMonthLong('2026-05')).toBe('Mai 2026');
  });

  it('uses current date helpers based on system time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T10:00:00.000Z'));

    expect(todayIso()).toBe('2026-05-28');
    expect(currentMonthIso()).toBe('2026-05');
    expect(lastDayOfPreviousMonthIso()).toBe('2026-04-30');
  });

  it('builds transaction labels by priority', () => {
    const categories = new Map([[category.id, category]]);

    expect(txLabel({ ...baseTransaction, description: 'Carrefour' }, categories)).toBe('Carrefour');
    expect(txLabel(baseTransaction, categories)).toBe('Courses');
    expect(txLabel({ ...baseTransaction, type: 'transfer', category_id: null }, categories)).toBe('Transfert');
    expect(txLabel({ ...baseTransaction, category_id: null }, categories)).toBe('Transaction');
  });

  it('formats transaction and recurring labels', () => {
    expect(typeLabel('expense')).toBe('Dépense');
    expect(typeLabel('income')).toBe('Revenu');
    expect(typeLabel('transfer')).toBe('Transfert');
    expect(recurringFrequencyLabel('weekly', 1)).toBe('Chaque semaine');
    expect(recurringFrequencyLabel('monthly', 2)).toBe('Tous les 2 mois');
    expect(recurringFrequencyLabel('yearly', 3)).toBe('Tous les 3 ans');
  });

  it('truncates long labels only when needed', () => {
    expect(truncate('Court', 10)).toBe('Court');
    expect(truncate('Libelle tres long', 8)).toBe('Libelle…');
  });
});
