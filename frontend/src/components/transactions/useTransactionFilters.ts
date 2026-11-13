import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountTypeGroup, refundAllocatedAmount, type Account, type Category, type Transaction, type TransactionType } from '@suzanne/shared';
import { money, txLabel, typeLabel } from '../../lib/format';
import { usePersistedState } from '../../lib/storage';
import { formatTxDate } from './txUtils';

export const PAGE_SIZE = 50;

export type TxSortKey = 'date' | 'label' | 'type' | 'amount';
export interface TxSort {
  key: TxSortKey;
  dir: 'asc' | 'desc';
}
export type ClearedFilter = 'all' | 'cleared' | 'uncleared';

export interface TxFilters {
  query: string;
  type: 'all' | TransactionType;
  categoryId: string;
  accountGroup: string;
  tagId: string;
  cleared: ClearedFilter;
}

// Filtres, tri et pagination du journal. Les filtres sont persistés entre
// sessions (sauf la recherche) ; tout le calcul dérivé est mémoïsé.
export function useTransactionFilters(source: Transaction[], categoryById: Map<number, Category>, accountById: Map<number, Account>, resetKey: string) {
  const [query, setQuery] = useState('');
  const [type, setType] = usePersistedState<'all' | TransactionType>('tx_filter_type', 'all');
  const [categoryId, setCategoryId] = usePersistedState<string>('tx_filter_category', 'all');
  const [accountGroup, setAccountGroup] = usePersistedState<string>('tx_filter_account_group', 'all');
  const [tagId, setTagId] = usePersistedState<string>('tx_filter_tag', 'all');
  const [cleared, setCleared] = usePersistedState<ClearedFilter>('tx_filter_cleared', 'all');
  const [sort, setSort] = usePersistedState<TxSort>('tx_sort', { key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);

  const filters: TxFilters = { query, type, categoryId, accountGroup, tagId, cleared };
  // Signature des filtres : sert à remettre la page / la sélection à zéro.
  const signature = JSON.stringify([query.trim(), type, categoryId, accountGroup, tagId, cleared, resetKey]);

  // Tout changement de ce qui est affiché ramène à la page 1.
  useEffect(() => { setPage(1); }, [signature, sort.key, sort.dir]);

  const activeCount = [type !== 'all', categoryId !== 'all', accountGroup !== 'all', tagId !== 'all', cleared !== 'all', query.trim() !== '']
    .filter(Boolean).length;

  const reset = useCallback(() => {
    setType('all');
    setCategoryId('all');
    setAccountGroup('all');
    setTagId('all');
    setCleared('all');
    setQuery('');
  }, [setType, setCategoryId, setAccountGroup, setTagId, setCleared]);

  // En-tête cliqué : inverse le sens si c'est déjà la clé, sinon bascule avec
  // un sens par défaut (récent / gros d'abord, alphabétique pour le texte).
  const toggleSort = useCallback((key: TxSortKey) => {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' });
  }, [setSort]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return source.filter((t) => {
      if (type !== 'all' && t.type !== type) return false;
      if (cleared !== 'all' && (cleared === 'cleared') !== t.cleared) return false;
      if (tagId !== 'all' && !(t.tags ?? []).some((tag) => String(tag.id) === tagId)) return false;
      // Une transaction ventilée appartient à toutes les catégories de ses splits.
      if (categoryId !== 'all'
        && String(t.category_id ?? '') !== categoryId
        && !(t.splits ?? []).some((split) => String(split.category_id) === categoryId)) return false;
      const src = accountById.get(t.account_id ?? -1);
      const dest = accountById.get(t.to_account_id ?? -1);
      // « account:<id> » : un compte précis (lien depuis la fiche d'un compte).
      if (accountGroup.startsWith('account:')) {
        const id = Number(accountGroup.slice(8));
        if (t.account_id !== id && t.to_account_id !== id && !(t.lines ?? []).some((l) => l.account_id === id)) return false;
      } else if (accountGroup !== 'all') {
        const groups = [src ? accountTypeGroup(src.type) : null, dest ? accountTypeGroup(dest.type) : null];
        if (!groups.includes(accountGroup as ReturnType<typeof accountTypeGroup>)) return false;
      }
      if (!needle) return true;
      const haystack = [
        t.description,
        src?.name,
        dest?.name,
        categoryById.get(t.category_id ?? -1)?.name,
        ...(t.splits ?? []).map((split) => categoryById.get(split.category_id ?? -1)?.name),
        ...(t.tags ?? []).map((tag) => tag.name),
        money(t.amount, src?.currency ?? 'EUR'),
        String(t.amount),
        formatTxDate(t.date),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [source, query, type, cleared, tagId, categoryId, accountGroup, accountById, categoryById]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'date': cmp = a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)); break;
        case 'amount': cmp = a.amount - b.amount; break;
        case 'type': cmp = typeLabel(a.type).localeCompare(typeLabel(b.type), 'fr'); break;
        case 'label': cmp = txLabel(a, categoryById).localeCompare(txLabel(b, categoryById), 'fr'); break;
      }
      // Départage stable : même clé → ordre déterministe.
      if (cmp === 0) cmp = a.id - b.id;
      return cmp * dir;
    });
  }, [filtered, sort.key, sort.dir, categoryById]);

  // Récap aligné sur le dashboard : la part remboursement d'un revenu annule
  // une dépense ; seul l'éventuel surplus compte comme revenu.
  const totals = useMemo(() => filtered.reduce((acc, t) => {
    if (t.type === 'income') {
      const refundPart = refundAllocatedAmount(t);
      acc.income += t.amount - refundPart;
      acc.expenses -= refundPart;
    }
    if (t.type === 'expense') acc.expenses += t.amount;
    if (t.type === 'transfer') acc.transfers += t.amount;
    return acc;
  }, { income: 0, expenses: 0, transfers: 0 }), [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sorted, currentPage],
  );
  const pageStart = sorted.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, sorted.length);

  // Saute à la page qui contient une transaction (deep link). Renvoie false
  // si elle est masquée par les filtres.
  const goToTransaction = useCallback((id: number) => {
    const index = sorted.findIndex((t) => t.id === id);
    if (index < 0) return false;
    setPage(Math.floor(index / PAGE_SIZE) + 1);
    return true;
  }, [sorted]);

  return {
    filters,
    signature,
    setQuery,
    setType,
    setCategoryId,
    setAccountGroup,
    setTagId,
    setCleared,
    activeCount,
    reset,
    sort,
    setSort,
    toggleSort,
    filtered,
    sorted,
    paged,
    totals,
    page: currentPage,
    setPage,
    totalPages,
    pageStart,
    pageEnd,
    goToTransaction,
  };
}

export type TransactionFiltersState = ReturnType<typeof useTransactionFilters>;
