import { z } from 'zod';
import { prisma } from '../prisma.js';
import { createTransactionSchema, monthString } from '../lib/validation.js';
import { fetchExchangeRate } from '../lib/fx.js';
import { round2 } from '../lib/money.js';

export interface PendingAiAction {
  type: 'create_transaction' | 'update_transaction_category';
  label: string;
  payload: unknown;
}

export interface ToolExecution {
  result: unknown;
  pendingAction?: PendingAiAction;
}

type JsonSchema = Record<string, unknown>;

export const aiToolDefinitions = [
  toolDefinition('list_accounts', 'Liste les comptes de l’utilisateur avec id, nom, type et devise.', {}),
  toolDefinition('list_categories', 'Liste les catégories de l’utilisateur avec id, nom et type.', {}),
  toolDefinition('get_dashboard_summary', 'Retourne le résumé financier d’un mois donné.', {
    month: { type: 'string', description: 'Mois au format YYYY-MM.' },
    currency: { type: 'string', description: 'Devise de reporting, ex: EUR.', default: 'EUR' },
  }, ['month']),
  toolDefinition('search_transactions', 'Recherche des transactions par texte, mois, type ou catégorie.', {
    query: { type: 'string', description: 'Texte à rechercher dans la description.', default: '' },
    month: { type: 'string', description: 'Mois au format YYYY-MM.', default: '' },
    type: { type: 'string', enum: ['expense', 'income', 'transfer'], description: 'Type de transaction.' },
    category_id: { type: 'number', description: 'Identifiant de catégorie.' },
    limit: { type: 'number', description: 'Maximum de lignes, 1 à 30.', default: 10 },
  }),
  toolDefinition('propose_create_transaction', 'Prépare une création de transaction. Ne crée rien sans confirmation utilisateur.', {
    account_id: { type: ['number', 'null'] },
    to_account_id: { type: ['number', 'null'] },
    category_id: { type: ['number', 'null'] },
    amount: { type: 'number' },
    to_amount: { type: ['number', 'null'] },
    type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
    date: { type: 'string', description: 'Date au format YYYY-MM-DD.' },
    description: { type: ['string', 'null'] },
  }, ['amount', 'type', 'date']),
  toolDefinition('propose_update_transaction_category', 'Prépare le changement de catégorie d’une transaction. Ne modifie rien sans confirmation utilisateur.', {
    transaction_id: { type: 'number' },
    category_id: { type: ['number', 'null'] },
  }, ['transaction_id']),
];

export async function executeAiTool(userId: number, name: string, rawArgs: unknown): Promise<ToolExecution> {
  switch (name) {
    case 'list_accounts':
      return { result: await prisma.account.findMany({ where: { user_id: userId }, orderBy: { name: 'asc' } }) };
    case 'list_categories':
      return { result: await prisma.category.findMany({ where: { user_id: userId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }) };
    case 'get_dashboard_summary':
      return { result: await dashboardSummary(userId, rawArgs) };
    case 'search_transactions':
      return { result: await searchTransactions(userId, rawArgs) };
    case 'propose_create_transaction':
      return await proposeCreateTransaction(userId, rawArgs);
    case 'propose_update_transaction_category':
      return await proposeUpdateTransactionCategory(userId, rawArgs);
    default:
      throw new Error(`Tool IA inconnue: ${name}`);
  }
}

export async function confirmAiAction(userId: number, action: PendingAiAction) {
  if (action.type === 'create_transaction') {
    const body = createTransactionSchema.parse(action.payload);
    await assertTransactionReferences(userId, body);
    const transfer = await transferAmounts(userId, body);
    return await prisma.transaction.create({
      data: {
        user_id: userId,
        account_id: body.account_id ?? null,
        to_account_id: body.type === 'transfer' ? body.to_account_id ?? null : null,
        category_id: body.category_id ?? null,
        amount: body.amount,
        to_amount: transfer.toAmount,
        exchange_rate: transfer.exchangeRate,
        type: body.type,
        date: new Date(body.date),
        description: body.description ?? null,
      },
    });
  }
  if (action.type === 'update_transaction_category') {
    const body = z.object({
      transaction_id: z.coerce.number().int().positive(),
      category_id: z.coerce.number().int().positive().nullable(),
    }).parse(action.payload);
    const existing = await prisma.transaction.findFirst({ where: { id: body.transaction_id, user_id: userId } });
    if (!existing) throw new Error('Transaction introuvable');
    return await prisma.transaction.update({ where: { id: body.transaction_id }, data: { category_id: body.category_id } });
  }
  throw new Error('Action IA non supportée');
}

function toolDefinition(name: string, description: string, properties: JsonSchema, required: string[] = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

async function dashboardSummary(userId: number, rawArgs: unknown) {
  const args = z.object({
    month: monthString,
    currency: z.string().trim().min(3).max(3).default('EUR'),
  }).parse(rawArgs);
  const start = new Date(`${args.month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const [transactions, accounts] = await Promise.all([
    prisma.transaction.findMany({ where: { user_id: userId, date: { gte: start, lt: end } } }),
    prisma.account.findMany({ where: { user_id: userId } }),
  ]);
  const income = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  return {
    month: args.month,
    currency: args.currency,
    income,
    expenses,
    net: income - expenses,
    transaction_count: transactions.length,
    unassigned_count: transactions.filter((t) => t.type !== 'transfer' && (!t.account_id || !t.category_id)).length,
    account_count: accounts.length,
  };
}

async function searchTransactions(userId: number, rawArgs: unknown) {
  const args = z.object({
    query: z.string().trim().default(''),
    month: z.string().trim().default(''),
    type: z.enum(['expense', 'income', 'transfer']).optional(),
    category_id: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(30).default(10),
  }).parse(rawArgs);
  const where = {
    user_id: userId,
    ...(args.query ? { description: { contains: args.query, mode: 'insensitive' as const } } : {}),
    ...(args.type ? { type: args.type } : {}),
    ...(args.category_id ? { category_id: args.category_id } : {}),
    ...(args.month ? monthRange(args.month) : {}),
  };
  return await prisma.transaction.findMany({
    where,
    take: args.limit,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: {
      account: { select: { name: true, currency: true } },
      category: { select: { name: true, type: true } },
    },
  });
}

async function proposeCreateTransaction(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createTransactionSchema.parse(rawArgs);
  await assertTransactionReferences(userId, body);
  const label = `${body.type === 'expense' ? 'Créer une dépense' : body.type === 'income' ? 'Créer un revenu' : 'Créer un transfert'} de ${body.amount} le ${body.date}`;
  return {
    result: { ok: true, needs_confirmation: true, label, payload: body },
    pendingAction: { type: 'create_transaction', label, payload: body },
  };
}

async function assertTransactionReferences(
  userId: number,
  body: { account_id?: number | null; to_account_id?: number | null; category_id?: number | null },
) {
  const [account, toAccount, category] = await Promise.all([
    body.account_id ? prisma.account.findFirst({ where: { id: body.account_id, user_id: userId } }) : Promise.resolve(null),
    body.to_account_id ? prisma.account.findFirst({ where: { id: body.to_account_id, user_id: userId } }) : Promise.resolve(null),
    body.category_id ? prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } }) : Promise.resolve(null),
  ]);
  if (body.account_id && !account) throw new Error('Compte source introuvable');
  if (body.to_account_id && !toAccount) throw new Error('Compte destination introuvable');
  if (body.category_id && !category) throw new Error('Catégorie introuvable');
}

async function proposeUpdateTransactionCategory(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({
    transaction_id: z.coerce.number().int().positive(),
    category_id: z.coerce.number().int().positive().nullable(),
  }).parse(rawArgs);
  const [transaction, category] = await Promise.all([
    prisma.transaction.findFirst({ where: { id: body.transaction_id, user_id: userId } }),
    body.category_id ? prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } }) : Promise.resolve(null),
  ]);
  if (!transaction) throw new Error('Transaction introuvable');
  if (body.category_id && !category) throw new Error('Catégorie introuvable');
  const label = `Classer "${transaction.description ?? 'Transaction'}" dans ${category?.name ?? 'Sans catégorie'}`;
  return {
    result: { ok: true, needs_confirmation: true, label, payload: body },
    pendingAction: { type: 'update_transaction_category', label, payload: body },
  };
}

function monthRange(month: string) {
  const parsed = monthString.parse(month);
  const start = new Date(`${parsed}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { date: { gte: start, lt: end } };
}

async function transferAmounts(
  userId: number,
  body: { type?: string; account_id?: number | null; to_account_id?: number | null; amount: number; to_amount?: number | null; date: string },
): Promise<{ toAmount: number | null; exchangeRate: number | null }> {
  if (body.type !== 'transfer' || !body.account_id || !body.to_account_id) return { toAmount: null, exchangeRate: null };
  if (body.to_amount != null) return { toAmount: body.to_amount, exchangeRate: round2(body.to_amount / body.amount) };

  const [from, to] = await Promise.all([
    prisma.account.findFirst({ where: { id: body.account_id, user_id: userId } }),
    prisma.account.findFirst({ where: { id: body.to_account_id, user_id: userId } }),
  ]);
  if (!from || !to) return { toAmount: body.amount, exchangeRate: 1 };
  const quote = await fetchExchangeRate(from.currency, to.currency, body.date);
  return { toAmount: round2(body.amount * quote.rate), exchangeRate: quote.rate };
}
