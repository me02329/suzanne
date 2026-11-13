import { useEffect, useState } from 'react';
import type { BudgetStatus } from '@suzanne/shared';
import { api } from '../../lib/api';

// Statut des budgets (dépensé par catégorie budgétée, converti dans la devise
// de rapport, report d'enveloppe inclus). Si l'appelant l'a déjà, on l'utilise ;
// sinon on le charge pour le mois / la devise demandés. `refreshKey` relance le
// chargement après une mutation (ex. l'objet summary, recréé à chaque reload).
export function useBudgetStatus({ userId, month, currency, provided, refreshKey }: {
  userId: number | null | undefined;
  month: string | null | undefined;
  currency: string;
  provided?: BudgetStatus[] | null;
  refreshKey?: unknown;
}): BudgetStatus[] | null {
  const [fetched, setFetched] = useState<{ key: string; rows: BudgetStatus[] } | null>(null);
  const key = `${userId}:${month}:${currency}`;
  const skip = provided != null || userId == null || !month;

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    api.budgetsStatus(userId!, month!, currency)
      .then((rows) => { if (!cancelled) setFetched({ key: `${userId}:${month}:${currency}`, rows }); })
      .catch(() => { if (!cancelled) setFetched({ key: `${userId}:${month}:${currency}`, rows: [] }); });
    return () => { cancelled = true; };
  }, [skip, userId, month, currency, refreshKey]);

  if (provided != null) return provided;
  if (userId == null) return [];
  // Garde les lignes du dernier chargement pendant un rafraîchissement du même
  // mois ; ne montre jamais celles d'un autre mois / d'une autre devise.
  return fetched?.key === key ? fetched.rows : null;
}
