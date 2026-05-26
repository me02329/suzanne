import { z } from 'zod';
import { round2 } from './money.js';

const amount = z.coerce.number().positive().transform(round2);
const signedAmount = z.coerce.number().transform(round2);

export const idParam = z.coerce.number().int().positive();
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const monthString = z.string().regex(/^\d{4}-\d{2}$/);

export const createUserSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const createAccountSchema = z.object({
  institution_id: z.coerce.number().int().positive().nullish(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['checking', 'savings', 'cash', 'other']).default('checking'),
  currency: z.string().trim().min(3).max(3).default('EUR'),
  initial_balance: z.coerce.number().default(0).transform(round2),
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
  to_account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount,
  type: z.enum(['expense', 'income', 'transfer']),
  date: dateString,
  description: z.string().trim().max(500).nullish(),
}).superRefine((data, ctx) => {
  if (data.type !== 'transfer') return;
  if (!data.account_id || !data.to_account_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un transfert exige un compte source et un compte destination' });
  } else if (data.account_id === data.to_account_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Les comptes source et destination doivent être différents' });
  }
});
export const updateTransactionSchema = z.object({
  account_id: z.coerce.number().int().positive().nullish(),
  to_account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount,
  type: z.enum(['expense', 'income', 'transfer']),
  date: dateString,
  description: z.string().trim().max(500).nullish(),
}).partial();

export const createBudgetSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  month: monthString,
  amount_limit: amount,
});

export const createRecurringSchema = z.object({
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount,
  type: z.enum(['expense', 'income']),
  description: z.string().trim().min(1).max(500),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  interval: z.coerce.number().int().min(1).max(120).default(1),
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
  target_amount: amount,
  current_amount: z.coerce.number().min(0).default(0).transform(round2),
  deadline: dateString.nullish(),
  color: z.string().trim().min(1).default('#4f46e5'),
});
export const updateSavingsGoalSchema = createSavingsGoalSchema.partial();

export const createAccountSnapshotSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  date: dateString,
  balance: signedAmount,
});

export const csvImportSchema = z.object({
  csv: z.string().min(1),
  account_id: z.coerce.number().int().positive().nullish(),
});
