import { z } from 'zod';
import { round2 } from './money.js';
import { normalizeCurrency } from './fx.js';

const amount = z.coerce.number().positive().transform(round2);
const signedAmount = z.coerce.number().transform(round2);
const currencyCode = z.string().trim().min(3).max(3).transform(normalizeCurrency);

export const idParam = z.coerce.number().int().positive();
export const dateString = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDateString, 'Date invalide');
export const monthString = z.string()
  .regex(/^\d{4}-\d{2}$/)
  .refine(isValidMonthString, 'Mois invalide');

export const createUserSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const createAccountSchema = z.object({
  institution_id: z.coerce.number().int().positive().nullish(),
  name: z.string().trim().min(1).max(120),
  type: z.enum([
    'checking',
    'savings',
    'livret_a',
    'ldds',
    'lep',
    'pel',
    'cel',
    'pea',
    'securities',
    'life_insurance',
    'crypto',
    'retirement',
    'cash',
    'credit',
    'loan',
    'other',
  ]).default('checking'),
  currency: currencyCode.default('EUR'),
  initial_balance: z.coerce.number().default(0).transform(round2),
  initial_balance_date: dateString,
});
export const updateAccountSchema = createAccountSchema.partial().extend({
  archived: z.coerce.boolean().optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['expense', 'income']),
  color: z.string().trim().min(1).default('#6366f1'),
  icon: z.string().trim().max(80).nullish(),
});
export const updateCategorySchema = createCategorySchema.partial();

const tagIdsArray = z.array(z.coerce.number().int().positive()).max(20).optional();
const transactionSplits = z.array(z.object({
  category_id: z.coerce.number().int().positive(),
  amount,
  note: z.string().trim().max(160).nullish(),
})).max(20).optional();
const refundAllocations = z.array(z.object({
  expense_transaction_id: z.coerce.number().int().positive(),
  amount,
})).max(20).optional();

export const createTransactionSchema = z.object({
  account_id: z.coerce.number().int().positive().nullish(),
  to_account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  amount,
  to_amount: z.coerce.number().positive().transform(round2).nullish(),
  type: z.enum(['expense', 'income', 'transfer']),
  date: dateString,
  description: z.string().trim().max(500).nullish(),
  cleared: z.coerce.boolean().optional(),
  tag_ids: tagIdsArray,
  splits: transactionSplits,
  refund_allocations: refundAllocations,
  refunds_transaction_id: z.coerce.number().int().positive().nullish(),
}).superRefine((data, ctx) => {
  if (data.refunds_transaction_id != null && data.refund_allocations && data.refund_allocations.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Utilise soit un lien de remboursement simple, soit des allocations multiples' });
  }
  if (data.refunds_transaction_id != null && data.type !== 'income') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Seul un revenu peut rembourser une dépense' });
  }
  if (data.refund_allocations && data.refund_allocations.length > 0) {
    if (data.type !== 'income') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Seul un revenu peut porter des allocations de remboursement' });
    }
    const total = round2(data.refund_allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    if (total - data.amount > 0.01) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Les remboursements alloués ne peuvent pas dépasser le revenu' });
    }
  }
  if (data.splits && data.splits.length > 0) {
    if (data.type === 'transfer') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un transfert ne peut pas être ventilé' });
    }
    const total = round2(data.splits.reduce((sum, split) => sum + split.amount, 0));
    if (Math.abs(total - data.amount) > 0.01) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La ventilation doit totaliser le montant de la transaction' });
    }
  }
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
  to_amount: z.coerce.number().positive().transform(round2).nullish(),
  type: z.enum(['expense', 'income', 'transfer']),
  date: dateString,
  description: z.string().trim().max(500).nullish(),
  cleared: z.coerce.boolean().optional(),
  tag_ids: tagIdsArray,
  splits: transactionSplits,
  refund_allocations: refundAllocations,
  refunds_transaction_id: z.coerce.number().int().positive().nullish(),
}).partial().superRefine((data, ctx) => {
  if (data.refunds_transaction_id != null && data.refund_allocations && data.refund_allocations.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Utilise soit un lien de remboursement simple, soit des allocations multiples' });
  }
  if (data.refund_allocations && data.refund_allocations.length > 0 && data.type && data.type !== 'income') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Seul un revenu peut porter des allocations de remboursement' });
  }
  if (data.refund_allocations && data.refund_allocations.length > 0 && data.amount != null) {
    const total = round2(data.refund_allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    if (total - data.amount > 0.01) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Les remboursements alloués ne peuvent pas dépasser le revenu' });
    }
  }
  if (data.splits && data.splits.length > 0 && data.type === 'transfer') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un transfert ne peut pas être ventilé' });
  }
  if (data.splits && data.splits.length > 0 && data.amount != null) {
    const total = round2(data.splits.reduce((sum, split) => sum + split.amount, 0));
    if (Math.abs(total - data.amount) > 0.01) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La ventilation doit totaliser le montant de la transaction' });
    }
  }
});

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(20).default('#6366f1'),
});
export const updateTagSchema = createTagSchema.partial();

export const linkRecurringSchema = z.object({
  recurring_transaction_id: z.coerce.number().int().positive().nullable(),
  sync_description: z.coerce.boolean().default(false),
  sync_amount: z.coerce.boolean().default(false),
  sync_category_account: z.coerce.boolean().default(true),
});

export const createBudgetSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  month: monthString,
  amount_limit: amount,
  // Optionnel sans défaut : omis = conserver le flag existant lors d'un upsert.
  recurring: z.coerce.boolean().optional(),
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
  month_of_year: z.coerce.number().int().min(1).max(12).nullish(),
  active: z.coerce.boolean().default(true),
  end_date: dateString.nullish(),
});
export const updateRecurringSchema = createRecurringSchema.partial();

export const createInstitutionSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createCategoryRuleSchema = z.object({
  pattern: z.string().trim().min(1).max(120),
  category_id: z.coerce.number().int().positive(),
});
export const updateCategoryRuleSchema = createCategoryRuleSchema.partial();

export const createSavingsGoalSchema = z.object({
  name: z.string().trim().min(1).max(160),
  target_amount: amount,
  current_amount: z.coerce.number().min(0).default(0).transform(round2),
  deadline: dateString.nullish(),
  color: z.string().trim().min(1).default('#4f46e5'),
  account_id: z.coerce.number().int().positive().nullish(),
});
export const updateSavingsGoalSchema = createSavingsGoalSchema.partial();

export const contributeSavingsGoalSchema = z.object({
  amount,
  date: dateString,
  source_account_id: z.coerce.number().int().positive().nullish(),
  description: z.string().trim().max(500).nullish(),
});

export const withdrawSavingsGoalSchema = z.object({
  amount,
  date: dateString,
  destination_account_id: z.coerce.number().int().positive().nullish(),
  description: z.string().trim().max(500).nullish(),
});

const billShape = z.object({
  name: z.string().trim().min(1).max(160),
  amount_min: amount,
  amount_max: amount,
  start_date: dateString,
  frequency: z.enum(['monthly', 'yearly']),
  interval: z.coerce.number().int().min(1).max(24).default(1),
  pattern: z.string().trim().max(160).nullish(),
  account_id: z.coerce.number().int().positive().nullish(),
  category_id: z.coerce.number().int().positive().nullish(),
  active: z.coerce.boolean().default(true),
});
const billRangeCheck = (data: { amount_min?: number; amount_max?: number }, ctx: z.RefinementCtx) => {
  if (data.amount_min != null && data.amount_max != null && data.amount_min > data.amount_max) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fourchette est inversée : le minimum dépasse le maximum' });
  }
};
export const createBillSchema = billShape.superRefine(billRangeCheck);
export const updateBillSchema = billShape.partial().superRefine(billRangeCheck);

export const createAccountSnapshotSchema = z.object({
  account_id: z.coerce.number().int().positive(),
  date: dateString,
  balance: signedAmount,
});

export const batchAccountSnapshotsSchema = z.object({
  date: dateString,
  balances: z.array(z.object({
    account_id: z.coerce.number().int().positive(),
    balance: signedAmount,
  })).min(1).max(100),
});

export const csvImportSchema = z.object({
  csv: z.string().min(1),
  account_id: z.coerce.number().int().positive().nullish(),
  date_format: z.enum(['auto', 'yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy', 'dd-mm-yyyy', 'yyyymmdd']).default('auto'),
  mapping: z.object({
    date: z.string().min(1),
    amount: z.string().min(1),
    description: z.string().min(1).nullish(),
    type: z.string().min(1).nullish(),
  }).nullish(),
});

export const currencyQuery = currencyCode.default('EUR');

function isValidDateString(value: string): boolean {
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isValidMonthString(value: string): boolean {
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return Number.isInteger(year)
    && Number.isInteger(month)
    && month >= 1
    && month <= 12;
}
