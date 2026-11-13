import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, prismaBase } from '../prisma.js';
import {
  contributeSavingsGoalSchema,
  createBudgetSchema,
  createCategorySchema,
  createCategoryRuleSchema,
  createRecurringSchema,
  createSavingsGoalSchema,
  createTagSchema,
  createTransactionSchema,
  monthString,
  updateCategorySchema,
  updateRecurringSchema,
  updateSavingsGoalSchema,
  updateTagSchema,
  updateTransactionSchema,
} from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { bucketByRule } from '../lib/categoryRules.js';
import { HttpError } from '../middleware/errors.js';
import { assertAccountOwned, assertCategoryOwned, resolveTagIds } from '../lib/transactionHelpers.js';
import {
  buildLines,
  categoryTypeLookup,
  LEDGER_TX_SELECT,
  legacyView,
  LINES_ORDERED,
  linesCreateData,
  mergeLegacy,
  patchTouchesLines,
  txFlows,
  type LegacyInput,
} from '../lib/ledger.js';
import { serializeTransaction, transactionInclude } from '../routes/transactions.js';
import { nextRecurringOccurrence, recurringMonthlyEquivalent } from '@suzanne/shared';

// The AI proposes a write action; the user confirms it from the chat UI.
// `type` drives the dispatch in confirmAiAction. Keeping payload as `unknown`
// lets us reuse the existing Zod schemas on confirm so the AI can't bypass
// any backend invariant.
export interface PendingAiAction {
  type: string;
  label: string;
  payload: unknown;
}

export interface ToolExecution {
  result: unknown;
  pendingAction?: PendingAiAction;
}

type JsonSchema = Record<string, unknown>;

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

const idProp = { type: 'number' } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const nullableString = { type: ['string', 'null'] } as const;

export const aiToolDefinitions = [
  // ── Read ──
  toolDefinition('list_accounts', 'Liste les comptes (id, nom, type, devise, solde initial).', {}),
  toolDefinition('list_categories', 'Liste les catégories (id, nom, type, couleur).', {}),
  toolDefinition('list_tags', 'Liste les tags (id, nom, couleur).', {}),
  toolDefinition('list_recurring', 'Liste les transactions récurrentes avec leur prochaine occurrence prévue et leur coût mensuel équivalent.', {}),
  toolDefinition('list_goals', 'Liste les objectifs d\'épargne avec progression (%, restant, échéance, compte lié).', {}),
  toolDefinition('get_goal_progress', 'Détail de progression d\'un objectif d\'épargne par son nom.', {
    name: { type: 'string', description: 'Nom (ou fragment) de l\'objectif.' },
  }, ['name']),
  toolDefinition('list_budgets', 'Liste les budgets mensuels.', { month: { type: 'string', description: 'Mois YYYY-MM (optionnel).' } }),
  toolDefinition('list_rules', 'Liste les règles d\'auto-catégorisation.', {}),
  toolDefinition('list_account_snapshots', 'Liste les snapshots de solde par compte.', {
    account_id: { type: 'number' },
    from: { type: 'string', description: 'Date YYYY-MM-DD optionnelle.' },
    to: { type: 'string', description: 'Date YYYY-MM-DD optionnelle.' },
    limit: { type: 'number', description: 'Maximum 100.', default: 50 },
  }),
  toolDefinition('get_dashboard_summary', 'Résumé financier d\'un mois.', {
    month: { type: 'string', description: 'Mois YYYY-MM.' },
    currency: { type: 'string', description: 'Devise reporting.', default: 'EUR' },
  }, ['month']),
  toolDefinition('search_transactions', 'Recherche des transactions.', {
    query: { type: 'string', default: '' },
    month: { type: 'string', default: '' },
    type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
    category_id: { type: 'number' },
    uncategorized: { type: 'boolean', description: 'true pour trouver les revenus/dépenses sans catégorie.' },
    tag_id: { type: 'number' },
    from: { type: 'string', description: 'Date YYYY-MM-DD optionnelle.' },
    to: { type: 'string', description: 'Date YYYY-MM-DD optionnelle.' },
    limit: { type: 'number', description: 'Maximum 100.', default: 10 },
  }),

  // ── Write : transactions ──
  toolDefinition('propose_create_transaction', 'Prépare une création de transaction (confirmation requise).', {
    account_id: nullableNumber,
    to_account_id: nullableNumber,
    category_id: nullableNumber,
    amount: idProp,
    to_amount: nullableNumber,
    type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    description: nullableString,
    tag_ids: { type: 'array', items: { type: 'number' } },
  }, ['amount', 'type', 'date']),
  toolDefinition('propose_update_transaction', 'Prépare la modification d\'une transaction (confirmation requise).', {
    transaction_id: idProp,
    account_id: nullableNumber,
    to_account_id: nullableNumber,
    category_id: nullableNumber,
    amount: { type: 'number' },
    type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
    date: { type: 'string' },
    description: nullableString,
    tag_ids: { type: 'array', items: { type: 'number' } },
  }, ['transaction_id']),
  toolDefinition('propose_delete_transaction', 'Prépare la suppression d\'une transaction (confirmation requise).', {
    transaction_id: idProp,
  }, ['transaction_id']),

  // ── Write : categories ──
  toolDefinition('propose_create_category', 'Prépare la création d\'une catégorie.', {
    name: { type: 'string' },
    type: { type: 'string', enum: ['expense', 'income'] },
    color: { type: 'string', description: 'Hex #RRGGBB.', default: '#6366f1' },
    icon: nullableString,
  }, ['name', 'type']),
  toolDefinition('propose_update_category', 'Prépare la modification d\'une catégorie.', {
    category_id: idProp,
    name: { type: 'string' },
    type: { type: 'string', enum: ['expense', 'income'] },
    color: { type: 'string' },
    icon: nullableString,
  }, ['category_id']),
  toolDefinition('propose_delete_category', 'Prépare la suppression d\'une catégorie.', {
    category_id: idProp,
  }, ['category_id']),

  // ── Write : tags ──
  toolDefinition('propose_create_tag', 'Prépare la création d\'un tag.', {
    name: { type: 'string' },
    color: { type: 'string', default: '#6366f1' },
  }, ['name']),
  toolDefinition('propose_update_tag', 'Prépare la modification d\'un tag.', {
    tag_id: idProp,
    name: { type: 'string' },
    color: { type: 'string' },
  }, ['tag_id']),
  toolDefinition('propose_delete_tag', 'Prépare la suppression d\'un tag.', {
    tag_id: idProp,
  }, ['tag_id']),

  // ── Write : goals ──
  toolDefinition('propose_create_goal', 'Prépare la création d\'un objectif d\'épargne.', {
    name: { type: 'string' },
    target_amount: { type: 'number' },
    current_amount: { type: 'number', default: 0 },
    deadline: nullableString,
    color: { type: 'string', default: '#4f46e5' },
    account_id: nullableNumber,
  }, ['name', 'target_amount']),
  toolDefinition('propose_update_goal', 'Prépare la modification d\'un objectif.', {
    goal_id: idProp,
    name: { type: 'string' },
    target_amount: { type: 'number' },
    current_amount: { type: 'number' },
    deadline: nullableString,
    color: { type: 'string' },
    account_id: nullableNumber,
  }, ['goal_id']),
  toolDefinition('propose_delete_goal', 'Prépare la suppression d\'un objectif.', {
    goal_id: idProp,
  }, ['goal_id']),
  toolDefinition('propose_contribute_goal', 'Prépare un versement sur un objectif (transfert + bump du compteur).', {
    goal_id: idProp,
    amount: { type: 'number' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    source_account_id: nullableNumber,
    description: nullableString,
  }, ['goal_id', 'amount', 'date']),

  // ── Write : recurring ──
  toolDefinition('propose_create_recurring', 'Prépare la création d\'une transaction récurrente.', {
    description: { type: 'string' },
    type: { type: 'string', enum: ['expense', 'income'] },
    amount: { type: 'number' },
    frequency: { type: 'string', enum: ['weekly', 'monthly', 'yearly'] },
    interval: { type: 'number', default: 1 },
    day_of_month: nullableNumber,
    month_of_year: { type: ['number', 'null'], description: 'Mois (1-12) pour une récurrence annuelle, ex. 3 = mars.' },
    account_id: nullableNumber,
    category_id: nullableNumber,
    active: { type: 'boolean', default: true },
  }, ['description', 'type', 'amount', 'frequency']),
  toolDefinition('propose_update_recurring', 'Prépare la modification d\'une transaction récurrente.', {
    recurring_id: idProp,
    description: { type: 'string' },
    type: { type: 'string', enum: ['expense', 'income'] },
    amount: { type: 'number' },
    frequency: { type: 'string', enum: ['weekly', 'monthly', 'yearly'] },
    interval: { type: 'number' },
    day_of_month: nullableNumber,
    month_of_year: { type: ['number', 'null'], description: 'Mois (1-12) pour une récurrence annuelle, ex. 3 = mars.' },
    account_id: nullableNumber,
    category_id: nullableNumber,
    active: { type: 'boolean' },
  }, ['recurring_id']),
  toolDefinition('propose_delete_recurring', 'Prépare la suppression d\'une transaction récurrente.', {
    recurring_id: idProp,
  }, ['recurring_id']),

  // ── Write : budgets ──
  toolDefinition('propose_set_budget', 'Prépare la définition/modification d\'un budget mensuel.', {
    category_id: idProp,
    month: { type: 'string', description: 'YYYY-MM' },
    amount_limit: { type: 'number' },
  }, ['category_id', 'month', 'amount_limit']),
  toolDefinition('propose_delete_budget', 'Prépare la suppression d\'un budget.', {
    budget_id: idProp,
  }, ['budget_id']),

  // ── Write : rules ──
  toolDefinition('propose_create_rule', 'Prépare la création d\'une règle d\'auto-catégorisation.', {
    pattern: { type: 'string', description: 'Mot-clé recherché dans les descriptions (UPPERCASE).' },
    category_id: idProp,
  }, ['pattern', 'category_id']),
  toolDefinition('propose_create_rules', 'Prépare la création de PLUSIEURS règles d\'auto-catégorisation ET leur application immédiate aux transactions sans catégorie. À privilégier pour catégoriser un backlog en masse (une entrée par marchand récurrent) au lieu de modifier les transactions une par une.', {
    rules: {
      type: 'array',
      description: 'Une règle par marchand : motif (mot-clé UPPERCASE présent dans les libellés) → catégorie.',
      items: {
        type: 'object',
        properties: { pattern: { type: 'string' }, category_id: { type: 'number' } },
        required: ['pattern', 'category_id'],
        additionalProperties: false,
      },
    },
  }, ['rules']),
  toolDefinition('propose_delete_rule', 'Prépare la suppression d\'une règle.', {
    rule_id: idProp,
  }, ['rule_id']),
];

export async function executeAiTool(userId: number, name: string, rawArgs: unknown): Promise<ToolExecution> {
  switch (name) {
    // Read
    case 'list_accounts': return { result: await prisma.account.findMany({ where: { user_id: userId }, orderBy: { name: 'asc' } }) };
    case 'list_categories': return { result: await prisma.category.findMany({ where: { user_id: userId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }) };
    case 'list_tags': return { result: await prisma.tag.findMany({ where: { user_id: userId }, orderBy: { name: 'asc' } }) };
    case 'list_recurring': return { result: await listRecurring(userId) };
    case 'list_goals': return { result: await listGoals(userId) };
    case 'get_goal_progress': return { result: await getGoalProgress(userId, rawArgs) };
    case 'list_budgets': {
      const args = z.object({ month: monthString.optional() }).parse(rawArgs);
      return { result: await prisma.budget.findMany({ where: { user_id: userId, ...(args.month ? { month: args.month } : {}) }, orderBy: [{ month: 'desc' }] }) };
    }
    case 'list_rules': return { result: await prisma.categoryRule.findMany({ where: { user_id: userId }, orderBy: { pattern: 'asc' } }) };
    case 'list_account_snapshots': return { result: await listAccountSnapshots(userId, rawArgs) };
    case 'get_dashboard_summary': return { result: await dashboardSummary(userId, rawArgs) };
    case 'search_transactions': return { result: await searchTransactions(userId, rawArgs) };

    // Write — propose only
    case 'propose_create_transaction': return await proposeCreateTransaction(userId, rawArgs);
    case 'propose_update_transaction': return await proposeUpdateTransaction(userId, rawArgs);
    case 'propose_delete_transaction': return await proposeDeleteTransaction(userId, rawArgs);

    case 'propose_create_category': return await proposeCreateCategory(rawArgs);
    case 'propose_update_category': return await proposeUpdateCategory(userId, rawArgs);
    case 'propose_delete_category': return await proposeDeleteCategory(userId, rawArgs);

    case 'propose_create_tag': return await proposeCreateTag(rawArgs);
    case 'propose_update_tag': return await proposeUpdateTag(userId, rawArgs);
    case 'propose_delete_tag': return await proposeDeleteTag(userId, rawArgs);

    case 'propose_create_goal': return await proposeCreateGoal(userId, rawArgs);
    case 'propose_update_goal': return await proposeUpdateGoal(userId, rawArgs);
    case 'propose_delete_goal': return await proposeDeleteGoal(userId, rawArgs);
    case 'propose_contribute_goal': return await proposeContributeGoal(userId, rawArgs);

    case 'propose_create_recurring': return await proposeCreateRecurring(userId, rawArgs);
    case 'propose_update_recurring': return await proposeUpdateRecurring(userId, rawArgs);
    case 'propose_delete_recurring': return await proposeDeleteRecurring(userId, rawArgs);

    case 'propose_set_budget': return await proposeSetBudget(userId, rawArgs);
    case 'propose_delete_budget': return await proposeDeleteBudget(userId, rawArgs);

    case 'propose_create_rule': return await proposeCreateRule(userId, rawArgs);
    case 'propose_create_rules': return await proposeCreateRules(userId, rawArgs);
    case 'propose_delete_rule': return await proposeDeleteRule(userId, rawArgs);

    default:
      throw new Error(`Tool IA inconnue: ${name}`);
  }
}

export async function confirmAiAction(userId: number, action: PendingAiAction) {
  switch (action.type) {
    case 'create_transaction': {
      const body = createTransactionSchema.parse(normalizeModelBooleans(action.payload));
      return serializeTransaction(await createTransactionFromLegacy(userId, body));
    }
    case 'update_transaction_category': {
      const body = z.object({
        transaction_id: z.coerce.number().int().positive(),
        category_id: z.coerce.number().int().positive().nullable(),
      }).parse(action.payload);
      // La catégorie doit appartenir à l'utilisateur (buildLines le revérifie).
      if (body.category_id != null) await assertCategoryOwned(userId, body.category_id);
      return serializeTransaction(await updateTransactionFromLegacy(userId, body.transaction_id, { category_id: body.category_id }));
    }
    case 'update_transaction': {
      const body = z.object({ transaction_id: z.coerce.number().int().positive() })
        .and(updateTransactionSchema)
        .parse(normalizeModelBooleans(action.payload));
      const { transaction_id, ...patch } = body;
      return serializeTransaction(await updateTransactionFromLegacy(userId, transaction_id, patch));
    }
    case 'delete_transaction': {
      const id = idOnly('transaction_id').parse(action.payload);
      // Soft-delete (corbeille restaurable), comme la route REST. Un mouvement
      // issu d'un ordre de bourse se supprime via l'ordre.
      const result = await prismaBase.transaction.updateMany({
        where: { id, user_id: userId, deleted_at: null, kind: { not: 'trade' } },
        data: { deleted_at: new Date() },
      });
      if (result.count === 0) throw new HttpError(404, 'Transaction introuvable');
      return { deleted: true, count: result.count };
    }

    case 'create_category': {
      const body = createCategorySchema.parse(action.payload);
      return await prisma.category.create({ data: { user_id: userId, name: body.name, type: body.type, color: body.color, icon: body.icon ?? null } });
    }
    case 'update_category': {
      const body = z.object({ category_id: z.coerce.number().int().positive() }).and(updateCategorySchema).parse(action.payload);
      const existing = await prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } });
      if (!existing) throw new Error('Catégorie introuvable');
      return await prisma.category.update({
        where: { id: body.category_id },
        data: {
          ...(body.name != null ? { name: body.name } : {}),
          ...(body.type != null ? { type: body.type } : {}),
          ...(body.color != null ? { color: body.color } : {}),
          ...(body.icon !== undefined ? { icon: body.icon ?? null } : {}),
        },
      });
    }
    case 'delete_category': {
      const id = idOnly('category_id').parse(action.payload);
      return await prisma.category.deleteMany({ where: { id, user_id: userId } });
    }

    case 'create_tag': {
      const body = createTagSchema.parse(action.payload);
      return await prisma.tag.create({ data: { user_id: userId, name: body.name, color: body.color } });
    }
    case 'update_tag': {
      const body = z.object({ tag_id: z.coerce.number().int().positive() }).and(updateTagSchema).parse(action.payload);
      const existing = await prisma.tag.findFirst({ where: { id: body.tag_id, user_id: userId } });
      if (!existing) throw new Error('Tag introuvable');
      return await prisma.tag.update({
        where: { id: body.tag_id },
        data: {
          ...(body.name != null ? { name: body.name } : {}),
          ...(body.color != null ? { color: body.color } : {}),
        },
      });
    }
    case 'delete_tag': {
      const id = idOnly('tag_id').parse(action.payload);
      return await prisma.tag.deleteMany({ where: { id, user_id: userId } });
    }

    case 'create_goal': {
      const body = createSavingsGoalSchema.parse(action.payload);
      if (body.account_id) await assertAccountOwned(userId, body.account_id, 'Compte lié');
      return await prisma.savingsGoal.create({
        data: {
          user_id: userId,
          name: body.name,
          target_amount: body.target_amount,
          current_amount: body.current_amount,
          deadline: body.deadline ? new Date(body.deadline) : null,
          color: body.color,
          account_id: body.account_id ?? null,
        },
      });
    }
    case 'update_goal': {
      const body = z.object({ goal_id: z.coerce.number().int().positive() }).and(updateSavingsGoalSchema).parse(action.payload);
      const existing = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id: userId } });
      if (!existing) throw new Error('Objectif introuvable');
      if (body.account_id) await assertAccountOwned(userId, body.account_id, 'Compte lié');
      return await prisma.savingsGoal.update({
        where: { id: body.goal_id },
        data: {
          ...(body.name != null ? { name: body.name } : {}),
          ...(body.target_amount != null ? { target_amount: body.target_amount } : {}),
          ...(body.current_amount != null ? { current_amount: body.current_amount } : {}),
          ...(body.deadline !== undefined ? { deadline: body.deadline ? new Date(body.deadline) : null } : {}),
          ...(body.color != null ? { color: body.color } : {}),
          ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
        },
      });
    }
    case 'delete_goal': {
      const id = idOnly('goal_id').parse(action.payload);
      return await prisma.savingsGoal.deleteMany({ where: { id, user_id: userId } });
    }
    case 'contribute_goal': {
      const body = z.object({ goal_id: z.coerce.number().int().positive() }).and(contributeSavingsGoalSchema).parse(action.payload);
      const goal = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id: userId } });
      if (!goal) throw new Error('Objectif introuvable');
      if (body.source_account_id) await assertAccountOwned(userId, body.source_account_id, 'Compte source');
      // Miroir de POST /savings-goals/:id/contribute : virement optionnel
      // (source → compte de l'objectif, lignes via buildLines qui vérifie les
      // comptes et refuse source = destination), trace GoalContribution et
      // bump du compteur dans une même transaction DB.
      const description = body.description?.trim() || null;
      const built = body.source_account_id && goal.account_id
        ? await buildLines(prisma, userId, {
            type: 'transfer',
            amount: body.amount,
            account_id: body.source_account_id,
            to_account_id: goal.account_id,
            date: body.date,
          })
        : null;
      return await prisma.$transaction(async (tx) => {
        const transfer = built
          ? await tx.transaction.create({
              data: {
                user_id: userId,
                kind: built.kind,
                refunds_transaction_id: built.refunds_transaction_id,
                date: new Date(body.date),
                description: description || `Versement objectif: ${goal.name}`,
                lines: { create: linesCreateData(userId, built) },
              },
              select: { id: true },
            })
          : null;
        await tx.goalContribution.create({
          data: {
            user_id: userId,
            goal_id: goal.id,
            transaction_id: transfer?.id ?? null,
            amount: round2(body.amount),
            date: new Date(body.date),
            description,
          },
        });
        const updated = await tx.savingsGoal.update({
          where: { id: goal.id },
          data: { current_amount: round2(goal.current_amount + body.amount) },
        });
        return { goal: updated, transaction_id: transfer?.id ?? null };
      });
    }

    case 'create_recurring': {
      const body = createRecurringSchema.parse(normalizeModelBooleans(action.payload));
      if (body.account_id) await assertAccountOwned(userId, body.account_id);
      if (body.category_id) await assertCategoryOwned(userId, body.category_id);
      return await prisma.recurringTransaction.create({
        data: {
          user_id: userId,
          account_id: body.account_id ?? null,
          category_id: body.category_id ?? null,
          amount: body.amount,
          type: body.type,
          description: body.description,
          frequency: body.frequency,
          interval: body.interval,
          day_of_month: body.day_of_month ?? null,
          month_of_year: body.month_of_year ?? null,
          active: body.active,
        },
      });
    }
    case 'update_recurring': {
      const body = z.object({ recurring_id: z.coerce.number().int().positive() }).and(updateRecurringSchema).parse(normalizeModelBooleans(action.payload));
      const existing = await prisma.recurringTransaction.findFirst({ where: { id: body.recurring_id, user_id: userId } });
      if (!existing) throw new Error('Récurrent introuvable');
      if (body.account_id) await assertAccountOwned(userId, body.account_id);
      if (body.category_id) await assertCategoryOwned(userId, body.category_id);
      return await prisma.recurringTransaction.update({
        where: { id: body.recurring_id },
        data: {
          ...(body.account_id !== undefined ? { account_id: body.account_id ?? null } : {}),
          ...(body.category_id !== undefined ? { category_id: body.category_id ?? null } : {}),
          ...(body.amount != null ? { amount: body.amount } : {}),
          ...(body.type != null ? { type: body.type } : {}),
          ...(body.description != null ? { description: body.description } : {}),
          ...(body.frequency != null ? { frequency: body.frequency } : {}),
          ...(body.interval != null ? { interval: body.interval } : {}),
          ...(body.day_of_month !== undefined ? { day_of_month: body.day_of_month ?? null } : {}),
          ...(body.month_of_year !== undefined ? { month_of_year: body.month_of_year ?? null } : {}),
          ...(body.active != null ? { active: body.active } : {}),
        },
      });
    }
    case 'delete_recurring': {
      const id = idOnly('recurring_id').parse(action.payload);
      return await prisma.recurringTransaction.deleteMany({ where: { id, user_id: userId } });
    }

    case 'set_budget': {
      const body = createBudgetSchema.parse(normalizeModelBooleans(action.payload));
      await assertCategoryOwned(userId, body.category_id);
      const existing = await prisma.budget.findFirst({ where: { user_id: userId, category_id: body.category_id, month: body.month } });
      if (existing) return await prisma.budget.update({ where: { id: existing.id }, data: { amount_limit: body.amount_limit, recurring: body.recurring } });
      return await prisma.budget.create({
        data: {
          user_id: userId,
          category_id: body.category_id,
          month: body.month,
          amount_limit: body.amount_limit,
          recurring: body.recurring,
        },
      });
    }
    case 'delete_budget': {
      const id = idOnly('budget_id').parse(action.payload);
      return await prisma.budget.deleteMany({ where: { id, user_id: userId } });
    }

    case 'create_rule': {
      const body = createCategoryRuleSchema.parse(action.payload);
      await assertCategoryOwned(userId, body.category_id);
      // Le matching suppose des patterns UPPERCASE (cf. routes/rules.ts et
      // categoryRules.ts) — une règle en minuscules ne matcherait jamais.
      const pattern = body.pattern.toUpperCase();
      return await prisma.categoryRule.upsert({
        where: { user_id_pattern: { user_id: userId, pattern } },
        create: { user_id: userId, pattern, category_id: body.category_id },
        update: { category_id: body.category_id },
      });
    }
    case 'apply_rules': {
      const body = createRulesSchema.parse(action.payload);
      // Re-validate the categories at confirmation time (the route schema is
      // permissive; this is where invariants are enforced).
      const categoryIds = Array.from(new Set(body.rules.map((r) => r.category_id)));
      const owned = await prisma.category.findMany({ where: { id: { in: categoryIds }, user_id: userId }, select: { id: true } });
      const ownedIds = new Set(owned.map((c) => c.id));
      for (const r of body.rules) {
        if (!ownedIds.has(r.category_id)) throw new Error('Catégorie introuvable');
      }
      for (const r of body.rules) {
        const pattern = r.pattern.toUpperCase();
        await prisma.categoryRule.upsert({
          where: { user_id_pattern: { user_id: userId, pattern } },
          create: { user_id: userId, pattern, category_id: r.category_id },
          update: { category_id: r.category_id },
        });
      }
      const result = await applyRulesToUncategorizedLines(userId);
      return { rules_created: body.rules.length, ...result };
    }
    case 'delete_rule': {
      const id = idOnly('rule_id').parse(action.payload);
      return await prisma.categoryRule.deleteMany({ where: { id, user_id: userId } });
    }

    default:
      throw new Error(`Action IA non supportée: ${action.type}`);
  }
}

function idOnly(field: string) {
  return z.object({ [field]: z.coerce.number().int().positive() }).transform((value) => (value as Record<string, number>)[field]!);
}

// ── Booléens fournis par le modèle ──
// z.coerce.boolean() (utilisé par les schémas partagés) transforme la chaîne
// 'false' en true. Le modèle envoie parfois des booléens en chaîne : on les
// normalise AVANT le parse ('false'/'0'/'' → false, 'true'/'1' → true).
const MODEL_BOOLEAN_KEYS = ['cleared', 'active', 'recurring', 'rollover', 'uncategorized'] as const;

export function parseModelBoolean(value: unknown): unknown {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === '') return false;
    if (v === 'true' || v === '1') return true;
  }
  if (typeof value === 'number') return value !== 0;
  return value;
}

export function normalizeModelBooleans(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of MODEL_BOOLEAN_KEYS) {
    if (key in out && out[key] != null) out[key] = parseModelBoolean(out[key]);
  }
  return out;
}

const modelBoolean = z.preprocess(parseModelBoolean, z.boolean());

// ── Écritures d'opérations (miroir de routes/transactions.ts) ──

type CreateTransactionBody = z.infer<typeof createTransactionSchema>;
type UpdateTransactionPatch = Partial<LegacyInput> & {
  date?: string;
  description?: string | null;
  cleared?: boolean;
  tag_ids?: number[];
};

async function createTransactionFromLegacy(userId: number, body: CreateTransactionBody) {
  const built = await buildLines(prisma, userId, body as LegacyInput);
  const tagIds = await resolveTagIds(userId, body.tag_ids);
  return await prisma.transaction.create({
    data: {
      user_id: userId,
      kind: built.kind,
      refunds_transaction_id: built.refunds_transaction_id,
      date: new Date(body.date),
      description: body.description ?? null,
      cleared: body.cleared ?? false,
      lines: { create: linesCreateData(userId, built) },
      tags: { create: tagIds.map((tag_id) => ({ tag_id })) },
    },
    include: transactionInclude,
  });
}

async function findEditableTransaction(userId: number, id: number) {
  const existing = await prisma.transaction.findFirst({ where: { id, user_id: userId }, include: { lines: LINES_ORDERED } });
  if (!existing) throw new HttpError(404, 'Transaction introuvable');
  if (existing.kind === 'trade') throw new HttpError(400, 'Ce mouvement provient d\'un ordre de bourse : modifie l\'ordre');
  return existing;
}

async function updateTransactionFromLegacy(userId: number, id: number, patch: UpdateTransactionPatch) {
  const existing = await findEditableTransaction(userId, id);
  // Lignes reconstruites (avec toutes les gardes de buildLines) seulement si
  // la modification touche aux montants / comptes / catégories.
  const built = patchTouchesLines(patch) ? await buildLines(prisma, userId, mergeLegacy(existing, patch), id) : null;
  const tagIds = patch.tag_ids !== undefined ? await resolveTagIds(userId, patch.tag_ids) : null;
  return await prisma.$transaction(async (tx) => {
    if (built) {
      await tx.transactionLine.deleteMany({ where: { transaction_id: id } });
      await tx.transactionLine.createMany({ data: linesCreateData(userId, built).map((l) => ({ ...l, transaction_id: id })) });
    }
    if (tagIds) {
      await tx.transactionTag.deleteMany({ where: { transaction_id: id } });
      if (tagIds.length > 0) await tx.transactionTag.createMany({ data: tagIds.map((tag_id) => ({ transaction_id: id, tag_id })) });
    }
    return tx.transaction.update({
      where: { id },
      data: {
        ...(built ? { kind: built.kind, refunds_transaction_id: built.refunds_transaction_id } : {}),
        ...(patch.date != null ? { date: new Date(patch.date) } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.cleared != null ? { cleared: patch.cleared } : {}),
      },
      include: transactionInclude,
    });
  });
}

// Opérations « non catégorisées » éligibles aux règles : dépense/revenu à
// une seule ligne sans catégorie (une opération ventilée garde sa ventilation,
// comme le bulk-update). Version locale, sur le modèle à lignes, de
// applyRulesToUncategorized.
const UNCATEGORIZED_RULE_TARGET = {
  kind: 'standard',
  lines: { some: { category_id: null }, every: { category_id: null } },
} satisfies Prisma.TransactionWhereInput;

async function uncategorizedSingleLine(userId: number) {
  const rows = await prisma.transaction.findMany({
    where: { user_id: userId, ...UNCATEGORIZED_RULE_TARGET },
    select: { id: true, description: true, lines: { select: { id: true } } },
  });
  return rows.filter((r) => r.lines.length === 1);
}

async function applyRulesToUncategorizedLines(userId: number): Promise<{ categorized: number; scanned: number }> {
  const [rules, categories, uncategorized] = await Promise.all([
    prisma.categoryRule.findMany({ where: { user_id: userId }, orderBy: { pattern: 'asc' } }),
    prisma.category.findMany({ where: { user_id: userId }, select: { id: true } }),
    uncategorizedSingleLine(userId),
  ]);
  const validCategory = new Set(categories.map((c) => c.id));
  const activeRules = rules.filter((r) => validCategory.has(r.category_id));
  const lineByTx = new Map(uncategorized.map((t) => [t.id, t.lines[0]!.id]));
  let categorized = 0;
  for (const [category_id, ids] of bucketByRule(uncategorized, activeRules)) {
    const result = await prisma.transactionLine.updateMany({
      where: { id: { in: ids.map((id) => lineByTx.get(id)!) }, user_id: userId, category_id: null },
      data: { category_id },
    });
    categorized += result.count;
  }
  return { categorized, scanned: uncategorized.length };
}

async function listRecurring(userId: number) {
  const rows = await prisma.recurringTransaction.findMany({
    where: { user_id: userId },
    orderBy: { description: 'asc' },
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  const now = new Date();
  return rows.map((row) => ({
    ...row,
    last_executed: row.last_executed ? row.last_executed.toISOString().slice(0, 10) : null,
    next_occurrence: row.active
      ? nextRecurringOccurrence(
          {
            frequency: row.frequency as 'weekly' | 'monthly' | 'yearly',
            interval: row.interval,
            day_of_month: row.day_of_month,
            month_of_year: row.month_of_year,
            last_executed: row.last_executed ? row.last_executed.toISOString() : null,
          },
          now,
        )
      : null,
    monthly_equivalent: round2(
      recurringMonthlyEquivalent({
        amount: row.amount,
        frequency: row.frequency as 'weekly' | 'monthly' | 'yearly',
        interval: row.interval,
      }),
    ),
    account_name: row.account?.name ?? null,
    category_name: row.category?.name ?? null,
  }));
}

function goalProgress(goal: { target_amount: number; current_amount: number }) {
  const remaining = round2(Math.max(goal.target_amount - goal.current_amount, 0));
  const progress_pct = goal.target_amount > 0
    ? Math.round((goal.current_amount / goal.target_amount) * 1000) / 10
    : 0;
  return { remaining, progress_pct };
}

async function listGoals(userId: number) {
  const rows = await prisma.savingsGoal.findMany({
    where: { user_id: userId },
    orderBy: { name: 'asc' },
    include: { account: { select: { name: true } } },
  });
  return rows.map((goal) => ({
    ...goal,
    deadline: goal.deadline ? goal.deadline.toISOString().slice(0, 10) : null,
    ...goalProgress(goal),
    account_name: goal.account?.name ?? null,
  }));
}

async function getGoalProgress(userId: number, rawArgs: unknown) {
  const args = z.object({ name: z.string().trim().min(1) }).parse(rawArgs);
  const goal = await prisma.savingsGoal.findFirst({
    where: { user_id: userId, name: { contains: args.name, mode: 'insensitive' } },
    orderBy: { name: 'asc' },
    include: { account: { select: { name: true } } },
  });
  if (!goal) throw new Error(`Aucun objectif ne correspond à "${args.name}"`);
  return {
    ...goal,
    deadline: goal.deadline ? goal.deadline.toISOString().slice(0, 10) : null,
    ...goalProgress(goal),
    account_name: goal.account?.name ?? null,
  };
}

async function dashboardSummary(userId: number, rawArgs: unknown) {
  const args = z.object({
    month: monthString,
    currency: z.string().trim().min(3).max(3).default('EUR'),
  }).parse(rawArgs);
  const start = new Date(`${args.month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const [transactions, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: { user_id: userId, date: { gte: start, lt: end } },
      select: LEDGER_TX_SELECT,
    }),
    prisma.account.findMany({ where: { user_id: userId }, select: { id: true } }),
    prisma.category.findMany({ where: { user_id: userId }, select: { id: true, type: true } }),
  ]);
  // Dépensé / reçu via txFlows : un remboursement réduit la dépense, les
  // virements / mouvements de bourse / ajustements sont exclus.
  // NB : comme avant le passage aux lignes, aucune conversion de devise n'est
  // faite (montants sommés dans la devise de chaque compte) ; `currency` n'est
  // qu'une étiquette. Le dashboard REST, lui, convertit.
  const categoryType = categoryTypeLookup(categories);
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    for (const flow of txFlows(tx, categoryType)) {
      if (flow.side === 'income') income += flow.value;
      else expenses += flow.value;
    }
  }
  income = round2(income);
  expenses = round2(expenses);
  return {
    month: args.month,
    currency: args.currency,
    income,
    expenses,
    net: round2(income - expenses),
    transaction_count: transactions.length,
    unassigned_count: transactions.filter((t) => t.kind === 'standard'
      && (t.lines.length === 0 || t.lines.some((l) => l.account_id == null || (l.category_id == null && !l.refund)))).length,
    account_count: accounts.length,
  };
}

async function listAccountSnapshots(userId: number, rawArgs: unknown) {
  const args = z.object({
    account_id: z.coerce.number().int().positive().optional(),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).default(50).transform((value) => Math.min(value, 100)),
  }).parse(rawArgs);
  const range = dateRange(args.from, args.to);
  return await prisma.accountSnapshot.findMany({
    where: {
      user_id: userId,
      ...(args.account_id ? { account_id: args.account_id } : {}),
      ...(range ? { date: range } : {}),
    },
    take: args.limit,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: { account: { select: { name: true, type: true, currency: true } } },
  });
}

type DateRange = { gte?: Date; lte?: Date; lt?: Date };

// Pure, exported for unit testing. Le genre se filtre en SQL (virement =
// kind transfer, dépense/revenu = kind standard) ; la distinction dépense /
// revenu se fait ensuite sur la vue dérivée des lignes (cf. searchTransactions).
// `uncategorized` cible les dépenses/revenus ayant une ligne sans catégorie et
// ne remplace pas un filtre de type explicite.
export function buildSearchTransactionsWhere(
  userId: number,
  args: {
    query?: string;
    type?: 'expense' | 'income' | 'transfer';
    category_id?: number;
    uncategorized?: boolean;
    tag_id?: number;
  },
  range: DateRange | null,
): Prisma.TransactionWhereInput {
  const lineFilters: Prisma.TransactionWhereInput[] = [];
  if (args.category_id) lineFilters.push({ lines: { some: { category_id: args.category_id } } });
  if (args.uncategorized) lineFilters.push({ lines: { some: { category_id: null } } });
  return {
    user_id: userId,
    ...(args.query ? { description: { contains: args.query, mode: 'insensitive' as const } } : {}),
    ...(args.type === 'transfer'
      ? { kind: 'transfer' as const }
      : args.type || args.uncategorized ? { kind: 'standard' as const } : {}),
    ...(lineFilters.length > 0 ? { AND: lineFilters } : {}),
    ...(args.tag_id ? { tags: { some: { tag_id: args.tag_id } } } : {}),
    ...(range ? { date: range } : {}),
  };
}

async function searchTransactions(userId: number, rawArgs: unknown) {
  const args = z.object({
    query: z.string().trim().default(''),
    month: z.string().trim().default(''),
    type: z.enum(['expense', 'income', 'transfer']).optional(),
    category_id: z.coerce.number().int().positive().optional(),
    uncategorized: modelBoolean.optional(),
    tag_id: z.coerce.number().int().positive().optional(),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).default(10).transform((value) => Math.min(value, 100)),
  }).parse(rawArgs);
  const month = parseMonth(args.month);
  const range = month ? monthRange(month) : dateRange(args.from, args.to);
  const where = buildSearchTransactionsWhere(userId, args, range);
  const sideFilter = args.type === 'expense' || args.type === 'income' ? args.type : null;
  // Return the total alongside the page so the model knows when the result is
  // truncated (has_more) instead of assuming it has seen everything.
  // Filtre dépense/revenu sur la vue dérivée : pas de LIMIT/COUNT SQL dans ce cas.
  const [count, rows, accounts, categories] = await Promise.all([
    sideFilter ? Promise.resolve(0) : prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      ...(sideFilter ? {} : { take: args.limit }),
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: transactionInclude,
    }),
    prisma.account.findMany({ where: { user_id: userId }, select: { id: true, name: true, currency: true } }),
    prisma.category.findMany({ where: { user_id: userId }, select: { id: true, name: true, type: true } }),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, { name: a.name, currency: a.currency }]));
  const categoryById = new Map(categories.map((c) => [c.id, { name: c.name, type: c.type }]));
  let serialized = rows.map(serializeTransaction);
  if (sideFilter) serialized = serialized.filter((t) => t.type === sideFilter);
  const total = sideFilter ? serialized.length : count;
  const transactions = serialized.slice(0, args.limit).map((t) => ({
    ...t,
    account: t.account_id != null ? accountById.get(t.account_id) ?? null : null,
    to_account: t.to_account_id != null ? accountById.get(t.to_account_id) ?? null : null,
    category: t.category_id != null ? categoryById.get(t.category_id) ?? null : null,
  }));
  return { total, returned: transactions.length, has_more: total > transactions.length, transactions };
}

// ── propose_* helpers ──

function propose(type: string, label: string, payload: unknown): ToolExecution {
  return {
    result: { ok: true, needs_confirmation: true, label, payload },
    pendingAction: { type, label, payload },
  };
}

async function proposeCreateTransaction(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createTransactionSchema.parse(normalizeModelBooleans(rawArgs));
  // Validation à blanc (références possédées, virement, ventilation,
  // remboursement) : l'erreur remonte au modèle dès la proposition.
  await buildLines(prisma, userId, body as LegacyInput);
  const label = `${body.type === 'expense' ? 'Créer une dépense' : body.type === 'income' ? 'Créer un revenu' : 'Créer un transfert'} de ${body.amount} le ${body.date}`;
  return propose('create_transaction', label, body);
}

async function proposeUpdateTransaction(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const baseSchema = z.object({ transaction_id: z.coerce.number().int().positive() }).and(updateTransactionSchema);
  const body = baseSchema.parse(normalizeModelBooleans(rawArgs));
  const existing = await findEditableTransaction(userId, body.transaction_id);
  const { transaction_id, ...patch } = body;
  if (patchTouchesLines(patch as Partial<LegacyInput>)) {
    await buildLines(prisma, userId, mergeLegacy(existing, patch as Partial<LegacyInput>), transaction_id);
  }
  const label = `Modifier la transaction "${existing.description ?? `#${existing.id}`}" du ${existing.date.toISOString().slice(0, 10)}`;
  return propose('update_transaction', label, body);
}

async function proposeDeleteTransaction(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ transaction_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await findEditableTransaction(userId, body.transaction_id);
  const view = legacyView(existing);
  return propose('delete_transaction', `Supprimer la transaction "${existing.description ?? `#${existing.id}`}" (${view.amount}) du ${existing.date.toISOString().slice(0, 10)}`, body);
}

async function proposeCreateCategory(rawArgs: unknown): Promise<ToolExecution> {
  const body = createCategorySchema.parse(rawArgs);
  return propose('create_category', `Créer la catégorie "${body.name}" (${body.type})`, body);
}

async function proposeUpdateCategory(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ category_id: z.coerce.number().int().positive() }).and(updateCategorySchema).parse(rawArgs);
  const existing = await prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } });
  if (!existing) throw new Error('Catégorie introuvable');
  return propose('update_category', `Modifier la catégorie "${existing.name}"`, body);
}

async function proposeDeleteCategory(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ category_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } });
  if (!existing) throw new Error('Catégorie introuvable');
  return propose('delete_category', `Supprimer la catégorie "${existing.name}"`, body);
}

async function proposeCreateTag(rawArgs: unknown): Promise<ToolExecution> {
  const body = createTagSchema.parse(rawArgs);
  return propose('create_tag', `Créer le tag "${body.name}"`, body);
}

async function proposeUpdateTag(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ tag_id: z.coerce.number().int().positive() }).and(updateTagSchema).parse(rawArgs);
  const existing = await prisma.tag.findFirst({ where: { id: body.tag_id, user_id: userId } });
  if (!existing) throw new Error('Tag introuvable');
  return propose('update_tag', `Modifier le tag "${existing.name}"`, body);
}

async function proposeDeleteTag(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ tag_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await prisma.tag.findFirst({ where: { id: body.tag_id, user_id: userId } });
  if (!existing) throw new Error('Tag introuvable');
  return propose('delete_tag', `Supprimer le tag "${existing.name}"`, body);
}

async function proposeCreateGoal(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createSavingsGoalSchema.parse(rawArgs);
  if (body.account_id) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, user_id: userId } });
    if (!account) throw new Error('Compte lié introuvable');
  }
  return propose('create_goal', `Créer l'objectif "${body.name}" (cible ${body.target_amount})`, body);
}

async function proposeUpdateGoal(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ goal_id: z.coerce.number().int().positive() }).and(updateSavingsGoalSchema).parse(rawArgs);
  const existing = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id: userId } });
  if (!existing) throw new Error('Objectif introuvable');
  return propose('update_goal', `Modifier l'objectif "${existing.name}"`, body);
}

async function proposeDeleteGoal(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ goal_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id: userId } });
  if (!existing) throw new Error('Objectif introuvable');
  return propose('delete_goal', `Supprimer l'objectif "${existing.name}"`, body);
}

async function proposeContributeGoal(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ goal_id: z.coerce.number().int().positive() }).and(contributeSavingsGoalSchema).parse(rawArgs);
  const existing = await prisma.savingsGoal.findFirst({ where: { id: body.goal_id, user_id: userId } });
  if (!existing) throw new Error('Objectif introuvable');
  return propose('contribute_goal', `Verser ${body.amount} sur l'objectif "${existing.name}" le ${body.date}`, body);
}

async function proposeCreateRecurring(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createRecurringSchema.parse(normalizeModelBooleans(rawArgs));
  if (body.account_id) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, user_id: userId } });
    if (!account) throw new Error('Compte introuvable');
  }
  if (body.category_id) {
    const category = await prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } });
    if (!category) throw new Error('Catégorie introuvable');
  }
  return propose('create_recurring', `Créer le récurrent "${body.description}" (${body.frequency})`, body);
}

async function proposeUpdateRecurring(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ recurring_id: z.coerce.number().int().positive() }).and(updateRecurringSchema).parse(normalizeModelBooleans(rawArgs));
  const existing = await prisma.recurringTransaction.findFirst({ where: { id: body.recurring_id, user_id: userId } });
  if (!existing) throw new Error('Récurrent introuvable');
  return propose('update_recurring', `Modifier le récurrent "${existing.description}"`, body);
}

async function proposeDeleteRecurring(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ recurring_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await prisma.recurringTransaction.findFirst({ where: { id: body.recurring_id, user_id: userId } });
  if (!existing) throw new Error('Récurrent introuvable');
  return propose('delete_recurring', `Supprimer le récurrent "${existing.description}"`, body);
}

async function proposeSetBudget(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createBudgetSchema.parse(normalizeModelBooleans(rawArgs));
  const category = await prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } });
  if (!category) throw new Error('Catégorie introuvable');
  return propose('set_budget', `Budget ${body.month} pour "${category.name}" : ${body.amount_limit}`, body);
}

async function proposeDeleteBudget(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ budget_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await prisma.budget.findFirst({ where: { id: body.budget_id, user_id: userId }, include: { category: true } });
  if (!existing) throw new Error('Budget introuvable');
  return propose('delete_budget', `Supprimer le budget ${existing.month} pour "${existing.category?.name}"`, body);
}

async function proposeCreateRule(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createCategoryRuleSchema.parse(rawArgs);
  const category = await prisma.category.findFirst({ where: { id: body.category_id, user_id: userId } });
  if (!category) throw new Error('Catégorie introuvable');
  return propose('create_rule', `Règle "${body.pattern}" → ${category.name}`, body);
}

const createRulesSchema = z.object({
  rules: z.array(z.object({
    pattern: z.string().trim().min(1).max(100),
    category_id: z.coerce.number().int().positive(),
  })).min(1).max(100),
});

async function proposeCreateRules(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = createRulesSchema.parse(rawArgs);
  const rules = body.rules.map((r) => ({ pattern: r.pattern.toUpperCase(), category_id: r.category_id }));

  // Every referenced category must exist and belong to the user.
  const categoryIds = Array.from(new Set(rules.map((r) => r.category_id)));
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds }, user_id: userId } });
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const missing = categoryIds.filter((id) => !categoryById.has(id));
  if (missing.length > 0) throw new Error(`Catégorie(s) introuvable(s): ${missing.join(', ')}`);

  // Estimate how many of the current backlog these rules would catch, for the
  // confirmation label (the actual count is reported after confirmation).
  const uncategorized = await uncategorizedSingleLine(userId);
  const matched = Array.from(bucketByRule(uncategorized, rules).values()).reduce((sum, ids) => sum + ids.length, 0);

  const preview = rules.slice(0, 6).map((r) => `${r.pattern}→${categoryById.get(r.category_id)!.name}`).join(', ');
  const more = rules.length > 6 ? `, +${rules.length - 6}` : '';
  const label = `Créer ${rules.length} règle${rules.length > 1 ? 's' : ''} et catégoriser ${matched} transaction${matched > 1 ? 's' : ''} (${preview}${more})`;
  return propose('apply_rules', label, { rules });
}

async function proposeDeleteRule(userId: number, rawArgs: unknown): Promise<ToolExecution> {
  const body = z.object({ rule_id: z.coerce.number().int().positive() }).parse(rawArgs);
  const existing = await prisma.categoryRule.findFirst({ where: { id: body.rule_id, user_id: userId } });
  if (!existing) throw new Error('Règle introuvable');
  return propose('delete_rule', `Supprimer la règle "${existing.pattern}"`, body);
}

function parseMonth(month: string): string | null {
  if (!month) return null;
  const parsed = monthString.safeParse(month);
  return parsed.success ? parsed.data : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateRange(from: string | undefined, to: string | undefined) {
  const gte = parseDate(from);
  const lte = parseDate(to);
  if (!gte && !lte) return null;
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}

function monthRange(month: string) {
  const parsed = monthString.parse(month);
  const start = new Date(`${parsed}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { gte: start, lt: end };
}
