import { prisma } from '../prisma.js';
import { HttpError } from '../middleware/errors.js';
import { fetchExchangeRate } from './fx.js';
import { round2 } from './money.js';

// Helpers partagés entre les routes REST (routes/transactions.ts, snapshots,
// import) et le chemin IA (ai/tools.ts). Le scoping par user_id est le seul
// niveau d'isolation de l'app : toute référence (compte, catégorie, dépense
// remboursée) fournie par le client doit être vérifiée ici.

export async function assertAccountOwned(userId: number, accountId: number, label = 'Compte'): Promise<void> {
  const account = await prisma.account.findFirst({ where: { id: accountId, user_id: userId }, select: { id: true } });
  if (!account) throw new HttpError(400, `${label} introuvable pour cet utilisateur`);
}

export async function assertCategoryOwned(userId: number, categoryId: number): Promise<void> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, user_id: userId }, select: { id: true } });
  if (!category) throw new HttpError(400, 'Catégorie introuvable pour cet utilisateur');
}

// Vérifie en une passe les références d'une transaction (création ou patch).
export async function assertTransactionReferences(
  userId: number,
  body: { account_id?: number | null; to_account_id?: number | null; category_id?: number | null },
): Promise<void> {
  const [account, toAccount, category] = await Promise.all([
    body.account_id ? prisma.account.findFirst({ where: { id: body.account_id, user_id: userId }, select: { id: true } }) : Promise.resolve(null),
    body.to_account_id ? prisma.account.findFirst({ where: { id: body.to_account_id, user_id: userId }, select: { id: true } }) : Promise.resolve(null),
    body.category_id ? prisma.category.findFirst({ where: { id: body.category_id, user_id: userId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (body.account_id && !account) throw new HttpError(400, 'Compte source introuvable');
  if (body.to_account_id && !toAccount) throw new HttpError(400, 'Compte destination introuvable');
  if (body.category_id && !category) throw new HttpError(400, 'Catégorie introuvable');
}

export async function assertTransactionSplits(
  userId: number,
  type: string,
  splits: Array<{ category_id: number; amount: number }> | undefined,
  amount: number,
): Promise<void> {
  if (!splits || splits.length === 0) return;
  if (type === 'transfer') throw new HttpError(400, 'Un transfert ne peut pas être ventilé');
  const total = round2(splits.reduce((sum, split) => sum + split.amount, 0));
  if (Math.abs(total - amount) > 0.01) {
    throw new HttpError(400, 'La ventilation doit totaliser le montant de la transaction');
  }
  const categoryIds = Array.from(new Set(splits.map((split) => split.category_id)));
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds }, user_id: userId },
    select: { id: true, type: true },
  });
  const categoryById = new Map(categories.map((category) => [category.id, category.type]));
  for (const categoryId of categoryIds) {
    const categoryType = categoryById.get(categoryId);
    if (!categoryType) throw new HttpError(400, 'Catégorie de ventilation introuvable');
    if (categoryType !== type) {
      throw new HttpError(400, 'Les catégories de ventilation doivent correspondre au type de transaction');
    }
  }
}

// Une cible de remboursement doit être une dépense appartenant à l'utilisateur.
export async function assertRefundTarget(userId: number, targetId: number): Promise<void> {
  const target = await prisma.transaction.findFirst({ where: { id: targetId, user_id: userId }, select: { type: true } });
  if (!target) throw new HttpError(400, 'Dépense à rembourser introuvable');
  if (target.type !== 'expense') throw new HttpError(400, 'Un remboursement doit pointer vers une dépense');
}

// Ne garde que les tags appartenant à l'utilisateur (les autres sont ignorés).
export async function resolveTagIds(userId: number, tagIds: number[] | undefined): Promise<number[]> {
  if (!tagIds || tagIds.length === 0) return [];
  const unique = Array.from(new Set(tagIds));
  const owned = await prisma.tag.findMany({ where: { id: { in: unique }, user_id: userId }, select: { id: true } });
  return owned.map((tag) => tag.id);
}

// Montant crédité et taux de change d'un transfert : repris du `to_amount`
// fourni, sinon converti via le taux du jour entre les devises des comptes.
export async function transferAmounts(
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
