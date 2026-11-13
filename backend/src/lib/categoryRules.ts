import { prisma } from '../prisma.js';

// Une ligne catégorisée ou de remboursement exclut l'opération des règles.
const UNCATEGORIZED_BLOCKERS = { OR: [{ category_id: { not: null } }, { refund: true }] };

export interface RuleLike { pattern: string; category_id: number }
export interface TxLike { id: number; description: string | null }

// Bucket uncategorized transactions by the category their first matching rule
// assigns. Pure (exported for testing). Matching mirrors the CSV import: the
// transaction's uppercased description contains the rule's (uppercase) pattern;
// the first matching rule wins, so callers pass rules in a stable order.
export function bucketByRule(transactions: TxLike[], rules: RuleLike[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const tx of transactions) {
    const description = (tx.description ?? '').toUpperCase();
    const rule = rules.find((r) => description.includes(r.pattern));
    if (!rule) continue;
    const list = out.get(rule.category_id);
    if (list) list.push(tx.id); else out.set(rule.category_id, [tx.id]);
  }
  return out;
}

// Apply the user's rules to their existing uncategorized income/expense
// transactions. Only fills empty categories — never overwrites, never touches
// transfers / trades / adjustments nor refunds, skips rules whose category was
// deleted — so it is safe to re-run. « Non catégorisée » = opération standard
// dont aucune ligne n'a de catégorie (ni n'est une ligne de remboursement).
export async function applyRulesToUncategorized(userId: number): Promise<{ categorized: number; scanned: number }> {
  const [rules, categories, uncategorized] = await Promise.all([
    prisma.categoryRule.findMany({ where: { user_id: userId }, orderBy: { pattern: 'asc' } }),
    prisma.category.findMany({ where: { user_id: userId }, select: { id: true } }),
    prisma.transaction.findMany({
      where: { user_id: userId, kind: 'standard', lines: { some: {}, none: UNCATEGORIZED_BLOCKERS } },
      select: { id: true, description: true },
    }),
  ]);
  const validCategory = new Set(categories.map((c) => c.id));
  const activeRules = rules.filter((r) => validCategory.has(r.category_id));
  const idsByCategory = bucketByRule(uncategorized, activeRules);

  let categorized = 0;
  for (const [category_id, ids] of idsByCategory) {
    // Re-vérifié au moment de l'écriture (une opération catégorisée entre-temps
    // n'est pas écrasée). Compte en opérations, pas en lignes.
    const still = await prisma.transaction.findMany({
      where: { id: { in: ids }, user_id: userId, kind: 'standard', lines: { none: UNCATEGORIZED_BLOCKERS } },
      select: { id: true },
    });
    if (still.length === 0) continue;
    await prisma.transactionLine.updateMany({
      where: { user_id: userId, transaction_id: { in: still.map((t) => t.id) }, category_id: null, refund: false },
      data: { category_id },
    });
    categorized += still.length;
  }
  return { categorized, scanned: uncategorized.length };
}
