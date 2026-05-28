import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { csvImportSchema, dateString, idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';

export const importExportRouter = Router();

const EXPORT_ENTITIES = [
  'accounts',
  'institutions',
  'categories',
  'category_rules',
  'transactions',
  'budgets',
  'recurring',
  'goals',
  'snapshots',
  'tags',
] as const;
type ExportEntity = (typeof EXPORT_ENTITIES)[number];

const exportSchema = z.object({
  entities: z.array(z.enum(EXPORT_ENTITIES)).min(1).default([...EXPORT_ENTITIES]),
  from: dateString.nullish(),
  to: dateString.nullish(),
});

const importSchema = z.object({
  payload: z.object({
    version: z.number().optional(),
    accounts: z.array(z.any()).optional(),
    institutions: z.array(z.any()).optional(),
    categories: z.array(z.any()).optional(),
    rules: z.array(z.any()).optional(),
    category_rules: z.array(z.any()).optional(),
    transactions: z.array(z.any()).optional(),
    budgets: z.array(z.any()).optional(),
    recurring: z.array(z.any()).optional(),
    goals: z.array(z.any()).optional(),
    snapshots: z.array(z.any()).optional(),
    tags: z.array(z.any()).optional(),
  }),
});

function monthFromDate(value: string): string { return value.slice(0, 7); }

importExportRouter.get('/users/:user_id/export.json', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const payload = await buildExportPayload(user_id, [...EXPORT_ENTITIES], null, null);
  res.setHeader('Content-Disposition', 'attachment; filename="suzanne-export.json"');
  res.json(payload);
}));

importExportRouter.post('/users/:user_id/export', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = exportSchema.parse(req.body);
  const payload = await buildExportPayload(user_id, body.entities, body.from ?? null, body.to ?? null);
  res.setHeader('Content-Disposition', 'attachment; filename="suzanne-export.json"');
  res.json(payload);
}));

importExportRouter.post('/users/:user_id/import.json', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = importSchema.parse(req.body);
  const result = await importPayload(user_id, body.payload);
  res.json(result);
}));

async function buildExportPayload(user_id: number, entities: ExportEntity[], from: string | null, to: string | null) {
  const want = new Set(entities);
  const dateFilter = from || to ? {
    date: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
    },
  } : {};
  const monthFilter = from || to ? {
    month: {
      ...(from ? { gte: monthFromDate(from) } : {}),
      ...(to ? { lte: monthFromDate(to) } : {}),
    },
  } : {};

  const [user, accounts, institutions, categories, rules, transactions, budgets, recurring, goals, snapshots, tags] = await Promise.all([
    prisma.user.findUnique({ where: { id: user_id } }),
    want.has('accounts') ? prisma.account.findMany({ where: { user_id } }) : Promise.resolve([]),
    want.has('institutions') ? prisma.institution.findMany({ where: { user_id } }) : Promise.resolve([]),
    want.has('categories') ? prisma.category.findMany({ where: { user_id } }) : Promise.resolve([]),
    want.has('category_rules') ? prisma.categoryRule.findMany({ where: { user_id } }) : Promise.resolve([]),
    want.has('transactions') ? prisma.transaction.findMany({ where: { user_id, ...dateFilter }, include: { tags: { include: { tag: true } } } }) : Promise.resolve([]),
    want.has('budgets') ? prisma.budget.findMany({ where: { user_id, ...monthFilter } }) : Promise.resolve([]),
    want.has('recurring') ? prisma.recurringTransaction.findMany({ where: { user_id } }) : Promise.resolve([]),
    want.has('goals') ? prisma.savingsGoal.findMany({ where: { user_id } }) : Promise.resolve([]),
    want.has('snapshots') ? prisma.accountSnapshot.findMany({ where: { user_id, ...dateFilter } }) : Promise.resolve([]),
    want.has('tags') ? prisma.tag.findMany({ where: { user_id } }) : Promise.resolve([]),
  ]);

  // Embed tag_ids in each transaction so a restore can reattach them without
  // a separate transaction_tags table in the payload.
  const transactionsOut = transactions.map((tx) => {
    const { tags: joins, ...rest } = tx as typeof tx & { tags?: Array<{ tag: { id: number; name: string } }> };
    return { ...rest, tag_ids: (joins ?? []).map((j) => j.tag.id), tag_names: (joins ?? []).map((j) => j.tag.name) };
  });

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    entities,
    range: { from, to },
    user,
    accounts,
    institutions,
    categories,
    rules,
    transactions: transactionsOut,
    budgets,
    recurring,
    goals,
    snapshots,
    tags,
  };
}

interface ImportSummary {
  institutions: { created: number; reused: number };
  accounts: { created: number; reused: number };
  categories: { created: number; reused: number };
  rules: { created: number; reused: number };
  transactions: { created: number };
  budgets: { created: number; updated: number };
  recurring: { created: number };
  goals: { created: number; reused: number };
  snapshots: { created: number; updated: number };
  tags: { created: number; reused: number };
}

async function importPayload(user_id: number, payload: z.infer<typeof importSchema>['payload']): Promise<ImportSummary> {
  const summary: ImportSummary = {
    institutions: { created: 0, reused: 0 },
    accounts: { created: 0, reused: 0 },
    categories: { created: 0, reused: 0 },
    rules: { created: 0, reused: 0 },
    transactions: { created: 0 },
    budgets: { created: 0, updated: 0 },
    recurring: { created: 0 },
    goals: { created: 0, reused: 0 },
    snapshots: { created: 0, updated: 0 },
    tags: { created: 0, reused: 0 },
  };

  const tagIdMap = new Map<number, number>();
  for (const raw of payload.tags ?? []) {
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const existing = await prisma.tag.findFirst({ where: { user_id, name } });
    if (existing) {
      tagIdMap.set(Number(raw.id), existing.id);
      summary.tags.reused += 1;
    } else {
      const created = await prisma.tag.create({
        data: { user_id, name, color: raw.color ?? '#6366f1' },
      });
      tagIdMap.set(Number(raw.id), created.id);
      summary.tags.created += 1;
    }
  }

  const institutionIdMap = new Map<number, number>();
  for (const raw of payload.institutions ?? []) {
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const existing = await prisma.institution.findFirst({ where: { user_id, name } });
    if (existing) {
      institutionIdMap.set(Number(raw.id), existing.id);
      summary.institutions.reused += 1;
    } else {
      const created = await prisma.institution.create({ data: { user_id, name } });
      institutionIdMap.set(Number(raw.id), created.id);
      summary.institutions.created += 1;
    }
  }

  const accountIdMap = new Map<number, number>();
  for (const raw of payload.accounts ?? []) {
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const existing = await prisma.account.findFirst({ where: { user_id, name } });
    if (existing) {
      accountIdMap.set(Number(raw.id), existing.id);
      summary.accounts.reused += 1;
    } else {
      const created = await prisma.account.create({
        data: {
          user_id,
          institution_id: raw.institution_id ? institutionIdMap.get(Number(raw.institution_id)) ?? null : null,
          name,
          type: raw.type,
          currency: raw.currency ?? 'EUR',
          initial_balance: Number(raw.initial_balance ?? 0),
          initial_balance_date: new Date(raw.initial_balance_date ?? new Date().toISOString().slice(0, 10)),
        },
      });
      accountIdMap.set(Number(raw.id), created.id);
      summary.accounts.created += 1;
    }
  }

  const categoryIdMap = new Map<number, number>();
  for (const raw of payload.categories ?? []) {
    const name = String(raw.name ?? '').trim();
    const type = raw.type;
    if (!name || (type !== 'expense' && type !== 'income')) continue;
    const existing = await prisma.category.findFirst({ where: { user_id, name, type } });
    if (existing) {
      categoryIdMap.set(Number(raw.id), existing.id);
      summary.categories.reused += 1;
    } else {
      const created = await prisma.category.create({
        data: { user_id, name, type, color: raw.color ?? '#6366f1', icon: raw.icon ?? null },
      });
      categoryIdMap.set(Number(raw.id), created.id);
      summary.categories.created += 1;
    }
  }

  for (const raw of payload.rules ?? payload.category_rules ?? []) {
    const pattern = String(raw.pattern ?? '').trim();
    if (!pattern) continue;
    const categoryId = categoryIdMap.get(Number(raw.category_id)) ?? Number(raw.category_id);
    const existing = await prisma.categoryRule.findFirst({ where: { user_id, pattern } });
    if (existing) { summary.rules.reused += 1; continue; }
    if (!(await prisma.category.findFirst({ where: { id: categoryId, user_id } }))) continue;
    await prisma.categoryRule.create({ data: { user_id, pattern, category_id: categoryId } });
    summary.rules.created += 1;
  }

  for (const raw of payload.recurring ?? []) {
    const accountId = raw.account_id ? accountIdMap.get(Number(raw.account_id)) ?? null : null;
    const categoryId = raw.category_id ? categoryIdMap.get(Number(raw.category_id)) ?? null : null;
    await prisma.recurringTransaction.create({
      data: {
        user_id,
        account_id: accountId,
        category_id: categoryId,
        amount: round2(Number(raw.amount ?? 0)),
        type: raw.type ?? 'expense',
        description: String(raw.description ?? '').slice(0, 500),
        frequency: raw.frequency ?? 'monthly',
        interval: Number(raw.interval ?? 1),
        day_of_month: raw.day_of_month ?? null,
        active: raw.active ?? true,
      },
    });
    summary.recurring.created += 1;
  }

  for (const raw of payload.transactions ?? []) {
    const accountId = raw.account_id ? accountIdMap.get(Number(raw.account_id)) ?? null : null;
    const toAccountId = raw.to_account_id ? accountIdMap.get(Number(raw.to_account_id)) ?? null : null;
    const categoryId = raw.category_id ? categoryIdMap.get(Number(raw.category_id)) ?? null : null;
    // Resolve tags by remapped id first (round-trip), then by name (cross-account).
    const tagIds = new Set<number>();
    for (const rawTagId of (raw.tag_ids ?? [])) {
      const mapped = tagIdMap.get(Number(rawTagId));
      if (mapped) tagIds.add(mapped);
    }
    for (const rawName of (raw.tag_names ?? [])) {
      const name = String(rawName ?? '').trim();
      if (!name) continue;
      const tag = await prisma.tag.findFirst({ where: { user_id, name } });
      if (tag) tagIds.add(tag.id);
    }
    await prisma.transaction.create({
      data: {
        user_id,
        account_id: accountId,
        to_account_id: toAccountId,
        category_id: categoryId,
        amount: round2(Number(raw.amount ?? 0)),
        to_amount: raw.to_amount != null ? round2(Number(raw.to_amount)) : null,
        exchange_rate: raw.exchange_rate ?? null,
        type: raw.type ?? 'expense',
        date: new Date(typeof raw.date === 'string' ? raw.date.slice(0, 10) : raw.date),
        description: raw.description ?? null,
        tags: tagIds.size > 0
          ? { create: Array.from(tagIds).map((tag_id) => ({ tag_id })) }
          : undefined,
      },
    });
    summary.transactions.created += 1;
  }

  for (const raw of payload.budgets ?? []) {
    const categoryId = categoryIdMap.get(Number(raw.category_id)) ?? Number(raw.category_id);
    if (!(await prisma.category.findFirst({ where: { id: categoryId, user_id } }))) continue;
    const month = String(raw.month);
    const existing = await prisma.budget.findFirst({ where: { user_id, category_id: categoryId, month } });
    if (existing) {
      await prisma.budget.update({ where: { id: existing.id }, data: { amount_limit: round2(Number(raw.amount_limit ?? 0)) } });
      summary.budgets.updated += 1;
    } else {
      await prisma.budget.create({ data: { user_id, category_id: categoryId, month, amount_limit: round2(Number(raw.amount_limit ?? 0)) } });
      summary.budgets.created += 1;
    }
  }

  for (const raw of payload.goals ?? []) {
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const existing = await prisma.savingsGoal.findFirst({ where: { user_id, name } });
    if (existing) { summary.goals.reused += 1; continue; }
    await prisma.savingsGoal.create({
      data: {
        user_id,
        name,
        target_amount: round2(Number(raw.target_amount ?? 0)),
        current_amount: round2(Number(raw.current_amount ?? 0)),
        deadline: raw.deadline ? new Date(String(raw.deadline).slice(0, 10)) : null,
        color: raw.color ?? '#4f46e5',
      },
    });
    summary.goals.created += 1;
  }

  for (const raw of payload.snapshots ?? []) {
    const accountId = accountIdMap.get(Number(raw.account_id)) ?? null;
    if (!accountId) continue;
    const date = new Date(typeof raw.date === 'string' ? raw.date.slice(0, 10) : raw.date);
    const existing = await prisma.accountSnapshot.findFirst({ where: { account_id: accountId, date } });
    if (existing) {
      await prisma.accountSnapshot.update({ where: { id: existing.id }, data: { balance: round2(Number(raw.balance ?? 0)) } });
      summary.snapshots.updated += 1;
    } else {
      await prisma.accountSnapshot.create({ data: { user_id, account_id: accountId, date, balance: round2(Number(raw.balance ?? 0)) } });
      summary.snapshots.created += 1;
    }
  }

  return summary;
}

importExportRouter.get('/users/:user_id/transactions.csv', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const rows = await prisma.transaction.findMany({ where: { user_id }, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
  const csv = [
    'date,type,amount,description,account_id,category_id',
    ...rows.map((r) => [
      r.date.toISOString().slice(0, 10),
      r.type,
      String(r.amount).replace('.', ','),
      csvCell(r.description ?? ''),
      r.account_id ?? '',
      r.category_id ?? '',
    ].join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(csv);
}));

importExportRouter.post('/users/:user_id/import.csv', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = csvImportSchema.parse(req.body);
  const rules = await prisma.categoryRule.findMany({ where: { user_id } });
  const lines = body.csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const delimiter = detectDelimiter(lines[0] ?? '');
  const headers = splitCsv(lines[0] ?? '', delimiter).map((h) => h.trim());
  const dataLines = lines.slice(1);
  const mapping = resolveMapping(headers, body.mapping ?? null);
  let imported = 0;
  let skipped = 0;
  for (const line of dataLines) {
    const cells = splitCsv(line, delimiter);
    const dateRaw = cell(cells, mapping.date);
    const amountRaw = cell(cells, mapping.amount);
    const descriptionRaw = mapping.description != null ? cell(cells, mapping.description) : '';
    const typeRaw = mapping.type != null ? cell(cells, mapping.type) : undefined;
    const date = parseDate(dateRaw, body.date_format);
    const signedAmount = parseSignedAmount(amountRaw);
    if (!date || signedAmount === null || signedAmount === 0) {
      skipped += 1;
      continue;
    }
    const description = descriptionRaw ?? '';
    const matchedRule = rules.find((r) => description.toUpperCase().includes(r.pattern));
    const type = typeRaw ? normalizeType(typeRaw) : signedAmount > 0 ? 'income' : 'expense';
    await prisma.transaction.create({
      data: {
        user_id,
        account_id: body.account_id ?? null,
        category_id: matchedRule?.category_id ?? null,
        date,
        type,
        amount: round2(Math.abs(signedAmount)),
        description,
      },
    });
    imported += 1;
  }
  res.json({ imported, skipped });
}));

function parseDate(value: string | undefined, format: 'auto' | 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'dd-mm-yyyy' | 'yyyymmdd'): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateString = parseDateString(trimmed, format);
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateString(value: string, format: 'auto' | 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'dd-mm-yyyy' | 'yyyymmdd'): string | null {
  const candidates = format === 'auto'
    ? ['yyyy-mm-dd', 'dd/mm/yyyy', 'dd-mm-yyyy', 'yyyymmdd', 'mm/dd/yyyy'] as const
    : [format] as const;

  for (const candidate of candidates) {
    const parsed = parseDateStringAs(value, candidate);
    if (parsed) return parsed;
  }
  return null;
}

function parseDateStringAs(value: string, format: 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'dd-mm-yyyy' | 'yyyymmdd'): string | null {
  if (format === 'yyyy-mm-dd') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? validDateParts(m[1]!, m[2]!, m[3]!) : null;
  }
  if (format === 'dd/mm/yyyy') {
    const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? validDateParts(m[3]!, m[2]!, m[1]!) : null;
  }
  if (format === 'mm/dd/yyyy') {
    const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? validDateParts(m[3]!, m[1]!, m[2]!) : null;
  }
  if (format === 'dd-mm-yyyy') {
    const m = value.match(/^(\d{2})-(\d{2})-(\d{4})/);
    return m ? validDateParts(m[3]!, m[2]!, m[1]!) : null;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? validDateParts(m[1]!, m[2]!, m[3]!) : null;
}

function validDateParts(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseSignedAmount(value: string | undefined): number | null {
  if (!value) return null;
  const amount = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? round2(amount) : null;
}

function normalizeType(value: string | undefined): 'expense' | 'income' {
  return value?.toLowerCase().includes('income') || value?.toLowerCase().includes('revenu') ? 'income' : 'expense';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function splitCsv(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(header: string): string {
  const delimiters = ['\t', ';', ','];
  return delimiters
    .map((delimiter) => ({ delimiter, count: header.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

function resolveMapping(
  headers: string[],
  mapping: { date?: string; amount?: string; description?: string | null; type?: string | null } | null,
) {
  const byName = new Map(headers.map((header, idx) => [normalizeHeader(header), idx]));
  const find = (names: string[]) => {
    for (const name of names) {
      const idx = byName.get(normalizeHeader(name));
      if (idx != null) return idx;
    }
    return -1;
  };
  const mapped = {
    date: mapping?.date ? find([mapping.date]) : find(['date', 'dateOp', 'dateVal']),
    amount: mapping?.amount ? find([mapping.amount]) : find(['amount', 'montant']),
    description: mapping?.description ? find([mapping.description]) : find(['description', 'label', 'suggestedLabel', 'comment']),
    type: mapping?.type ? find([mapping.type]) : find(['type']),
  };
  if (mapped.date < 0 || mapped.amount < 0) throw new Error('CSV mapping requires date and amount columns');
  return {
    date: mapped.date,
    amount: mapped.amount,
    description: mapped.description >= 0 ? mapped.description : null,
    type: mapped.type >= 0 ? mapped.type : null,
  };
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cell(cells: string[], index: number | null): string | undefined {
  return index == null ? undefined : cells[index];
}
