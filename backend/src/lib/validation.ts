import { z } from 'zod';

export const idParam = z.coerce.number().int().positive();
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const monthString = z.string().regex(/^\d{4}-\d{2}$/);

export const createUserSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['checking', 'savings', 'cash', 'other']).default('checking'),
  currency: z.string().trim().min(3).max(3).default('EUR'),
  initial_balance: z.coerce.number().default(0),
  initial_balance_date: dateString,
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['expense', 'income']),
  color: z.string().trim().min(1).default('#6366f1'),
  icon: z.string().trim().max(80).nullish(),
});

export const createTransactionSchema = z.object({
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount: z.coerce.number().positive(),
  type: z.enum(['expense', 'income', 'transfer']),
  date: dateString,
  description: z.string().trim().max(500).nullish(),
});

export const createBudgetSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  month: monthString,
  amount_limit: z.coerce.number().positive(),
});
