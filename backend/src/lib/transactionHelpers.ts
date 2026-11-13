import { prisma } from '../prisma.js';
import { HttpError } from '../middleware/errors.js';

// Gardes d'appartenance partagées. Le scoping par user_id est le seul niveau
// d'isolation de l'app : toute référence fournie par le client est vérifiée.
// (La validation des montants/lignes d'une opération vit dans lib/ledger.ts.)

export async function assertAccountOwned(userId: number, accountId: number, label = 'Compte'): Promise<void> {
  const account = await prisma.account.findFirst({ where: { id: accountId, user_id: userId }, select: { id: true } });
  if (!account) throw new HttpError(400, `${label} introuvable pour cet utilisateur`);
}

export async function assertCategoryOwned(userId: number, categoryId: number): Promise<void> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, user_id: userId }, select: { id: true } });
  if (!category) throw new HttpError(400, 'Catégorie introuvable pour cet utilisateur');
}

// Ne garde que les tags appartenant à l'utilisateur (les autres sont ignorés).
export async function resolveTagIds(userId: number, tagIds: number[] | undefined): Promise<number[]> {
  if (!tagIds || tagIds.length === 0) return [];
  const unique = Array.from(new Set(tagIds));
  const owned = await prisma.tag.findMany({ where: { id: { in: unique }, user_id: userId }, select: { id: true } });
  return owned.map((tag) => tag.id);
}
