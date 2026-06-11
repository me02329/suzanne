export type TransactionType = 'expense' | 'income' | 'transfer';
export type AccountType =
  | 'checking'
  | 'savings'
  | 'livret_a'
  | 'ldds'
  | 'lep'
  | 'pel'
  | 'cel'
  | 'pea'
  | 'securities'
  | 'life_insurance'
  | 'crypto'
  | 'retirement'
  | 'cash'
  | 'credit'
  | 'loan'
  | 'other';
export type CategoryType = 'expense' | 'income';
export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface User {
  id: number;
  name: string;
  created_at: string;
}

export interface Account {
  id: number;
  user_id: number;
  institution_id: number | null;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  initial_balance_date: string;
  created_at: string;
}

export interface Institution {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

export interface Category {
  id: number;
  user_id: number;
  name: string;
  type: CategoryType;
  color: string;
  icon: string | null;
  created_at: string;
}

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface CreateTagBody {
  name: string;
  color?: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  recurring_transaction_id: number | null;
  // Remboursement : id de la dépense que ce revenu rembourse (null sinon).
  refunds_transaction_id: number | null;
  amount: number;
  to_amount: number | null;
  exchange_rate: number | null;
  type: TransactionType;
  date: string;
  description: string | null;
  // Pointage : la ligne a été rapprochée du relevé bancaire.
  cleared: boolean;
  created_at: string;
  tags: Tag[];
  splits: TransactionSplit[];
  refund_allocations: RefundAllocation[];
  // Revenus liés qui remboursent cette dépense (remboursements partiels possibles).
  refunded_by?: Array<{ id: number; amount: number; date: string }>;
  // Aperçu de la dépense remboursée quand ce revenu est un remboursement.
  refunds_transaction?: { id: number; amount: number; date: string; description: string | null } | null;
}

export interface RefundAllocation {
  id: number;
  user_id: number;
  refund_transaction_id: number;
  expense_transaction_id: number;
  amount: number;
  created_at: string;
  expense_transaction?: { id: number; amount: number; date: string; description: string | null } | null;
}

export interface TransactionSplit {
  id: number;
  user_id: number;
  transaction_id: number;
  category_id: number;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface Budget {
  id: number;
  user_id: number;
  category_id: number;
  month: string;
  amount_limit: number;
  recurring: boolean;
  created_at: string;
}

export interface RecurringTransaction {
  id: number;
  user_id: number;
  account_id: number | null;
  category_id: number | null;
  amount: number;
  type: Exclude<TransactionType, 'transfer'>;
  description: string;
  frequency: RecurringFrequency;
  interval: number;
  day_of_month: number | null;
  month_of_year: number | null; // 1-12, only meaningful for yearly recurrences
  active: boolean;
  last_executed: string | null;
  created_at: string;
}

export interface CategoryRule {
  id: number;
  user_id: number;
  pattern: string;
  category_id: number;
  created_at: string;
}

export interface SavingsGoal {
  id: number;
  user_id: number;
  account_id: number | null;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  color: string;
  created_at: string;
}

// Versement enregistré sur un objectif d'épargne (timeline des contributions).
// `transaction_id` pointe le transfert créé quand le versement vient d'un compte.
export interface GoalContribution {
  id: number;
  user_id: number;
  goal_id: number;
  transaction_id: number | null;
  amount: number;
  date: string;
  description: string | null;
  created_at: string;
}

export type BillFrequency = 'monthly' | 'yearly';

// Facture attendue : dépense récurrente à fourchette de montant, rapprochée
// des transactions réelles par motif sur la description.
export interface Bill {
  id: number;
  user_id: number;
  account_id: number | null;
  category_id: number | null;
  name: string;
  amount_min: number;
  amount_max: number;
  // Première échéance attendue : ancre la répétition (mois de départ + jour).
  start_date: string;
  frequency: BillFrequency;
  interval: number;
  // Motif de rapprochement (contains, insensible à la casse). Vide = le nom.
  pattern: string | null;
  active: boolean;
  created_at: string;
}

export interface CreateBillBody {
  name: string;
  amount_min: number;
  amount_max: number;
  start_date: string;
  frequency: BillFrequency;
  interval?: number;
  pattern?: string | null;
  account_id?: number | null;
  category_id?: number | null;
  active?: boolean;
}

export type BillMonthStatus = 'paid' | 'paid_out_of_range' | 'pending' | 'late' | 'not_due';

export interface BillStatusEntry {
  bill: Bill;
  // La facture est-elle attendue sur le mois demandé (cadence) ?
  due: boolean;
  expected_date: string | null;
  status: BillMonthStatus;
  paid_amount: number;
  // null tant que rien n'est payé sur le mois.
  in_range: boolean | null;
  matched_transactions: Array<{ id: number; amount: number; date: string; description: string | null }>;
}

export interface BillsStatusSummary {
  month: string;
  due_count: number;
  paid_count: number;
  // Milieu de fourchette cumulé des factures dues du mois (payées ou non).
  expected_total: number;
  paid_total: number;
  bills: BillStatusEntry[];
}

export interface AccountSnapshot {
  id: number;
  user_id: number;
  account_id: number;
  date: string;
  balance: number;
  created_at: string;
}

export interface CreateAccountBody {
  institution_id?: number | null;
  name: string;
  type: AccountType;
  currency: string;
  initial_balance: number;
  initial_balance_date: string;
}

export interface CreateInstitutionBody {
  name: string;
}

export interface CreateCategoryBody {
  name: string;
  type: CategoryType;
  color: string;
  icon?: string | null;
}

export interface CreateTransactionBody {
  account_id?: number | null;
  to_account_id?: number | null;
  category_id?: number | null;
  amount: number;
  to_amount?: number | null;
  type: TransactionType;
  date: string;
  description?: string | null;
  cleared?: boolean;
  tag_ids?: number[];
  splits?: CreateTransactionSplitBody[];
  refund_allocations?: CreateRefundAllocationBody[];
  // Réservé aux revenus : id de la dépense remboursée.
  refunds_transaction_id?: number | null;
}

export interface CreateRefundAllocationBody {
  expense_transaction_id: number;
  amount: number;
}

export interface CreateTransactionSplitBody {
  category_id: number;
  amount: number;
  note?: string | null;
}

// Somme déjà remboursée sur une dépense (via les revenus liés).
export function refundedAmount(t: Pick<Transaction, 'refunded_by'>): number {
  return Math.round((t.refunded_by ?? []).reduce((s, r) => s + r.amount, 0) * 100) / 100;
}

export interface CreateBudgetBody {
  category_id: number;
  month: string;
  amount_limit: number;
  recurring?: boolean;
}

export interface CreateRecurringBody {
  account_id?: number | null;
  category_id?: number | null;
  amount: number;
  type: Exclude<TransactionType, 'transfer'>;
  description: string;
  frequency: RecurringFrequency;
  interval?: number;
  day_of_month?: number | null;
  month_of_year?: number | null;
  active?: boolean;
}

export interface CreateCategoryRuleBody {
  pattern: string;
  category_id: number;
}

export interface CreateSavingsGoalBody {
  name: string;
  target_amount: number;
  current_amount?: number;
  deadline?: string | null;
  color: string;
  account_id?: number | null;
}

export interface ContributeSavingsGoalBody {
  amount: number;
  date: string;
  source_account_id?: number | null;
  description?: string | null;
}

export interface CreateAccountSnapshotBody {
  account_id: number;
  date: string;
  balance: number;
}

export interface SearchResult {
  type: 'transaction' | 'category' | 'account' | 'goal';
  id: number;
  title: string;
  subtitle: string;
}

export interface AiPendingAction {
  type: string;
  label: string;
  payload: unknown;
}

export interface AiChatResponse {
  answer: string;
  pendingActions: AiPendingAction[];
}

export interface AiConfirmResponse {
  ok: true;
  result: unknown;
}

export interface DashboardSummary {
  month: string;
  currency: string;
  exchange_rates: Record<string, number>;
  // Currencies whose rate could not be refreshed (stale or 1 fallback used).
  fx_degraded: string[];
  income: number;
  expenses: number;
  net: number;
  balance: number;
  balance_assets: number;
  balance_liabilities: number;
  net_worth: number;
  unassigned_balance: number;
  unassigned_count: number;
  account_balances: Array<{
    account_id: number;
    name: string;
    type: AccountType;
    currency: string;
    type_label: string;
    group: string;
    group_label: string;
    balance: number;
    signed_balance: number;
    is_liability: boolean;
  }>;
  balance_by_group: Array<{
    group: string;
    label: string;
    amount: number;
    signed_amount: number;
    is_liability: boolean;
  }>;
  expenses_by_category: Array<{ category_id: number | null; name: string; color: string; amount: number }>;
  monthly_cashflow: Array<{ month: string; income: number; expenses: number; expenses_signed: number; net: number; cumulative_net: number }>;
  yearly_cashflow: Array<{ year: string; income: number; expenses: number; net: number }>;
}

export interface WealthHistoryPoint {
  date: string;
  currency: string;
  assets: number;
  liabilities: number;
  net_worth: number;
  by_group: Record<string, number>;
  by_account: Record<number, number>;
}

export type StatisticsRange = '3m' | '6m' | '1y' | '2y' | 'all';

export interface StatisticsSummary {
  range: StatisticsRange;
  currency: string;
  from: string;
  to: string;
  exclude_uncategorized: boolean;
  total_expenses: number;
  total_categorized: number;
  total_uncategorized: number;
  transactions_count: number;
  by_category: Array<{ category_id: number | null; name: string; color: string; amount: number; transactions_count: number }>;
  by_merchant: Array<{ description: string; amount: number; transactions_count: number }>;
  monthly: Array<{ month: string; amount: number }>;
}

// ---------------------------------------------------------------------------
// Account taxonomy: source of truth pour les types/groupes de comptes,
// utilisée par le backend (calcul de soldes, search) et le frontend (forms,
// dashboard, alertes). Ne pas dupliquer ailleurs.
// ---------------------------------------------------------------------------

export type AccountGroup = 'cash' | 'regulated_savings' | 'investments' | 'crypto' | 'liabilities' | 'other';

export const ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string; group: AccountGroup }> = [
  { value: 'checking', label: 'Compte courant', group: 'cash' },
  { value: 'cash', label: 'Espèces', group: 'cash' },
  { value: 'savings', label: 'Épargne', group: 'regulated_savings' },
  { value: 'livret_a', label: 'Livret A', group: 'regulated_savings' },
  { value: 'ldds', label: 'LDDS', group: 'regulated_savings' },
  { value: 'lep', label: 'LEP', group: 'regulated_savings' },
  { value: 'pel', label: 'PEL', group: 'regulated_savings' },
  { value: 'cel', label: 'CEL', group: 'regulated_savings' },
  { value: 'pea', label: 'PEA', group: 'investments' },
  { value: 'securities', label: 'Compte-titres', group: 'investments' },
  { value: 'life_insurance', label: 'Assurance-vie', group: 'investments' },
  { value: 'retirement', label: 'Retraite', group: 'investments' },
  { value: 'crypto', label: 'Crypto', group: 'crypto' },
  { value: 'credit', label: 'Carte / crédit', group: 'liabilities' },
  { value: 'loan', label: 'Emprunt', group: 'liabilities' },
  { value: 'other', label: 'Autre', group: 'other' },
];

export const ACCOUNT_GROUPS: ReadonlyArray<{ value: AccountGroup; label: string; color: string }> = [
  { value: 'cash', label: 'Liquidités', color: '#2563eb' },
  { value: 'regulated_savings', label: 'Livrets', color: '#10b981' },
  { value: 'investments', label: 'Investissements', color: '#7c3aed' },
  { value: 'crypto', label: 'Crypto', color: '#f59e0b' },
  { value: 'liabilities', label: 'Passifs', color: '#dc2626' },
  { value: 'other', label: 'Autres', color: '#64748b' },
];

const ACCOUNT_TYPE_INDEX = new Map(ACCOUNT_TYPES.map((entry) => [entry.value, entry]));
const ACCOUNT_GROUP_INDEX = new Map(ACCOUNT_GROUPS.map((entry) => [entry.value, entry]));

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_INDEX.get(type)?.label ?? type;
}

export function accountTypeGroup(type: AccountType): AccountGroup {
  return ACCOUNT_TYPE_INDEX.get(type)?.group ?? 'other';
}

export function accountGroupLabel(group: string): string {
  return ACCOUNT_GROUP_INDEX.get(group as AccountGroup)?.label ?? group;
}

export function accountGroupColor(group: string): string {
  return ACCOUNT_GROUP_INDEX.get(group as AccountGroup)?.color ?? '#64748b';
}

export const LIVRET_CEILINGS: Partial<Record<AccountType, number>> = {
  livret_a: 22950,
  ldds: 12000,
  lep: 10000,
};

export const REPORT_CURRENCIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'JPY', label: 'JPY - Yen japonais' },
  { value: 'USD', label: 'USD - Dollar US' },
  { value: 'GBP', label: 'GBP - Livre sterling' },
  { value: 'CHF', label: 'CHF - Franc suisse' },
  { value: 'CAD', label: 'CAD - Dollar canadien' },
  { value: 'AUD', label: 'AUD - Dollar australien' },
];

// ── Récurrents : calculs partagés frontend/backend ──

type RecurrenceShape = Pick<
  RecurringTransaction,
  'frequency' | 'interval' | 'day_of_month' | 'month_of_year' | 'last_executed'
>;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysInMonthYM(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Avance `date` de `months` mois en clampant le jour au `day` souhaité (sans
// déborder sur le mois suivant si le mois est plus court).
function addMonthsClamped(date: Date, months: number, day: number): Date {
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(year, month, Math.min(day, daysInMonthYM(year, month))));
}

/**
 * Prochaine occurrence prévue d'un récurrent, en `YYYY-MM-DD` (UTC).
 *
 * On renvoie la première date planifiée strictement postérieure à la dernière
 * exécution connue **et** à aujourd'hui — c'est-à-dire la prochaine échéance à
 * venir, pas une échéance déjà en retard. `null` si la fréquence est inconnue.
 */
export function nextRecurringOccurrence(
  recurring: RecurrenceShape,
  from: Date = new Date(),
): string | null {
  const step = Math.max(1, recurring.interval || 1);
  const today = startOfUtcDay(from);
  const last = recurring.last_executed ? startOfUtcDay(new Date(recurring.last_executed)) : null;
  // L'occurrence doit tomber après aujourd'hui et après la dernière exécution.
  const ref = last && last > today ? last : today;

  if (recurring.frequency === 'weekly') {
    const stepDays = 7 * step;
    let cursor = last ? new Date(last) : new Date(today);
    do {
      cursor.setUTCDate(cursor.getUTCDate() + stepDays);
    } while (cursor <= ref);
    return cursor.toISOString().slice(0, 10);
  }

  if (recurring.frequency === 'monthly' || recurring.frequency === 'yearly') {
    const monthStep = recurring.frequency === 'yearly' ? 12 * step : step;
    const day = recurring.day_of_month ?? 1;
    // For a yearly recurrence with a chosen month, anchor the occurrence on that
    // month (e.g. "every March") instead of the month it happened to be created
    // in. We anchor in the reference year (or last_executed's year for the step
    // cadence) and let the loop below carry it forward by whole years.
    const anchorMonth =
      recurring.frequency === 'yearly' && recurring.month_of_year != null
        ? recurring.month_of_year - 1
        : null;
    let cursor: Date;
    if (anchorMonth != null) {
      const baseYear = (last ?? ref).getUTCFullYear();
      cursor = new Date(Date.UTC(baseYear, anchorMonth, Math.min(day, daysInMonthYM(baseYear, anchorMonth))));
    } else {
      cursor = last
        ? addMonthsClamped(last, monthStep, day)
        : new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(),
            Math.min(day, daysInMonthYM(ref.getUTCFullYear(), ref.getUTCMonth()))));
    }
    while (cursor <= ref) cursor = addMonthsClamped(cursor, monthStep, day);
    return cursor.toISOString().slice(0, 10);
  }

  return null;
}

/** Coût/revenu mensuel moyen équivalent d'un récurrent (magnitude, signe ignoré). */
export function recurringMonthlyEquivalent(
  recurring: Pick<RecurringTransaction, 'amount' | 'frequency' | 'interval'>,
): number {
  const step = Math.max(1, recurring.interval || 1);
  const perMonth =
    recurring.frequency === 'weekly' ? 52 / 12 / step
    : recurring.frequency === 'yearly' ? 1 / 12 / step
    : 1 / step;
  return Math.round(recurring.amount * perMonth * 100) / 100;
}
