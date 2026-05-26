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
  const [, ...dataLines] = lines;
  let imported = 0;
  let skipped = 0;
  for (const line of dataLines) {
    const [dateRaw, typeRaw, amountRaw, descriptionRaw] = splitCsv(line);
    const date = parseDate(dateRaw);
    const amount = parseAmount(amountRaw);
    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    const description = descriptionRaw ?? '';
    const matchedRule = rules.find((r) => description.toUpperCase().includes(r.pattern));
    await prisma.transaction.create({
      data: {
        user_id,
        account_id: body.account_id ?? null,
        category_id: matchedRule?.category_id ?? null,
        date,
        type: normalizeType(typeRaw),
        amount,
        description,
      },
    });
    imported += 1;
  }
  res.json({ imported, skipped });
}));

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const amount = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? round2(amount) : null;
}

function normalizeType(value: string | undefined): 'expense' | 'income' {
  return value?.toLowerCase().includes('income') || value?.toLowerCase().includes('revenu') ? 'income' : 'expense';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function splitCsv(line: string): string[] {
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
    } else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}
