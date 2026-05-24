import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errors.js';
import { csvImportSchema, idParam } from '../lib/validation.js';

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
  const lines = body.csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const [, ...dataLines] = lines;
  let imported = 0;
  for (const line of dataLines) {
    const [dateRaw, typeRaw, amountRaw, descriptionRaw] = splitCsv(line);
    if (!dateRaw || !amountRaw) continue;
    const description = descriptionRaw ?? '';
    const matchedRule = rules.find((r) => description.toUpperCase().includes(r.pattern));
    await prisma.transaction.create({
      data: {
        user_id,
        account_id: body.account_id ?? null,
        category_id: matchedRule?.category_id ?? null,
        date: new Date(dateRaw),
        type: normalizeType(typeRaw),
        amount: Number(amountRaw.replace(',', '.')),
        description,
      },
    });
    imported += 1;
  }
  res.json({ imported });
}));

function normalizeType(value: string | undefined): 'expense' | 'income' {
  return value?.toLowerCase().includes('income') || value?.toLowerCase().includes('revenu') ? 'income' : 'expense';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function splitCsv(line: string): string[] {
  return line.split(',').map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
}
