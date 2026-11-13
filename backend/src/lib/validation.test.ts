import { describe, expect, it } from 'vitest';
import {
  createAccountSchema,
  createAttachmentSchema,
  batchAccountSnapshotsSchema,
  createTransactionSchema,
  dateString,
  monthString,
  createRecurringSchema,
  currencyQuery,
  updateTransactionSchema,
} from './validation';

describe('validation schemas', () => {
  it('normalizes account currency input', () => {
    const account = createAccountSchema.parse({
      name: 'Compte courant',
      type: 'checking',
      currency: ' eur ',
      initial_balance: '12.345',
      initial_balance_date: '2026-05-28',
    });

    expect(account.currency).toBe('EUR');
    expect(account.initial_balance).toBe(12.35);
  });

  it('accepts the yen alias for reporting currency', () => {
    expect(currencyQuery.parse('yen')).toBe('JPY');
  });

  it('requires both accounts for transfers', () => {
    const result = createTransactionSchema.safeParse({
      type: 'transfer',
      account_id: 1,
      amount: 25,
      date: '2026-05-28',
    });

    expect(result.success).toBe(false);
  });

  it('rejects transfers between the same account', () => {
    const result = createTransactionSchema.safeParse({
      type: 'transfer',
      account_id: 1,
      to_account_id: 1,
      amount: 25,
      date: '2026-05-28',
    });

    expect(result.success).toBe(false);
  });

  it('allows partial transaction updates and rounds amounts', () => {
    expect(updateTransactionSchema.parse({ category_id: null })).toEqual({ category_id: null });
    expect(updateTransactionSchema.parse({ amount: '19.999' })).toEqual({ amount: 20 });
  });

  it('rejects invalid dates and non-positive amounts', () => {
    expect(createTransactionSchema.safeParse({
      type: 'expense',
      amount: 0,
      date: '28/05/2026',
    }).success).toBe(false);
  });

  it('rejects impossible calendar dates and months', () => {
    expect(dateString.safeParse('2026-02-29').success).toBe(false);
    expect(dateString.safeParse('2028-02-29').success).toBe(true);
    expect(dateString.safeParse('2026-99-01').success).toBe(false);
    expect(monthString.safeParse('2026-00').success).toBe(false);
    expect(monthString.safeParse('2026-13').success).toBe(false);
    expect(monthString.safeParse('2026-12').success).toBe(true);
  });

  it('bounds recurring intervals and snapshot batches', () => {
    expect(createRecurringSchema.parse({
      amount: 10,
      type: 'expense',
      description: 'Abonnement',
      frequency: 'monthly',
    }).interval).toBe(1);

    expect(createRecurringSchema.safeParse({
      amount: 10,
      type: 'expense',
      description: 'Abonnement',
      frequency: 'monthly',
      interval: 0,
    }).success).toBe(false);

    expect(batchAccountSnapshotsSchema.safeParse({
      date: '2026-05-31',
      balances: [],
    }).success).toBe(false);
  });
});

describe('createAttachmentSchema', () => {
  const base = { filename: 'facture.pdf', data_base64: 'aGVsbG8=' };
  it('accepts the allowed image and PDF types', () => {
    for (const mime_type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'IMAGE/PNG']) {
      expect(createAttachmentSchema.safeParse({ ...base, mime_type }).success).toBe(true);
    }
  });
  it('rejects SVG, HTML and other types', () => {
    for (const mime_type of ['image/svg+xml', 'text/html', 'application/octet-stream', 'image/bmp']) {
      expect(createAttachmentSchema.safeParse({ ...base, mime_type }).success).toBe(false);
    }
  });
});
