import { z } from 'zod';

export const idParam = z.coerce.number().int().positive();
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const monthString = z.string().regex(/^\d{4}-\d{2}$/);

export const createUserSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const createAccountSchema = z.object({
  institution_id: z.coerce.number().int().positive().nullish(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['checking', 'savings', 'cash', 'other']).default('checking'),
  currency: z.string().trim().min(3).max(3).default('EUR'),
  initial_balance: z.coerce.number().default(0),
  initial_balance_date: dateString,
});
export const updateAccountSchema = createAccountSchema.partial();

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['expense', 'income']),
  color: z.string().trim().min(1).default('#6366f1'),
  icon: z.string().trim().max(80).nullish(),
});
export const updateCategorySchema = createCategorySchema.partial();

export const createTransactionSchema = z.object({
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount: z.coerce.number().positive(),
  type: z.enum(['expense', 'income', 'transfer']),
  date: dateString,
  description: z.string().trim().max(500).nullish(),
});
export const updateTransactionSchema = createTransactionSchema.partial();

export const createBudgetSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  month: monthString,
  amount_limit: z.coerce.number().positive(),
});

export const createRecurringSchema = z.object({
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount: z.coerce.number().positive(),
  type: z.enum(['expense', 'income']),
  description: z.string().trim().min(1).max(500),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  day_of_month: z.coerce.number().int().min(1).max(31).nullish(),
  active: z.coerce.boolean().default(true),
});
export const updateRecurringSchema = createRecurringSchema.partial();

export const createInstitutionSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createCategoryRuleSchema = z.object({
  pattern: z.string().trim().min(1).max(120),
  category_id: z.coerce.number().int().positive(),
});

export const createSavingsGoalSchema = z.object({
  name: z.string().trim().min(1).max(160),
  target_amount: z.coerce.number().positive(),
  current_amount: z.coerce.number().min(0).default(0),
  deadline: dateString.nullish(),
  color: z.string().trim().min(1).default('#4f46e5'),
});
export const updateSavingsGoalSchema = createSavingsGoalSchema.partial();

export const createAccountSnapshotSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  date: dateString,
  balance: z.coerce.number(),
});

export const csvImportSchema = z.object({
  csv: z.string().min(1),
  account_id: z.coerce.number().int().positive().nullish(),
});
