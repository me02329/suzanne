import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { csvImportSchema, idParam } from '../lib/validation.js';
import { round2 } from '../lib/money.js';

export const importExportRouter = Router();

importExportRouter.get('/users/:user_id/export.json', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const [user, accounts, institutions, categories, rules, transactions, budgets, recurring, goals, snapshots] = await Promise.all([
    prisma.user.findUnique({ where: { id: user_id } }),
    prisma.account.findMany({ where: { user_id } }),
    prisma.institution.findMany({ where: { user_id } }),
    prisma.category.findMany({ where: { user_id } }),
    prisma.categoryRule.findMany({ where: { user_id } }),
    prisma.transaction.findMany({ where: { user_id } }),
    prisma.budget.findMany({ where: { user_id } }),
    prisma.recurringTransaction.findMany({ where: { user_id } }),
    prisma.savingsGoal.findMany({ where: { user_id } }),
    prisma.accountSnapshot.findMany({ where: { user_id } }),
  ]);
  res.setHeader('Content-Disposition', 'attachment; filename="suzanne-export.json"');
  res.json({ user, accounts, institutions, categories, rules, transactions, budgets, recurring, goals, snapshots });
}));

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
