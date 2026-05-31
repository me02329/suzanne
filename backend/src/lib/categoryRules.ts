import { prisma } from '../prisma.js';

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
// transfers, skips rules whose category was deleted — so it is safe to re-run.
export async function applyRulesToUncategorized(userId: number): Promise<{ categorized: number; scanned: number }> {
  const [rules, categories, uncategorized] = await Promise.all([
    prisma.categoryRule.findMany({ where: { user_id: userId }, orderBy: { pattern: 'asc' } }),
    prisma.category.findMany({ where: { user_id: userId }, select: { id: true } }),
    prisma.transaction.findMany({
      where: { user_id: userId, category_id: null, type: { not: 'transfer' } },
      select: { id: true, description: true },
    }),
  ]);
  const validCategory = new Set(categories.map((c) => c.id));
  const activeRules = rules.filter((r) => validCategory.has(r.category_id));
  const idsByCategory = bucketByRule(uncategorized, activeRules);

  let categorized = 0;
  for (const [category_id, ids] of idsByCategory) {
    const result = await prisma.transaction.updateMany({
      where: { id: { in: ids }, user_id: userId, category_id: null },
      data: { category_id },
    });
    categorized += result.count;
  }
  return { categorized, scanned: uncategorized.length };
}
