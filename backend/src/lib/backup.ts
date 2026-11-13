import { z } from 'zod';
import { AccountType, AlertType, AssetClass, type Prisma } from '@prisma/client';
import { prisma, prismaBase } from '../prisma.js';
import { HttpError } from '../middleware/errors.js';
import { round2 } from './money.js';

// Sauvegarde JSON : export complet (ou partiel) d'un utilisateur et import
// idempotent. Utilisé par l'export manuel, l'import JSON et les sauvegardes
// stockées (system.ts).
//
// Garanties de l'import :
// - atomique : tout passe dans une seule transaction SQL, une erreur annule tout ;
// - idempotent : ré-importer le même fichier (ou restaurer une sauvegarde sur le
//   profil qui l'a produite) ne crée aucun doublon. Les entités sont reconnues
//   par clé naturelle (nom, ou contenu complet pour les transactions/ordres) et
//   comptées en multi-ensemble : deux cafés identiques le même jour restent deux ;
// - références robustes : un export partiel (ex. transactions seules) se
//   rattache aux comptes/catégories existants par nom, ou par id quand on
//   ré-importe sur le profil d'origine.

export const BACKUP_FORMAT_VERSION = 2;

export const EXPORT_ENTITIES = [
  'accounts',
  'institutions',
  'categories',
  'category_rules',
  'transactions',
  'budgets',
  'recurring',
  'goals',
  'goal_contributions',
  'bills',
  'snapshots',
  'tags',
  'holdings',
  'alerts',
  'import_mappings',
  'attachments',
] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

const looseArray = z.array(z.any()).optional();
export const backupPayloadSchema = z.object({
  version: z.number().optional(),
  user: z.object({ id: z.number().optional() }).passthrough().nullish(),
  accounts: looseArray,
  institutions: looseArray,
  categories: looseArray,
  rules: looseArray,
  category_rules: looseArray,
  transactions: looseArray,
  budgets: looseArray,
  recurring: looseArray,
  goals: looseArray,
  goal_contributions: looseArray,
  bills: looseArray,
  snapshots: looseArray,
  tags: looseArray,
  holdings: looseArray,
  alerts: looseArray,
  import_mappings: looseArray,
  attachments: looseArray,
}).passthrough();
export type BackupPayload = z.infer<typeof backupPayloadSchema>;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function buildExportPayload(user_id: number, entities: readonly ExportEntity[], from: string | null, to: string | null) {
  const want = new Set(entities);
  const dateRange = from || to ? {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
  } : undefined;
  const monthRange = from || to ? {
    ...(from ? { gte: from.slice(0, 7) } : {}),
    ...(to ? { lte: to.slice(0, 7) } : {}),
  } : undefined;
  const none = Promise.resolve([] as never[]);

  // Les comptes et catégories sont toujours lus (même non exportés) pour
  // embarquer leurs noms dans les références : un export partiel reste ainsi
  // ré-importable sur un autre profil.
  const [user, accountsAll, categoriesAll, institutions, rules, transactions, budgets, recurring, goals, goalContributions, bills, snapshots, tags, holdings, alerts, importMappings] = await Promise.all([
    prisma.user.findUnique({ where: { id: user_id }, select: { id: true, name: true, created_at: true } }),
    prisma.account.findMany({ where: { user_id }, orderBy: { id: 'asc' } }),
    prisma.category.findMany({ where: { user_id }, orderBy: { id: 'asc' } }),
    want.has('institutions') ? prisma.institution.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
    want.has('category_rules') ? prisma.categoryRule.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
    want.has('transactions') ? prisma.transaction.findMany({
      where: { user_id, ...(dateRange ? { date: dateRange } : {}) },
      include: { tags: { include: { tag: true } }, splits: true, refund_allocations_sent: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }) : none,
    want.has('budgets') ? prisma.budget.findMany({ where: { user_id, ...(monthRange ? { month: monthRange } : {}) }, orderBy: { id: 'asc' } }) : none,
    want.has('recurring') ? prisma.recurringTransaction.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
    want.has('goals') ? prisma.savingsGoal.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
    want.has('goal_contributions') ? prisma.goalContribution.findMany({ where: { user_id, ...(dateRange ? { date: dateRange } : {}) }, orderBy: { id: 'asc' } }) : none,
    want.has('bills') ? prisma.bill.findMany({ where: { user_id }, include: { matches: { select: { transaction_id: true } } }, orderBy: { id: 'asc' } }) : none,
    want.has('snapshots') ? prisma.accountSnapshot.findMany({ where: { user_id, ...(dateRange ? { date: dateRange } : {}) }, orderBy: { id: 'asc' } }) : none,
    want.has('tags') ? prisma.tag.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
    want.has('holdings') ? prisma.holding.findMany({ where: { user_id }, include: { orders: { orderBy: [{ date: 'asc' }, { id: 'asc' }] } }, orderBy: { id: 'asc' } }) : none,
    want.has('alerts') ? prisma.alert.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
    want.has('import_mappings') ? prisma.importMapping.findMany({ where: { user_id }, orderBy: { id: 'asc' } }) : none,
  ]);

  const accountName = new Map(accountsAll.map((a) => [a.id, a.name]));
  const categoryRef = new Map(categoriesAll.map((c) => [c.id, { name: c.name, type: c.type }]));
  const refAccount = (id: number | null) => (id != null ? accountName.get(id) ?? null : null);
  const refCategory = (id: number | null) => (id != null ? categoryRef.get(id) ?? null : null);

  // Pièces jointes : seulement celles des transactions exportées (et vivantes).
  const exportedTxIds = transactions.map((t) => t.id);
  const attachments = want.has('attachments') && exportedTxIds.length > 0
    ? await prisma.attachment.findMany({ where: { user_id, transaction_id: { in: exportedTxIds } }, orderBy: { id: 'asc' } })
    : [];

  return {
    app: 'suzanne',
    version: BACKUP_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    entities: [...entities],
    range: { from, to },
    user,
    accounts: want.has('accounts') ? accountsAll.map((a) => ({ ...a, initial_balance_date: day(a.initial_balance_date) })) : [],
    institutions,
    categories: want.has('categories') ? categoriesAll : [],
    rules: rules.map((r) => ({ ...r, category_ref: refCategory(r.category_id) })),
    transactions: transactions.map(({ tags: joins, splits, refund_allocations_sent, ...tx }) => ({
      ...tx,
      date: day(tx.date),
      account_name: refAccount(tx.account_id),
      to_account_name: refAccount(tx.to_account_id),
      category_ref: refCategory(tx.category_id),
      splits: splits.map((s) => ({ category_id: s.category_id, category_ref: refCategory(s.category_id), amount: s.amount, note: s.note })),
      refund_allocations: refund_allocations_sent.map((a) => ({ expense_transaction_id: a.expense_transaction_id, amount: a.amount })),
      tag_ids: joins.map((j) => j.tag.id),
      tag_names: joins.map((j) => j.tag.name),
    })),
    budgets: budgets.map((b) => ({ ...b, category_ref: refCategory(b.category_id) })),
    recurring: recurring.map((r) => ({
      ...r,
      end_date: day(r.end_date),
      last_executed: day(r.last_executed),
      account_name: refAccount(r.account_id),
      category_ref: refCategory(r.category_id),
    })),
    goals: goals.map((g) => ({ ...g, deadline: day(g.deadline), account_name: refAccount(g.account_id) })),
    goal_contributions: goalContributions.map((c) => ({ ...c, date: day(c.date) })),
    bills: bills.map(({ matches, ...b }) => ({
      ...b,
      start_date: day(b.start_date),
      account_name: refAccount(b.account_id),
      category_ref: refCategory(b.category_id),
      matched_transaction_ids: matches.map((m) => m.transaction_id),
    })),
    snapshots: snapshots.map((s) => ({ ...s, date: day(s.date), account_name: refAccount(s.account_id) })),
    tags,
    holdings: holdings.map(({ orders, ...h }) => ({
      ...h,
      account_name: refAccount(h.account_id),
      orders: orders.map((o) => ({ side: o.side, date: day(o.date), quantity: o.quantity, unit_price: o.unit_price, fee: o.fee })),
    })),
    alerts: alerts.map((a) => ({ ...a, account_name: refAccount(a.account_id) })),
    import_mappings: importMappings,
    attachments: attachments.map(({ data, ...a }) => ({ ...a, data_base64: Buffer.from(data).toString('base64') })),
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type Counter = { created: number; reused: number; skipped: number };
const counter = (): Counter => ({ created: 0, reused: 0, skipped: 0 });

export interface ImportSummary {
  institutions: Counter;
  accounts: Counter;
  categories: Counter;
  rules: Counter;
  tags: Counter;
  recurring: Counter;
  transactions: Counter;
  budgets: Counter & { updated: number };
  goals: Counter;
  goal_contributions: Counter;
  bills: Counter;
  bill_matches: Counter;
  snapshots: Counter & { updated: number };
  holdings: Counter;
  holding_orders: Counter;
  alerts: Counter;
  import_mappings: Counter;
  attachments: Counter;
}

const ACCOUNT_TYPES = new Set<string>(Object.values(AccountType));
const ASSET_CLASSES = new Set<string>(Object.values(AssetClass));
const ALERT_TYPES = new Set<string>(Object.values(AlertType));
const TX_TYPES = new Set(['expense', 'income', 'transfer']);
const RECURRING_TYPES = new Set(['expense', 'income']);
const FREQUENCIES = new Set(['weekly', 'monthly', 'yearly']);
const BILL_FREQUENCIES = new Set(['monthly', 'yearly']);
// Pas de SVG (script exécutable) : mêmes types sûrs que l'upload devrait imposer.
const SAFE_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
const DATE_FORMATS = new Set(['auto', 'yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy', 'dd-mm-yyyy', 'yyyymmdd']);

// Date d'import (`YYYY-MM-DD…` ou Date sérialisée) ; null si absente/invalide.
function parseDay(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const s = typeof raw === 'string' ? raw.slice(0, 10) : raw instanceof Date ? raw.toISOString().slice(0, 10) : null;
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}
const num = (raw: unknown, fallback = 0) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const str = (raw: unknown, max: number) => (raw == null ? null : String(raw).slice(0, max));
const name = (raw: unknown) => String(raw ?? '').trim().slice(0, 160);
const normText = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const intOrNull = (raw: unknown) => (raw == null || raw === '' ? null : Number.isInteger(Number(raw)) ? Number(raw) : null);

// Multi-ensemble clé → ids existants : chaque ligne importée « consomme » un
// existant identique avant d'en créer un nouveau.
class MultiIndex {
  private map = new Map<string, number[]>();
  add(key: string, id: number) {
    const list = this.map.get(key);
    if (list) list.push(id); else this.map.set(key, [id]);
  }
  take(key: string): number | undefined {
    return this.map.get(key)?.shift();
  }
}

export async function importPayload(user_id: number, payload: BackupPayload): Promise<ImportSummary> {
  return prismaBase.$transaction(
    (tx) => importInTransaction(tx, user_id, payload),
    { maxWait: 10_000, timeout: 5 * 60_000 },
  );
}

async function importInTransaction(db: Prisma.TransactionClient, user_id: number, payload: BackupPayload): Promise<ImportSummary> {
  const summary: ImportSummary = {
    institutions: counter(), accounts: counter(), categories: counter(), rules: counter(), tags: counter(),
    recurring: counter(), transactions: counter(), budgets: { ...counter(), updated: 0 }, goals: counter(),
    goal_contributions: counter(), bills: counter(), bill_matches: counter(), snapshots: { ...counter(), updated: 0 },
    holdings: counter(), holding_orders: counter(), alerts: counter(), import_mappings: counter(), attachments: counter(),
  };
  // Ré-import sur le profil d'origine : un id non remappé (entité absente de
  // l'export partiel) désigne directement une ligne existante de ce profil.
  const sameUser = payload.user?.id === user_id;

  // --- Référentiels ---------------------------------------------------------
  const tagMap = new Map<number, number>();
  const tagsByName = new Map((await db.tag.findMany({ where: { user_id } })).map((t) => [t.name, t.id]));
  for (const raw of payload.tags ?? []) {
    const n = name(raw.name);
    if (!n) { summary.tags.skipped += 1; continue; }
    let id = tagsByName.get(n);
    if (id) summary.tags.reused += 1;
    else {
      id = (await db.tag.create({ data: { user_id, name: n, color: str(raw.color, 20) ?? '#6366f1' } })).id;
      tagsByName.set(n, id);
      summary.tags.created += 1;
    }
    tagMap.set(num(raw.id, -1), id);
  }

  const institutionMap = new Map<number, number>();
  const institutionsByName = new Map((await db.institution.findMany({ where: { user_id } })).map((i) => [i.name, i.id]));
  for (const raw of payload.institutions ?? []) {
    const n = name(raw.name);
    if (!n) { summary.institutions.skipped += 1; continue; }
    let id = institutionsByName.get(n);
    if (id) summary.institutions.reused += 1;
    else {
      id = (await db.institution.create({ data: { user_id, name: n } })).id;
      institutionsByName.set(n, id);
      summary.institutions.created += 1;
    }
    institutionMap.set(num(raw.id, -1), id);
  }

  const accountMap = new Map<number, number>();
  const existingAccounts = await db.account.findMany({ where: { user_id }, select: { id: true, name: true } });
  const accountsByName = new Map(existingAccounts.map((a) => [a.name, a.id]));
  const ownedAccounts = new Set(existingAccounts.map((a) => a.id));
  for (const raw of payload.accounts ?? []) {
    const n = name(raw.name);
    if (!n) { summary.accounts.skipped += 1; continue; }
    let id = accountsByName.get(n);
    if (id) summary.accounts.reused += 1;
    else {
      const type = String(raw.type ?? '');
      if (!ACCOUNT_TYPES.has(type)) throw new HttpError(400, `Compte « ${n} » : type inconnu (${type || 'vide'})`);
      id = (await db.account.create({
        data: {
          user_id,
          institution_id: raw.institution_id != null ? institutionMap.get(num(raw.institution_id)) ?? null : null,
          name: n,
          type: type as AccountType,
          currency: String(raw.currency ?? 'EUR').toUpperCase().slice(0, 3),
          initial_balance: round2(num(raw.initial_balance)),
          initial_balance_date: parseDay(raw.initial_balance_date) ?? parseDay(new Date().toISOString())!,
          archived: Boolean(raw.archived ?? false),
        },
      })).id;
      accountsByName.set(n, id);
      ownedAccounts.add(id);
      summary.accounts.created += 1;
    }
    accountMap.set(num(raw.id, -1), id);
  }
  const resolveAccount = (rawId: unknown, rawName: unknown): number | null => {
    if (rawId == null && rawName == null) return null;
    const mapped = rawId != null ? accountMap.get(num(rawId, -1)) : undefined;
    if (mapped) return mapped;
    const byName = rawName ? accountsByName.get(name(rawName)) : undefined;
    if (byName) return byName;
    return sameUser && ownedAccounts.has(num(rawId, -1)) ? num(rawId) : null;
  };

  const categoryMap = new Map<number, number>();
  const existingCategories = await db.category.findMany({ where: { user_id }, select: { id: true, name: true, type: true } });
  const categoriesByKey = new Map(existingCategories.map((c) => [`${c.type}|${c.name}`, c.id]));
  const ownedCategories = new Set(existingCategories.map((c) => c.id));
  for (const raw of payload.categories ?? []) {
    const n = name(raw.name);
    const type = raw.type;
    if (!n || (type !== 'expense' && type !== 'income')) { summary.categories.skipped += 1; continue; }
    let id = categoriesByKey.get(`${type}|${n}`);
    if (id) summary.categories.reused += 1;
    else {
      id = (await db.category.create({
        data: { user_id, name: n, type, color: str(raw.color, 20) ?? '#6366f1', icon: str(raw.icon, 40) },
      })).id;
      categoriesByKey.set(`${type}|${n}`, id);
      ownedCategories.add(id);
      summary.categories.created += 1;
    }
    categoryMap.set(num(raw.id, -1), id);
  }
  // Jamais d'id de catégorie étranger : remappé, retrouvé par nom, ou possédé.
  const resolveCategory = (rawId: unknown, ref: unknown): number | null => {
    if (rawId == null) return null;
    const mapped = categoryMap.get(num(rawId, -1));
    if (mapped) return mapped;
    const r = ref as { name?: unknown; type?: unknown } | null | undefined;
    const byName = r?.name ? categoriesByKey.get(`${String(r.type)}|${name(r.name)}`) : undefined;
    if (byName) return byName;
    return sameUser && ownedCategories.has(num(rawId, -1)) ? num(rawId) : null;
  };

  const existingRules = new Set((await db.categoryRule.findMany({ where: { user_id }, select: { pattern: true } })).map((r) => r.pattern));
  for (const raw of payload.rules ?? payload.category_rules ?? []) {
    const pattern = String(raw.pattern ?? '').trim().toUpperCase().slice(0, 160);
    const category_id = resolveCategory(raw.category_id, raw.category_ref);
    if (!pattern || !category_id) { summary.rules.skipped += 1; continue; }
    if (existingRules.has(pattern)) { summary.rules.reused += 1; continue; }
    await db.categoryRule.create({ data: { user_id, pattern, category_id } });
    existingRules.add(pattern);
    summary.rules.created += 1;
  }

  // --- Récurrents -----------------------------------------------------------
  const recurringMap = new Map<number, number>();
  const recurringKey = (r: { account_id: number | null; category_id: number | null; type: string; amount: number; description: string; frequency: string; interval: number; day_of_month: number | null; month_of_year: number | null }) =>
    [r.account_id, r.category_id, r.type, round2(r.amount).toFixed(2), normText(r.description), r.frequency, r.interval, r.day_of_month, r.month_of_year].join('|');
  const recurringIndex = new MultiIndex();
  const existingRecurring = await db.recurringTransaction.findMany({ where: { user_id } });
  const recurringById = new Map(existingRecurring.map((r) => [r.id, r]));
  for (const r of existingRecurring) recurringIndex.add(recurringKey(r), r.id);
  for (const raw of payload.recurring ?? []) {
    const type = String(raw.type ?? 'expense');
    const frequency = String(raw.frequency ?? 'monthly');
    if (!RECURRING_TYPES.has(type) || !FREQUENCIES.has(frequency)) { summary.recurring.skipped += 1; continue; }
    const data = {
      account_id: resolveAccount(raw.account_id, raw.account_name),
      category_id: resolveCategory(raw.category_id, raw.category_ref),
      amount: round2(num(raw.amount)),
      type: type as 'expense' | 'income',
      description: String(raw.description ?? '').slice(0, 500),
      frequency: frequency as 'weekly' | 'monthly' | 'yearly',
      interval: Math.max(1, Math.trunc(num(raw.interval, 1))),
      day_of_month: intOrNull(raw.day_of_month),
      month_of_year: intOrNull(raw.month_of_year),
    };
    const lastExecuted = parseDay(raw.last_executed);
    const existingId = recurringIndex.take(recurringKey(data));
    let id: number;
    if (existingId) {
      id = existingId;
      // Ne jamais reculer last_executed : ça re-générerait des occurrences.
      const current = recurringById.get(existingId)!;
      if (lastExecuted && (!current.last_executed || lastExecuted > current.last_executed)) {
        await db.recurringTransaction.update({ where: { id }, data: { last_executed: lastExecuted } });
      }
      summary.recurring.reused += 1;
    } else {
      id = (await db.recurringTransaction.create({
        data: {
          user_id,
          ...data,
          active: raw.active ?? true,
          end_date: parseDay(raw.end_date),
          last_executed: lastExecuted,
        },
      })).id;
      summary.recurring.created += 1;
    }
    if (raw.id != null) recurringMap.set(num(raw.id), id);
  }

  // --- Transactions ---------------------------------------------------------
  const txKey = (t: { account_id: number | null; to_account_id: number | null; type: string; date: Date; amount: number; description: string | null }) =>
    [t.account_id ?? '-', t.to_account_id ?? '-', t.type, t.date.toISOString().slice(0, 10), round2(t.amount).toFixed(2), normText(t.description)].join('|');
  const txIndex = new MultiIndex();
  const existingTx = await db.transaction.findMany({
    where: { user_id, deleted_at: null },
    select: { id: true, account_id: true, to_account_id: true, type: true, date: true, amount: true, description: true },
  });
  for (const t of existingTx) txIndex.add(txKey(t), t.id);
  const ownedTx = new Set(existingTx.map((t) => t.id));

  const txMap = new Map<number, number>();
  const pendingAllocations: Array<{ refundId: number; oldExpenseId: number; amount: number }> = [];
  const pendingRefundLinks: Array<{ refundId: number; oldTargetId: number }> = [];
  for (const raw of payload.transactions ?? []) {
    const type = String(raw.type ?? 'expense');
    const date = parseDay(raw.date);
    const amount = round2(num(raw.amount));
    if (!TX_TYPES.has(type) || !date || !(amount > 0)) { summary.transactions.skipped += 1; continue; }
    const account_id = resolveAccount(raw.account_id, raw.account_name);
    const to_account_id = type === 'transfer' ? resolveAccount(raw.to_account_id, raw.to_account_name) : null;
    const description = raw.description == null ? null : String(raw.description).slice(0, 500);

    const existingId = txIndex.take(txKey({ account_id, to_account_id, type, date, amount, description }));
    if (existingId) {
      if (raw.id != null) txMap.set(num(raw.id), existingId);
      summary.transactions.reused += 1;
      continue;
    }

    const splits = (Array.isArray(raw.splits) ? raw.splits : [])
      .map((s: { category_id?: unknown; category_ref?: unknown; amount?: unknown; note?: unknown }) => ({
        category_id: resolveCategory(s.category_id, s.category_ref),
        amount: round2(num(s.amount)),
        note: str(s.note, 160),
      }))
      .filter((s: { category_id: number | null; amount: number }): s is { category_id: number; amount: number; note: string | null } => s.category_id != null && s.amount > 0);
    // Même tolérance (±0,01) qu'à la création, et toutes les lignes doivent
    // avoir été résolues — sinon on retombe sur la catégorie simple.
    const rawSplitCount = Array.isArray(raw.splits) ? raw.splits.length : 0;
    const validSplits = splits.length > 0 && splits.length === rawSplitCount
      && Math.abs(round2(splits.reduce((s: number, x: { amount: number }) => s + x.amount, 0)) - amount) <= 0.01;

    const tagIds = new Set<number>();
    for (const rawTag of raw.tag_ids ?? []) { const id = tagMap.get(num(rawTag, -1)); if (id) tagIds.add(id); }
    for (const rawName of raw.tag_names ?? []) { const id = tagsByName.get(name(rawName)); if (id) tagIds.add(id); }

    const recurringRaw = raw.recurring_transaction_id;
    const recurring_transaction_id = recurringRaw == null ? null
      : recurringMap.get(num(recurringRaw)) ?? (sameUser && recurringById.has(num(recurringRaw)) ? num(recurringRaw) : null);

    const created = await db.transaction.create({
      data: {
        user_id,
        account_id,
        to_account_id,
        category_id: validSplits || type === 'transfer' ? null : resolveCategory(raw.category_id, raw.category_ref),
        recurring_transaction_id,
        amount,
        to_amount: raw.to_amount != null ? round2(num(raw.to_amount)) : null,
        exchange_rate: raw.exchange_rate != null && Number.isFinite(Number(raw.exchange_rate)) ? Number(raw.exchange_rate) : null,
        type: type as 'expense' | 'income' | 'transfer',
        date,
        description,
        cleared: Boolean(raw.cleared ?? false),
        tags: tagIds.size > 0 ? { create: Array.from(tagIds).map((tag_id) => ({ tag_id })) } : undefined,
        splits: validSplits ? { create: splits.map((s: { category_id: number; amount: number; note: string | null }) => ({ user_id, ...s })) } : undefined,
      },
    });
    if (raw.id != null) txMap.set(num(raw.id), created.id);
    if (type === 'income') {
      const allocations = Array.isArray(raw.refund_allocations) ? raw.refund_allocations : [];
      for (const a of allocations) {
        const oldExpenseId = num(a.expense_transaction_id, -1);
        const allocAmount = round2(num(a.amount));
        if (oldExpenseId > 0 && allocAmount > 0) pendingAllocations.push({ refundId: created.id, oldExpenseId, amount: allocAmount });
      }
      if (raw.refunds_transaction_id != null) {
        pendingRefundLinks.push({ refundId: created.id, oldTargetId: num(raw.refunds_transaction_id) });
        // Ancien format (v1 sans allocations) : le lien vaut allocation totale.
        if (allocations.length === 0) pendingAllocations.push({ refundId: created.id, oldExpenseId: num(raw.refunds_transaction_id), amount });
      }
    }
    summary.transactions.created += 1;
  }
  const resolveTx = (oldId: number) => txMap.get(oldId) ?? (sameUser && ownedTx.has(oldId) ? oldId : undefined);
  for (const link of pendingRefundLinks) {
    const target = resolveTx(link.oldTargetId);
    if (target) await db.transaction.update({ where: { id: link.refundId }, data: { refunds_transaction_id: target } });
  }
  const allocationRows = pendingAllocations.flatMap((a) => {
    const target = resolveTx(a.oldExpenseId);
    return target ? [{ user_id, refund_transaction_id: a.refundId, expense_transaction_id: target, amount: a.amount }] : [];
  });
  if (allocationRows.length > 0) await db.refundAllocation.createMany({ data: allocationRows, skipDuplicates: true });

  // --- Budgets --------------------------------------------------------------
  for (const raw of payload.budgets ?? []) {
    const category_id = resolveCategory(raw.category_id, raw.category_ref);
    const month = String(raw.month ?? '');
    if (!category_id || !/^\d{4}-\d{2}$/.test(month)) { summary.budgets.skipped += 1; continue; }
    const data = {
      amount_limit: round2(num(raw.amount_limit)),
      recurring: Boolean(raw.recurring ?? false),
      rollover: Boolean(raw.rollover ?? false),
    };
    const existing = await db.budget.findUnique({ where: { user_id_category_id_month: { user_id, category_id, month } } });
    if (existing) {
      await db.budget.update({ where: { id: existing.id }, data });
      summary.budgets.updated += 1;
    } else {
      await db.budget.create({ data: { user_id, category_id, month, ...data } });
      summary.budgets.created += 1;
    }
  }

  // --- Objectifs ------------------------------------------------------------
  const goalMap = new Map<number, number>();
  const existingGoals = await db.savingsGoal.findMany({ where: { user_id }, select: { id: true, name: true } });
  const goalsByName = new Map(existingGoals.map((g) => [g.name, g.id]));
  const ownedGoals = new Set(existingGoals.map((g) => g.id));
  for (const raw of payload.goals ?? []) {
    const n = name(raw.name);
    if (!n) { summary.goals.skipped += 1; continue; }
    let id = goalsByName.get(n);
    if (id) summary.goals.reused += 1;
    else {
      id = (await db.savingsGoal.create({
        data: {
          user_id,
          account_id: resolveAccount(raw.account_id, raw.account_name),
          name: n,
          target_amount: round2(num(raw.target_amount)),
          current_amount: round2(num(raw.current_amount)),
          deadline: parseDay(raw.deadline),
          color: str(raw.color, 20) ?? '#4f46e5',
        },
      })).id;
      goalsByName.set(n, id);
      ownedGoals.add(id);
      summary.goals.created += 1;
    }
    if (raw.id != null) goalMap.set(num(raw.id), id);
  }
  const resolveGoal = (rawId: unknown) => {
    if (rawId == null) return null;
    return goalMap.get(num(rawId, -1)) ?? (sameUser && ownedGoals.has(num(rawId, -1)) ? num(rawId) : null);
  };

  for (const raw of payload.goal_contributions ?? []) {
    const goal_id = resolveGoal(raw.goal_id);
    const date = parseDay(raw.date);
    const amount = round2(num(raw.amount));
    if (!goal_id || !date || !(amount > 0)) { summary.goal_contributions.skipped += 1; continue; }
    const duplicate = await db.goalContribution.findFirst({ where: { user_id, goal_id, date, amount }, select: { id: true } });
    if (duplicate) { summary.goal_contributions.reused += 1; continue; }
    await db.goalContribution.create({
      data: {
        user_id,
        goal_id,
        transaction_id: raw.transaction_id != null ? resolveTx(num(raw.transaction_id)) ?? null : null,
        amount,
        date,
        description: str(raw.description, 500),
      },
    });
    summary.goal_contributions.created += 1;
  }

  // --- Factures attendues (+ rapprochements) --------------------------------
  const billsByName = new Map((await db.bill.findMany({ where: { user_id }, select: { id: true, name: true } })).map((b) => [b.name, b.id]));
  const billMatchRows: Array<{ user_id: number; bill_id: number; transaction_id: number }> = [];
  for (const raw of payload.bills ?? []) {
    const n = name(raw.name);
    const start_date = parseDay(raw.start_date);
    const frequency = String(raw.frequency ?? 'monthly');
    if (!n || !start_date || !BILL_FREQUENCIES.has(frequency)) { summary.bills.skipped += 1; continue; }
    let id = billsByName.get(n);
    if (id) summary.bills.reused += 1;
    else {
      id = (await db.bill.create({
        data: {
          user_id,
          name: n,
          amount_min: round2(num(raw.amount_min)),
          amount_max: round2(num(raw.amount_max)),
          start_date,
          frequency: frequency as 'monthly' | 'yearly',
          interval: Math.max(1, Math.trunc(num(raw.interval, 1))),
          pattern: str(raw.pattern, 160) || null,
          account_id: resolveAccount(raw.account_id, raw.account_name),
          category_id: resolveCategory(raw.category_id, raw.category_ref),
          active: raw.active ?? true,
        },
      })).id;
      billsByName.set(n, id);
      summary.bills.created += 1;
    }
    for (const oldTx of raw.matched_transaction_ids ?? []) {
      const transaction_id = resolveTx(num(oldTx, -1));
      if (transaction_id) billMatchRows.push({ user_id, bill_id: id, transaction_id });
      else summary.bill_matches.skipped += 1;
    }
  }
  if (billMatchRows.length > 0) {
    const { count } = await db.billMatch.createMany({ data: billMatchRows, skipDuplicates: true });
    summary.bill_matches.created += count;
    summary.bill_matches.reused += billMatchRows.length - count;
  }

  // --- Snapshots de solde ---------------------------------------------------
  for (const raw of payload.snapshots ?? []) {
    const account_id = resolveAccount(raw.account_id, raw.account_name);
    const date = parseDay(raw.date);
    if (!account_id || !date) { summary.snapshots.skipped += 1; continue; }
    const balance = round2(num(raw.balance));
    const existing = await db.accountSnapshot.findUnique({ where: { account_id_date: { account_id, date } } });
    if (existing) {
      if (existing.balance !== balance) await db.accountSnapshot.update({ where: { id: existing.id }, data: { balance } });
      summary.snapshots.updated += 1;
    } else {
      await db.accountSnapshot.create({ data: { user_id, account_id, date, balance } });
      summary.snapshots.created += 1;
    }
  }

  // --- Positions et ordres --------------------------------------------------
  for (const raw of payload.holdings ?? []) {
    const account_id = resolveAccount(raw.account_id, raw.account_name);
    const symbol = String(raw.symbol ?? '').trim().toUpperCase().slice(0, 40);
    if (!account_id || !symbol) { summary.holdings.skipped += 1; continue; }
    const asset_class = ASSET_CLASSES.has(String(raw.asset_class)) ? raw.asset_class as AssetClass : 'equity';
    let holding = await db.holding.findUnique({ where: { account_id_symbol: { account_id, symbol } }, include: { orders: true } });
    if (holding) summary.holdings.reused += 1;
    else {
      holding = await db.holding.create({
        data: { user_id, account_id, symbol, name: name(raw.name) || symbol, asset_class, currency: String(raw.currency ?? 'EUR').toUpperCase().slice(0, 3) },
        include: { orders: true },
      });
      summary.holdings.created += 1;
    }
    const orderKey = (o: { side: string; date: Date; quantity: number; unit_price: number; fee: number }) =>
      [o.side, o.date.toISOString().slice(0, 10), o.quantity, o.unit_price, o.fee].join('|');
    const orderIndex = new MultiIndex();
    for (const o of holding.orders) orderIndex.add(orderKey(o), o.id);
    const newOrders: Prisma.HoldingOrderCreateManyInput[] = [];
    for (const o of raw.orders ?? []) {
      const date = parseDay(o.date);
      const side = o.side === 'sell' ? 'sell' : o.side === 'buy' ? 'buy' : null;
      const quantity = num(o.quantity);
      const unit_price = num(o.unit_price);
      const fee = num(o.fee);
      if (!date || !side || !(quantity > 0) || unit_price < 0 || fee < 0) { summary.holding_orders.skipped += 1; continue; }
      if (orderIndex.take(orderKey({ side, date, quantity, unit_price, fee }))) { summary.holding_orders.reused += 1; continue; }
      newOrders.push({ user_id, holding_id: holding.id, side, date, quantity, unit_price, fee });
    }
    if (newOrders.length > 0) await db.holdingOrder.createMany({ data: newOrders });
    summary.holding_orders.created += newOrders.length;
  }

  // --- Alertes --------------------------------------------------------------
  const alertKey = (a: { type: string; account_id: number | null; goal_id: number | null; operator: string | null; threshold: number | null }) =>
    [a.type, a.account_id, a.goal_id, a.operator, a.threshold].join('|');
  const alertIndex = new MultiIndex();
  for (const a of await db.alert.findMany({ where: { user_id } })) alertIndex.add(alertKey(a), a.id);
  for (const raw of payload.alerts ?? []) {
    const type = String(raw.type ?? '');
    if (!ALERT_TYPES.has(type)) { summary.alerts.skipped += 1; continue; }
    const account_id = raw.account_id != null ? resolveAccount(raw.account_id, raw.account_name) : null;
    const goal_id = raw.goal_id != null ? resolveGoal(raw.goal_id) : null;
    // Une alerte dont la cible n'a pas pu être résolue serait orpheline.
    if ((raw.account_id != null && !account_id) || (raw.goal_id != null && !goal_id)) { summary.alerts.skipped += 1; continue; }
    const operator = raw.operator === 'lt' || raw.operator === 'gt' ? raw.operator : null;
    const threshold = raw.threshold != null && Number.isFinite(Number(raw.threshold)) ? Number(raw.threshold) : null;
    const data = { type: type as AlertType, account_id, goal_id, operator, threshold };
    if (alertIndex.take(alertKey(data))) { summary.alerts.reused += 1; continue; }
    await db.alert.create({ data: { user_id, ...data, active: raw.active ?? true } });
    summary.alerts.created += 1;
  }

  // --- Profils d'import CSV -------------------------------------------------
  for (const raw of payload.import_mappings ?? []) {
    const n = name(raw.name);
    const columns = raw.columns;
    if (!n || typeof columns !== 'object' || columns == null || !columns.date || !columns.amount) { summary.import_mappings.skipped += 1; continue; }
    const existing = await db.importMapping.findUnique({ where: { user_id_name: { user_id, name: n } }, select: { id: true } });
    if (existing) { summary.import_mappings.reused += 1; continue; }
    const date_format = DATE_FORMATS.has(String(raw.date_format)) ? String(raw.date_format) : 'auto';
    await db.importMapping.create({ data: { user_id, name: n, date_format, columns } });
    summary.import_mappings.created += 1;
  }

  // --- Pièces jointes -------------------------------------------------------
  for (const raw of payload.attachments ?? []) {
    const transaction_id = resolveTx(num(raw.transaction_id, -1));
    const filename = String(raw.filename ?? '').slice(0, 255);
    const mime_type = String(raw.mime_type ?? '');
    const data = typeof raw.data_base64 === 'string' ? Buffer.from(raw.data_base64, 'base64') : null;
    if (!transaction_id || !filename || !data || data.length === 0 || !SAFE_ATTACHMENT_TYPES.has(mime_type)) {
      summary.attachments.skipped += 1;
      continue;
    }
    const duplicate = await db.attachment.findFirst({ where: { user_id, transaction_id, filename, size: data.length }, select: { id: true } });
    if (duplicate) { summary.attachments.reused += 1; continue; }
    await db.attachment.create({ data: { user_id, transaction_id, filename, mime_type, size: data.length, data } });
    summary.attachments.created += 1;
  }

  return summary;
}
