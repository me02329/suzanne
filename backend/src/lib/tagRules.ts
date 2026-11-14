import { prisma } from '../prisma.js';

// Règles de tag : un libellé qui contient le motif (majuscules) reçoit le tag.
// Contrairement aux règles de catégorie (première règle gagnante), TOUTES les
// règles qui correspondent s'appliquent : un libellé peut porter plusieurs tags.

export interface TagRuleLike { pattern: string; tag_id: number }

/** Tags à poser sur un libellé (pur, testé). */
export function tagsForDescription(rules: TagRuleLike[], description: string | null): number[] {
  const upper = (description ?? '').toUpperCase();
  if (!upper) return [];
  return Array.from(new Set(rules.filter((r) => r.pattern && upper.includes(r.pattern)).map((r) => r.tag_id)));
}

export async function loadTagRules(user_id: number): Promise<TagRuleLike[]> {
  return prisma.tagRule.findMany({ where: { user_id }, select: { pattern: true, tag_id: true }, orderBy: { id: 'asc' } });
}

/**
 * Applique les règles de tag aux opérations existantes (revenus, dépenses et
 * virements). N'ajoute que les tags manquants : sûr à relancer.
 */
export async function applyTagRules(user_id: number): Promise<{ tagged: number; links: number; scanned: number }> {
  const rules = await loadTagRules(user_id);
  if (rules.length === 0) return { tagged: 0, links: 0, scanned: 0 };
  const transactions = await prisma.transaction.findMany({
    where: { user_id, description: { not: null } },
    select: { id: true, description: true, tags: { select: { tag_id: true } } },
  });
  const data: Array<{ transaction_id: number; tag_id: number }> = [];
  const touched = new Set<number>();
  for (const t of transactions) {
    const has = new Set(t.tags.map((x) => x.tag_id));
    for (const tag_id of tagsForDescription(rules, t.description)) {
      if (has.has(tag_id)) continue;
      data.push({ transaction_id: t.id, tag_id });
      touched.add(t.id);
    }
  }
  if (data.length > 0) await prisma.transactionTag.createMany({ data, skipDuplicates: true });
  return { tagged: touched.size, links: data.length, scanned: transactions.length };
}
