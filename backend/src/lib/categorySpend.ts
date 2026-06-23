// Ventilation d'une transaction par catégorie, partagée entre le dashboard et
// les budgets (rollover) — pour que le « dépensé » soit calculé de façon
// identique partout. Un remboursement (revenu lié à une dépense) compte comme
// dépense négative, nette sur la catégorie de la dépense d'origine. Les splits
// répartissent une transaction sur plusieurs catégories.

export interface CategoryTx {
  id: number;
  type: string;
  amount: number;
  category_id: number | null;
  refunds_transaction_id: number | null;
  splits: Array<{ category_id: number; amount: number }>;
  refund_allocations_sent: Array<{
    amount: number;
    expense_transaction: {
      amount: number;
      category_id: number | null;
      splits: Array<{ category_id: number; amount: number }>;
    };
  }>;
}

export interface CategoryAllocation { category_id: number | null; amount: number }

export function categoryAllocations(t: Pick<CategoryTx, 'amount' | 'category_id' | 'splits'>): CategoryAllocation[] {
  return t.splits.length > 0
    ? t.splits.map((split) => ({ category_id: split.category_id, amount: split.amount }))
    : [{ category_id: t.category_id, amount: t.amount }];
}

export function isRefund(t: Pick<CategoryTx, 'type' | 'refunds_transaction_id' | 'refund_allocations_sent'>): boolean {
  return t.type === 'income' && (t.refund_allocations_sent.length > 0 || t.refunds_transaction_id != null);
}

export function refundCategoryAllocations(refund: CategoryTx, target: CategoryTx | undefined): CategoryAllocation[] {
  if (refund.refund_allocations_sent.length > 0) {
    return refund.refund_allocations_sent.flatMap((refundAllocation) => {
      const expense = refundAllocation.expense_transaction;
      if (!expense || expense.amount <= 0) return [{ category_id: null, amount: refundAllocation.amount }];
      return categoryAllocations(expense).map((categoryAllocation) => ({
        category_id: categoryAllocation.category_id,
        amount: refundAllocation.amount * (categoryAllocation.amount / expense.amount),
      }));
    });
  }
  if (!target || target.amount <= 0) return [{ category_id: null, amount: refund.amount }];
  return categoryAllocations(target).map((allocation) => ({
    category_id: allocation.category_id,
    amount: refund.amount * (allocation.amount / target.amount),
  }));
}

export function refundAllocatedAmount(t: Pick<CategoryTx, 'amount' | 'refund_allocations_sent' | 'refunds_transaction_id'>): number {
  if (t.refund_allocations_sent.length > 0) {
    return Math.min(t.amount, t.refund_allocations_sent.reduce((sum, allocation) => sum + allocation.amount, 0));
  }
  return t.refunds_transaction_id != null ? t.amount : 0;
}

// Dépensé net par catégorie pour un ensemble de transactions (déjà filtré sur
// la période voulue). `valueOf(amount, tx)` convertit en devise de reporting
// (FX selon le compte). Les remboursements viennent en déduction de la
// catégorie de la dépense remboursée (résolue via `txById` sur tout l'historique).
export function spentByCategory(
  periodTransactions: CategoryTx[],
  txById: Map<number, CategoryTx>,
  valueOf: (amount: number, tx: CategoryTx) => number,
): Map<number | null, number> {
  const byCategory = new Map<number | null, number>();
  for (const t of periodTransactions) {
    if (t.type === 'expense') {
      for (const allocation of categoryAllocations(t)) {
        byCategory.set(allocation.category_id, (byCategory.get(allocation.category_id) ?? 0) + valueOf(allocation.amount, t));
      }
    } else if (t.type === 'income' && isRefund(t)) {
      const target = t.refunds_transaction_id != null ? txById.get(t.refunds_transaction_id) : undefined;
      for (const allocation of refundCategoryAllocations(t, target)) {
        byCategory.set(allocation.category_id, (byCategory.get(allocation.category_id) ?? 0) - valueOf(allocation.amount, t));
      }
    }
  }
  return byCategory;
}
