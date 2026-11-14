import type { Prisma, TransactionKind } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../middleware/errors.js';
import { fetchExchangeRate } from './fx.js';
import { round2 } from './money.js';

// Cœur du modèle comptable (cf. docs/ARCHITECTURE-ledger.md). Une opération a
// un genre (`kind`) et des lignes signées. TOUTES les lectures « dépensé /
// reçu » passent par `txFlows`, et toutes les écritures par `buildLines`.

export type Kind = TransactionKind;
export type Side = 'expense' | 'income';

export interface LineLike {
  account_id: number | null;
  category_id: number | null;
  amount: number;
  refund: boolean;
  /** Ligne de remboursement : dépense remboursée par cette ligne. */
  refund_of_id?: number | null;
  note?: string | null;
  position?: number;
}

export interface LedgerTx {
  id: number;
  kind: Kind | string;
  date: Date;
  refunds_transaction_id?: number | null;
  lines: LineLike[];
}

export type CategoryTypeOf = (categoryId: number) => Side | undefined;

// Projection Prisma minimale pour les agrégations.
export const LINE_SELECT = { account_id: true, category_id: true, amount: true, refund: true, refund_of_id: true } as const;
export const LEDGER_TX_SELECT = {
  id: true,
  kind: true,
  date: true,
  refunds_transaction_id: true,
  lines: { select: LINE_SELECT },
} as const;

// Lignes dans l'ordre de saisie.
export const LINES_ORDERED = { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] };

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Côté (dépense/revenu) d'une ligne, ou null si l'opération n'en a pas. */
export function lineSide(kind: string, line: LineLike, categoryType: CategoryTypeOf): Side | null {
  if (kind !== 'standard') return null;
  if (line.category_id != null) {
    const type = categoryType(line.category_id);
    if (type) return type;
  }
  if (line.refund) return 'expense';
  return line.amount < 0 ? 'expense' : 'income';
}

export interface Flow {
  side: Side;
  category_id: number | null;
  account_id: number | null;
  /** Montant positif dans le sens du côté : dépensé (côté dépenses, un
   *  remboursement est négatif) ou reçu (côté revenus). Devise du compte. */
  value: number;
  refund: boolean;
  refund_of_id: number | null;
}

/** Comptes exclus des finances personnelles (comptes professionnels). */
export type AccountFilter = (accountId: number | null) => boolean;

/** Filtre des comptes professionnels d'un profil (leurs lignes ne sont ni dépense ni revenu perso). */
export async function professionalAccountFilter(user_id: number): Promise<AccountFilter> {
  const ids = new Set((await prisma.account.findMany({ where: { user_id, professional: true }, select: { id: true } })).map((a) => a.id));
  return (accountId) => accountId != null && ids.has(accountId);
}

export function txFlows(tx: Pick<LedgerTx, 'kind' | 'lines'>, categoryType: CategoryTypeOf, excluded?: AccountFilter): Flow[] {
  const out: Flow[] = [];
  for (const line of tx.lines) {
    if (excluded?.(line.account_id)) continue;
    const side = lineSide(tx.kind, line, categoryType);
    if (!side) continue;
    out.push({
      side,
      category_id: line.category_id,
      account_id: line.account_id,
      value: side === 'expense' ? -line.amount : line.amount,
      refund: line.refund || (side === 'expense' && line.amount > 0),
      refund_of_id: line.refund_of_id ?? null,
    });
  }
  return out;
}

export function categoryTypeLookup(categories: Array<{ id: number; type: string }>): CategoryTypeOf {
  const map = new Map(categories.map((c) => [c.id, c.type as Side]));
  return (id) => map.get(id);
}

/** Mouvement net de l'opération sur un compte (devise du compte). */
export function accountDelta(tx: Pick<LedgerTx, 'lines'>, accountId: number): number {
  let sum = 0;
  for (const line of tx.lines) if (line.account_id === accountId) sum += line.amount;
  return sum;
}

/** Comptes touchés par l'opération (hors lignes sans compte). */
export function accountsOf(tx: Pick<LedgerTx, 'lines'>): number[] {
  return Array.from(new Set(tx.lines.map((l) => l.account_id).filter((id): id is number => id != null)));
}

// ---------------------------------------------------------------------------
// Vue historique (compatibilité API : type / amount / account_id / splits…)
// ---------------------------------------------------------------------------

export interface LegacyView {
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  account_id: number | null;
  to_account_id: number | null;
  to_amount: number | null;
  exchange_rate: number | null;
  category_id: number | null;
  splits: Array<{ category_id: number | null; amount: number; note: string | null }>;
  /** Montant remboursé porté par l'opération (lignes de remboursement). */
  refund_amount: number;
}

export function legacyView(tx: Pick<LedgerTx, 'kind' | 'lines' | 'refunds_transaction_id'>): LegacyView {
  const lines = tx.lines;
  if (tx.kind === 'transfer') {
    const src = lines.find((l) => l.amount < 0) ?? null;
    const dst = lines.find((l) => l !== src && l.amount >= 0) ?? null;
    const amount = src ? -src.amount : dst?.amount ?? 0;
    return {
      type: 'transfer',
      amount: round2(amount),
      account_id: src?.account_id ?? null,
      to_account_id: dst?.account_id ?? null,
      to_amount: dst ? round2(dst.amount) : null,
      exchange_rate: src && dst && amount > 0 ? Math.round((dst.amount / amount) * 1e6) / 1e6 : null,
      category_id: null,
      splits: [],
      refund_amount: 0,
    };
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const type: 'expense' | 'income' = total > 0 ? 'income' : 'expense';
  const sign = type === 'income' ? 1 : -1;
  const refundLines = lines.filter((l) => l.refund);
  const refund_amount = round2(refundLines.reduce((s, l) => s + l.amount, 0));
  // Remboursement : la catégorie affichée est celle de la part « revenu »
  // restante (s'il y en a une seule) ; les parts remboursées sont décrites par
  // refund_amount et le lien vers la dépense.
  const ownLines = tx.refunds_transaction_id != null || refundLines.length > 0
    ? lines.filter((l) => !l.refund)
    : lines;
  const single = ownLines.length <= 1;
  return {
    type,
    amount: round2(Math.abs(total)),
    account_id: lines[0]?.account_id ?? null,
    to_account_id: null,
    to_amount: null,
    exchange_rate: null,
    category_id: single ? ownLines[0]?.category_id ?? null : null,
    splits: single ? [] : ownLines.map((l) => ({ category_id: l.category_id, amount: round2(sign * l.amount), note: l.note ?? null })),
    refund_amount,
  };
}

// ---------------------------------------------------------------------------
// Écriture : forme historique ou lignes explicites → lignes validées
// ---------------------------------------------------------------------------

export interface LegacyInput {
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  account_id?: number | null;
  to_account_id?: number | null;
  to_amount?: number | null;
  category_id?: number | null;
  date: string;
  splits?: Array<{ category_id: number; amount: number; note?: string | null }>;
  refunds_transaction_id?: number | null;
  refund_allocations?: Array<{ expense_transaction_id: number; amount: number }>;
}

export interface BuiltLines {
  kind: Kind;
  lines: Array<Omit<LineLike, 'position'> & { note: string | null; refund_of_id: number | null }>;
  refunds_transaction_id: number | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

async function ownedAccounts(db: Db, user_id: number, ids: number[]) {
  if (ids.length === 0) return new Map<number, { id: number; currency: string }>();
  const rows = await db.account.findMany({ where: { user_id, id: { in: ids } }, select: { id: true, currency: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

async function ownedCategories(db: Db, user_id: number, ids: number[]) {
  if (ids.length === 0) return new Map<number, Side>();
  const rows = await db.category.findMany({ where: { user_id, id: { in: ids } }, select: { id: true, type: true } });
  return new Map(rows.map((r) => [r.id, r.type as Side]));
}

/**
 * Convertit une saisie historique en lignes, avec toutes les gardes :
 * références possédées par l'utilisateur, virement valide (deux comptes
 * distincts, montant crédité converti au taux du jour si non fourni),
 * ventilation qui totalise le montant, remboursement plafonné à la dépense.
 * `selfId` = id de l'opération modifiée (exclue des cumuls de remboursement).
 */
export async function buildLines(db: Db, user_id: number, input: LegacyInput, selfId: number | null = null): Promise<BuiltLines> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Le montant doit être positif');
  const accountIds = [input.account_id, input.type === 'transfer' ? input.to_account_id : null].filter((x): x is number => x != null);
  const accounts = await ownedAccounts(db, user_id, accountIds);
  if (input.account_id != null && !accounts.has(input.account_id)) throw new HttpError(400, 'Compte source introuvable');

  if (input.type === 'transfer') {
    if (!input.account_id || !input.to_account_id) throw new HttpError(400, 'Un virement exige un compte source et un compte destination');
    if (input.account_id === input.to_account_id) throw new HttpError(400, 'Les comptes source et destination doivent être différents');
    const to = accounts.get(input.to_account_id);
    if (!to) throw new HttpError(400, 'Compte destination introuvable');
    const from = accounts.get(input.account_id)!;
    let toAmount = input.to_amount != null ? round2(input.to_amount) : null;
    if (toAmount == null) {
      if (from.currency === to.currency) toAmount = amount;
      else {
        try {
          toAmount = round2(amount * (await fetchExchangeRate(from.currency, to.currency, input.date)).rate);
        } catch {
          throw new HttpError(503, `Taux ${from.currency}→${to.currency} indisponible : indique le montant crédité`);
        }
      }
    }
    if (!(toAmount > 0)) throw new HttpError(400, 'Le montant crédité doit être positif');
    return {
      kind: 'transfer',
      refunds_transaction_id: null,
      lines: [
        { account_id: input.account_id, category_id: null, amount: -amount, refund: false, refund_of_id: null, note: null },
        { account_id: input.to_account_id, category_id: null, amount: toAmount, refund: false, refund_of_id: null, note: null },
      ],
    };
  }

  const sign = input.type === 'income' ? 1 : -1;
  const account_id = input.account_id ?? null;
  const splits = input.splits ?? [];
  const categoryIds = [input.category_id, ...splits.map((s) => s.category_id)].filter((x): x is number => x != null);
  const categories = await ownedCategories(db, user_id, categoryIds);
  if (input.category_id != null && !categories.has(input.category_id)) throw new HttpError(400, 'Catégorie introuvable');

  // Remboursement : allocations explicites, ou lien simple = montant entier.
  const allocations = input.type === 'income'
    ? input.refund_allocations && input.refund_allocations.length > 0
      ? input.refund_allocations
      : input.refunds_transaction_id != null
        ? [{ expense_transaction_id: input.refunds_transaction_id, amount }]
        : []
    : [];
  if (allocations.length > 0) {
    const lines = await refundLines(db, user_id, account_id, amount, allocations, input.category_id ?? null, selfId);
    // Lien d'en-tête seulement pour une dépense unique (le détail est porté par les lignes).
    return { kind: 'standard', refunds_transaction_id: allocations.length === 1 ? allocations[0]!.expense_transaction_id : null, lines };
  }

  if (splits.length > 0) {
    const total = round2(splits.reduce((s, x) => s + x.amount, 0));
    if (Math.abs(total - amount) > 0.01) throw new HttpError(400, 'La ventilation doit totaliser le montant de la transaction');
    for (const s of splits) {
      if (!categories.has(s.category_id)) throw new HttpError(400, 'Catégorie de ventilation introuvable');
      if (!(s.amount > 0)) throw new HttpError(400, 'Chaque part de ventilation doit être positive');
    }
    const lines = splits.map((s) => ({ account_id, category_id: s.category_id, amount: sign * round2(s.amount), refund: false, refund_of_id: null, note: s.note ?? null }));
    // Écart d'arrondi toléré reporté sur la première part : somme = montant.
    const diff = round2(sign * amount - lines.reduce((s, l) => s + l.amount, 0));
    if (diff !== 0) lines[0]!.amount = round2(lines[0]!.amount + diff);
    return { kind: 'standard', refunds_transaction_id: null, lines };
  }

  return {
    kind: 'standard',
    refunds_transaction_id: null,
    lines: [{ account_id, category_id: input.category_id ?? null, amount: sign * amount, refund: false, refund_of_id: null, note: null }],
  };
}

// Lignes de remboursement : chaque montant remboursé est réparti au prorata
// des catégories de la dépense ; le reste du revenu garde `remainderCategory`.
async function refundLines(
  db: Db,
  user_id: number,
  account_id: number | null,
  amount: number,
  allocations: Array<{ expense_transaction_id: number; amount: number }>,
  remainderCategory: number | null,
  selfId: number | null,
) {
  const ids = allocations.map((a) => a.expense_transaction_id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Chaque dépense remboursée ne peut apparaître qu’une fois');
  if (selfId != null && ids.includes(selfId)) throw new HttpError(400, 'Une transaction ne peut pas se rembourser elle-même');
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocated - amount > 0.01) throw new HttpError(400, 'Les remboursements alloués ne peuvent pas dépasser le revenu');

  const [expenses, others] = await Promise.all([
    db.transaction.findMany({
      where: { user_id, id: { in: ids }, deleted_at: null },
      select: { id: true, kind: true, lines: { select: LINE_SELECT, ...LINES_ORDERED } },
    }),
    // Déjà remboursé sur ces dépenses par d'AUTRES opérations vivantes.
    db.transactionLine.findMany({
      where: { user_id, refund_of_id: { in: ids }, transaction: { deleted_at: null, ...(selfId != null ? { id: { not: selfId } } : {}) } },
      select: { refund_of_id: true, amount: true },
    }),
  ]);
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const already = new Map<number, number>();
  for (const o of others) already.set(o.refund_of_id!, (already.get(o.refund_of_id!) ?? 0) + o.amount);

  const lines: Array<{ account_id: number | null; category_id: number | null; amount: number; refund: boolean; refund_of_id: number | null; note: string | null }> = [];
  for (const a of allocations) {
    const expense = byId.get(a.expense_transaction_id);
    if (!expense) throw new HttpError(400, 'Dépense à rembourser introuvable');
    const parts = expense.kind === 'standard' ? expense.lines.filter((l) => l.amount < 0) : [];
    const spent = -parts.reduce((s, l) => s + l.amount, 0);
    if (!(spent > 0)) throw new HttpError(400, 'Un remboursement doit pointer vers une dépense');
    if (round2((already.get(expense.id) ?? 0) + a.amount) - spent > 0.01) {
      throw new HttpError(400, 'Le cumul des remboursements dépasse le montant de la dépense');
    }
    for (const p of parts) {
      lines.push({ account_id, category_id: p.category_id, amount: a.amount * (-p.amount / spent), refund: true, refund_of_id: expense.id, note: null });
    }
  }
  const rest = round2(amount - allocated);
  if (rest > 0) lines.push({ account_id, category_id: remainderCategory, amount: rest, refund: false, refund_of_id: null, note: null });
  return lines;
}

/** Fusionne une modification partielle avec l'existant (vue historique). */
export function mergeLegacy(existing: LedgerTx & { date: Date }, patch: Partial<LegacyInput>): LegacyInput {
  const view = legacyView(existing);
  const type = patch.type ?? view.type;
  const typeChanged = patch.type != null && patch.type !== view.type;
  const amountChanged = patch.amount != null && round2(patch.amount) !== view.amount;
  const accountsChanged = patch.account_id !== undefined || patch.to_account_id !== undefined;
  // Montant crédité : repris tel quel seulement si rien ne l'invalide.
  const to_amount = patch.to_amount !== undefined
    ? patch.to_amount
    : type === 'transfer' && !typeChanged && !amountChanged && !accountsChanged ? view.to_amount : null;
  // Ventilation existante : conservée si le montant ne bouge pas, sinon
  // retirée (elle ne totaliserait plus) — sauf si une nouvelle est fournie.
  const keepSplits = patch.splits === undefined && !amountChanged && !typeChanged && patch.category_id === undefined;
  const existingSplits = keepSplits ? view.splits.filter((s) => s.category_id != null) as Array<{ category_id: number; amount: number; note: string | null }> : [];
  return {
    type,
    amount: patch.amount ?? view.amount,
    account_id: patch.account_id !== undefined ? patch.account_id : view.account_id,
    to_account_id: patch.to_account_id !== undefined ? patch.to_account_id : view.to_account_id,
    to_amount,
    category_id: patch.category_id !== undefined ? patch.category_id : view.category_id,
    date: patch.date ?? existing.date.toISOString().slice(0, 10),
    splits: patch.splits !== undefined ? patch.splits ?? [] : existingSplits,
    refunds_transaction_id: patch.refunds_transaction_id !== undefined
      ? patch.refunds_transaction_id
      : patch.refund_allocations !== undefined || typeChanged ? null : existing.refunds_transaction_id ?? null,
    // Remboursement existant non touché par la modification : on conserve la
    // part remboursée (plafonnée au nouveau montant) plutôt que d'en faire un
    // remboursement total.
    refund_allocations: patch.refund_allocations
      ?? (patch.refunds_transaction_id === undefined && !typeChanged && view.refund_amount > 0
        ? capAllocations(refundAllocationsOf(existing.lines, existing.refunds_transaction_id ?? null), round2(patch.amount ?? view.amount))
        : undefined),
  };
}

/** La modification touche-t-elle aux montants (donc aux lignes) ? */
export function patchTouchesLines(patch: Partial<LegacyInput>): boolean {
  return (['type', 'amount', 'account_id', 'to_account_id', 'to_amount', 'category_id', 'splits', 'refunds_transaction_id', 'refund_allocations'] as const)
    .some((k) => patch[k] !== undefined);
}

/** Données Prisma pour (re)créer les lignes d'une opération. */
export function linesCreateData(user_id: number, built: BuiltLines) {
  return built.lines.map((l, position) => ({ user_id, account_id: l.account_id, category_id: l.category_id, amount: l.amount, refund: l.refund, refund_of_id: l.refund_of_id, note: l.note, position }));
}

/** Allocations (dépense → montant) portées par les lignes de remboursement. */
export function refundAllocationsOf(lines: LineLike[], fallbackTarget: number | null): Array<{ expense_transaction_id: number; amount: number }> {
  const byExpense = new Map<number, number>();
  for (const l of lines) {
    if (!l.refund) continue;
    const target = l.refund_of_id ?? fallbackTarget;
    if (target == null) continue;
    byExpense.set(target, (byExpense.get(target) ?? 0) + l.amount);
  }
  return Array.from(byExpense.entries()).map(([expense_transaction_id, amount]) => ({ expense_transaction_id, amount: round2(amount) }));
}

function capAllocations(allocations: Array<{ expense_transaction_id: number; amount: number }>, max: number) {
  let left = max;
  return allocations.map((a) => {
    const amount = Math.min(a.amount, Math.max(0, left));
    left -= amount;
    return { ...a, amount: round2(amount) };
  }).filter((a) => a.amount > 0);
}

// ---------------------------------------------------------------------------
// Remboursements : toujours dans la (les) catégorie(s) de la dépense
// ---------------------------------------------------------------------------

/**
 * Réaligne les lignes de remboursement qui pointent vers ces dépenses sur leur
 * ventilation actuelle : même montant remboursé par opération, réparti au
 * prorata des lignes de la dépense, dans leurs catégories. À appeler (dans la
 * même transaction SQL) après toute modification des lignes d'une dépense —
 * sinon un remboursement resterait déduit de l'ancienne catégorie.
 */
// Client Prisma ou transaction interactive (client étendu compris).
type RefundDb = Pick<typeof prisma, 'transaction' | 'transactionLine'>;
export async function resyncRefundLines(db: RefundDb, user_id: number, expenseIds: number[]): Promise<number> {
  const ids = Array.from(new Set(expenseIds));
  if (ids.length === 0) return 0;
  const expenses = await db.transaction.findMany({
    where: { id: { in: ids }, user_id, deleted_at: null },
    select: { id: true, kind: true, lines: { select: { category_id: true, amount: true }, orderBy: { position: 'asc' } } },
  });
  let changed = 0;
  for (const expense of expenses) {
    const parts = expense.kind === 'standard' ? expense.lines.filter((l) => l.amount < 0) : [];
    const spent = -parts.reduce((s, l) => s + l.amount, 0);
    if (!(spent > 0)) continue;
    const refundLines = await db.transactionLine.findMany({
      where: {
        user_id,
        refund: true,
        OR: [{ refund_of_id: expense.id }, { refund_of_id: null, transaction: { refunds_transaction_id: expense.id } }],
        transaction: { deleted_at: null },
      },
      select: { id: true, transaction_id: true, account_id: true, category_id: true, amount: true, position: true },
      orderBy: [{ transaction_id: 'asc' }, { position: 'asc' }],
    });
    const byTx = new Map<number, typeof refundLines>();
    for (const l of refundLines) byTx.set(l.transaction_id, [...(byTx.get(l.transaction_id) ?? []), l]);
    for (const [transaction_id, lines] of byTx) {
      const allocated = round2(lines.reduce((s, l) => s + l.amount, 0));
      // Répartition au prorata, l'arrondi restant sur la dernière ligne.
      const wanted = parts.map((p) => ({ category_id: p.category_id, amount: round2(allocated * (-p.amount / spent)) }));
      const drift = round2(allocated - wanted.reduce((s, w) => s + w.amount, 0));
      if (wanted.length > 0) wanted[wanted.length - 1]!.amount = round2(wanted[wanted.length - 1]!.amount + drift);
      const same = wanted.length === lines.length
        && wanted.every((w, i) => w.category_id === lines[i]!.category_id && Math.abs(w.amount - round2(lines[i]!.amount)) < 0.005);
      if (same) continue;
      await db.transactionLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
      await db.transactionLine.createMany({
        data: wanted.map((w, i) => ({
          user_id, transaction_id, account_id: lines[0]!.account_id, category_id: w.category_id, amount: w.amount,
          refund: true, refund_of_id: expense.id, position: lines[0]!.position + i,
        })),
      });
      changed += 1;
    }
  }
  return changed;
}
