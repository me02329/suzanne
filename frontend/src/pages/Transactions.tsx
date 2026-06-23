import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, Rows2, Rows3, Search, Trash2 } from 'lucide-react';
import {
  ACCOUNT_GROUPS,
  accountTypeGroup,
  refundAllocatedAmount,
  refundedAmount,
  type Account,
  type Category,
  type RecurringTransaction,
  type Tag,
  type Transaction,
  type TransactionType,
} from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { numberOrNull } from '../lib/forms';
import { money, todayIso, txLabel, typeLabel } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';
import { TagPicker } from '../components/TagPicker';
import { AttachmentsModal } from '../components/AttachmentsModal';
import { TransactionsTable, type TxSort, type TxSortKey } from '../components/TransactionsTable';

import type { Run } from '../lib/run';

const PAGE_SIZE = 50;

type SplitDraft = { key: string; category_id: string; amount: string; note: string };
type RefundAllocationDraft = { expense_transaction_id: number; amount: number };

function emptySplitDraft(): SplitDraft {
  return { key: `${Date.now()}-${Math.random()}`, category_id: '', amount: '', note: '' };
}

function splitDraftsFromTransaction(transaction: Transaction): SplitDraft[] {
  return (transaction.splits ?? []).map((split) => ({
    key: String(split.id),
    category_id: String(split.category_id),
    amount: String(split.amount),
    note: split.note ?? '',
  }));
}

function splitPayloadFromDrafts(drafts: SplitDraft[]) {
  return drafts
    .map((draft) => ({
      category_id: Number(draft.category_id),
      amount: Number(draft.amount),
      note: draft.note.trim() || null,
    }))
    .filter((split) => Number.isFinite(split.category_id) && split.category_id > 0 && Number.isFinite(split.amount) && split.amount > 0);
}

// Brouillon initial d'une ventilation : la 1re ligne reprend la catégorie et le
// montant courants (à ajuster), la 2e est vide — le bouton « solde » la complète.
function prefilledSplitDrafts(categoryId: number | string | null, amount: number | string): SplitDraft[] {
  return [
    { ...emptySplitDraft(), category_id: categoryId ? String(categoryId) : '', amount: amount ? String(amount) : '' },
    emptySplitDraft(),
  ];
}

export function Transactions({ userId, transactions, unassignedTransactions, issueFilter, onClearIssueFilter, recurring, accounts, categories, tags, categoryById, accountById, onMonthChange, run }: {
  userId: number;
  transactions: Transaction[];
  unassignedTransactions: Transaction[];
  issueFilter: 'unassigned_account' | null;
  onClearIssueFilter: () => void;
  recurring: RecurringTransaction[];
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  // Le mois affiché appartient à App (il pilote le reload) ; les deep-links
  // de drill-down s'en servent pour amener l'utilisateur sur le bon mois.
  onMonthChange: (month: string) => void;
  run: Run;
}) {
  // `editing` doubles as the modal trigger: open when non-null, closed otherwise.
  // Negative ids encode "copy" (no real backend row yet).
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [attachmentsFor, setAttachmentsFor] = useState<Transaction | null>(null);
  const [linking, setLinking] = useState<Transaction | null>(null);
  // Remboursements : dépense → créer le revenu lié ; revenu → choisir la dépense liée.
  const [refundingExpense, setRefundingExpense] = useState<Transaction | null>(null);
  // Montant saisi du remboursement (contrôlé) pour signaler le surplus éventuel.
  const [refundAmount, setRefundAmount] = useState('');
  const [linkingRefund, setLinkingRefund] = useState<Transaction | null>(null);
  const [addType, setAddType] = useState<TransactionType>('expense');
  const [quickType, setQuickType] = useState<Exclude<TransactionType, 'transfer'>>('expense');
  const [addTagIds, setAddTagIds] = useState<number[]>([]);
  const [addSplitEnabled, setAddSplitEnabled] = useState(false);
  const [addSplits, setAddSplits] = useState<SplitDraft[]>(() => [emptySplitDraft(), emptySplitDraft()]);
  // Montants suivis en miroir des champs (inputs non contrôlés) pour que
  // l'éditeur de ventilation affiche cible / reste en direct.
  const [addAmount, setAddAmount] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editType, setEditType] = useState<TransactionType>('expense');
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [editSplitEnabled, setEditSplitEnabled] = useState(false);
  const [editSplits, setEditSplits] = useState<SplitDraft[]>([]);
  const [filterTagId, setFilterTagId] = usePersistedState<string>('tx_filter_tag', 'all');
  const [bulkEditing, setBulkEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = usePersistedState<'all' | TransactionType>('tx_filter_type', 'all');
  const [filterCategoryId, setFilterCategoryId] = usePersistedState<string>('tx_filter_category', 'all');
  const [filterAccountGroup, setFilterAccountGroup] = usePersistedState<string>('tx_filter_account_group', 'all');
  const [filterCleared, setFilterCleared] = usePersistedState<'all' | 'cleared' | 'uncleared'>('tx_filter_cleared', 'all');
  const [sort, setSort] = usePersistedState<TxSort>('tx_sort', { key: 'date', dir: 'desc' });
  const [compact, setCompact] = usePersistedState<boolean>('tx_compact', false);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('tx_add_open', transactions.length === 0);

  // Transaction à mettre en évidence après un drill-down (param `tx`) : la
  // ligne est surlignée et la pagination saute jusqu'à elle.
  const [highlightId, setHighlightId] = useState<number | null>(null);
  // Champ montant de la saisie rapide : refocalisé après un ajout (saisies en
  // chaîne) et ciblé par le raccourci global `n` (?focus=quick).
  const quickAmountRef = useRef<HTMLInputElement>(null);

  // Deep-links de drill-down depuis les pages de visu (donut → catégorie,
  // marchand → recherche, KPI → type, popover des stats → transaction
  // précise). Tous les autres filtres sont remis à zéro pour que la cible
  // soit réellement visible (un filtre « non pointées » ou un tag résiduel
  // cacherait tout), puis les paramètres sont retirés de l'URL.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const category = searchParams.get('category');
    const q = searchParams.get('q');
    const monthParam = searchParams.get('month');
    const txParam = searchParams.get('tx');
    const typeParam = searchParams.get('type');
    const focusParam = searchParams.get('focus');
    if (category === null && q === null && monthParam === null && txParam === null && typeParam === null && focusParam === null) return;
    if (focusParam === 'quick') quickAmountRef.current?.focus();
    if (category !== null || q !== null || monthParam !== null || txParam !== null || typeParam !== null) {
      setFilterType(typeParam === 'income' || typeParam === 'expense' || typeParam === 'transfer' ? typeParam : 'all');
      setFilterAccountGroup('all');
      setFilterTagId('all');
      setFilterCleared('all');
      setFilterCategoryId(category ?? 'all');
      setQuery(q ?? '');
      if (monthParam !== null) onMonthChange(monthParam);
      if (txParam !== null) setHighlightId(Number(txParam));
      if (issueFilter) onClearIssueFilter();
    }
    setSearchParams({}, { replace: true });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // La surbrillance s'éteint d'elle-même ; assez long pour couvrir le
  // rechargement du mois ciblé.
  useEffect(() => {
    if (highlightId === null) return;
    const timer = window.setTimeout(() => setHighlightId(null), 8000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  // Any change to what's shown (search, filters, sort, source list) sends the
  // user back to the first page so they aren't stranded on an out-of-range one.
  useEffect(() => {
    setPage(1);
  }, [query, filterType, filterCategoryId, filterAccountGroup, filterTagId, filterCleared, sort.key, sort.dir, issueFilter]);

  // Filtres persistés entre sessions : un filtre oublié de la veille peut
  // vider la liste sans explication visible. Le compteur + reset rendent
  // l'état explicite et réparable d'un clic.
  const activeFilterCount = [
    filterType !== 'all',
    filterCategoryId !== 'all',
    filterAccountGroup !== 'all',
    filterTagId !== 'all',
    filterCleared !== 'all',
    query.trim() !== '',
  ].filter(Boolean).length;
  const resetFilters = () => {
    setFilterType('all');
    setFilterCategoryId('all');
    setFilterAccountGroup('all');
    setFilterTagId('all');
    setFilterCleared('all');
    setQuery('');
  };

  // Clicking a header toggles direction if it's already the sort key, otherwise
  // switches to it with a sensible default (recent/biggest first for date/amount,
  // alphabetical for text columns).
  const toggleSort = (key: TxSortKey) => {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' });
  };

  const filteredAddCategories = categories.filter((c) => c.type === addType || addType === 'transfer');
  const filteredEditCategories = categories.filter((c) => c.type === editType || editType === 'transfer');
  const filteredQuickCategories = categories.filter((c) => c.type === quickType);
  const sourceTransactions = issueFilter === 'unassigned_account' ? unassignedTransactions : transactions;
  const filteredTransactions = sourceTransactions.filter((t) => {
    const sourceAccount = accountById.get(t.account_id ?? -1);
    const destinationAccount = accountById.get(t.to_account_id ?? -1);
    const groups = [
      sourceAccount ? accountTypeGroup(sourceAccount.type) : null,
      destinationAccount ? accountTypeGroup(destinationAccount.type) : null,
    ];
    const haystack = [
      t.description,
      sourceAccount?.name,
      destinationAccount?.name,
      categoryById.get(t.category_id ?? -1)?.name,
      ...(t.splits ?? []).map((split) => categoryById.get(split.category_id)?.name),
      money(t.amount, sourceAccount?.currency ?? 'EUR'),
      String(t.amount),
      new Date(t.date).toLocaleDateString('fr-FR'),
    ].filter(Boolean).join(' ').toLowerCase();
    const tagMatch = filterTagId === 'all'
      || (t.tags ?? []).some((tag) => String(tag.id) === filterTagId);
    // Une transaction ventilée appartient à toutes les catégories de ses splits.
    const categoryMatch = filterCategoryId === 'all'
      || String(t.category_id ?? '') === filterCategoryId
      || (t.splits ?? []).some((split) => String(split.category_id) === filterCategoryId);
    return (filterType === 'all' || t.type === filterType)
      && categoryMatch
      && (filterAccountGroup === 'all' || groups.includes(filterAccountGroup as ReturnType<typeof accountTypeGroup>))
      && (filterCleared === 'all' || (filterCleared === 'cleared') === t.cleared)
      && tagMatch
      && haystack.includes(query.trim().toLowerCase());
  });
  const sortDir = sort.dir === 'asc' ? 1 : -1;
  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case 'date': cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
      case 'amount': cmp = a.amount - b.amount; break;
      case 'type': cmp = typeLabel(a.type).localeCompare(typeLabel(b.type), 'fr'); break;
      case 'label': cmp = txLabel(a, categoryById).localeCompare(txLabel(b, categoryById), 'fr'); break;
    }
    // Stable, deterministic tiebreak so equal keys keep a consistent order.
    if (cmp === 0) cmp = a.id - b.id;
    return cmp * sortDir;
  });
  const totalPages = Math.max(1, Math.ceil(sortedTransactions.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedTransactions = sortedTransactions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Drill-down : une fois la cible présente dans la liste (le mois peut
  // arriver après un reload), saute à sa page. Déclaré après l'effet de
  // remise à la page 1 pour gagner quand les deux écrivent au même commit.
  const highlightIndex = highlightId !== null
    ? sortedTransactions.findIndex((t) => t.id === highlightId)
    : -1;
  useEffect(() => {
    if (highlightIndex >= 0) setPage(Math.floor(highlightIndex / PAGE_SIZE) + 1);
  }, [highlightIndex]);
  // À l'ouverture de la modale, pré-remplit le montant avec le reste remboursable.
  useEffect(() => {
    if (refundingExpense) {
      setRefundAmount(String(Math.max(0.01, roundAmount(refundingExpense.amount - refundedAmount(refundingExpense)))));
    }
  }, [refundingExpense]);
  const pageStart = sortedTransactions.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, sortedTransactions.length);
  // Récap aligné sur le dashboard : la part remboursement d'un revenu annule une
  // dépense (n'est pas comptée en revenu), seul l'éventuel surplus est un revenu.
  const txTotals = filteredTransactions.reduce((acc, t) => {
    if (t.type === 'income') {
      const refundPart = refundAllocatedAmount(t);
      acc.income += t.amount - refundPart;
      acc.expenses -= refundPart;
    }
    if (t.type === 'expense') acc.expenses += t.amount;
    if (t.type === 'transfer') acc.transfers += t.amount;
    return acc;
  }, { income: 0, expenses: 0, transfers: 0 });

  const startEdit = (t: Transaction) => {
    setEditType(t.type);
    setEditTagIds((t.tags ?? []).map((tag) => tag.id));
    setEditSplitEnabled((t.splits ?? []).length > 0);
    setEditSplits(splitDraftsFromTransaction(t));
    setEditAmount(String(t.amount));
    setEditing(t);
  };

  // Action « Ventiler » d'une ligne : ouvre l'édition avec l'éditeur de
  // ventilation déjà actif, prérempli depuis la catégorie/le montant actuels.
  const startSplit = (t: Transaction) => {
    setEditType(t.type);
    setEditTagIds((t.tags ?? []).map((tag) => tag.id));
    const drafts = splitDraftsFromTransaction(t);
    setEditSplits(drafts.length > 0 ? drafts : prefilledSplitDrafts(t.category_id, t.amount));
    setEditSplitEnabled(true);
    setEditAmount(String(t.amount));
    setEditing(t);
  };

  const copyTransaction = (t: Transaction) => {
    setEditType(t.type);
    setEditTagIds((t.tags ?? []).map((tag) => tag.id));
    setEditSplitEnabled((t.splits ?? []).length > 0);
    setEditSplits(splitDraftsFromTransaction(t));
    setEditAmount(String(t.amount));
    setEditing({ ...t, id: -t.id, date: todayIso(), created_at: todayIso() });
  };

  const closeModal = () => setEditing(null);

  const selectedTransactions = sourceTransactions.filter((t) => selectedIds.has(t.id));
  const selectedCount = selectedTransactions.length;

  const setTransactionSelected = (transactionId: number, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(transactionId);
      else next.delete(transactionId);
      return next;
    });
  };

  const setVisibleTransactionsSelected = (selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const transaction of pagedTransactions) {
        if (selected) next.add(transaction.id);
        else next.delete(transaction.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const updateTransactionInline = (
    transaction: Transaction,
    patch: Partial<Pick<Transaction, 'account_id' | 'to_account_id' | 'category_id'>>,
  ) => {
    void run(() => api.updateTransaction(userId, transaction.id, patch), 'Transaction modifiée');
  };

  const toggleCleared = (transaction: Transaction) => {
    void run(
      () => api.updateTransaction(userId, transaction.id, { cleared: !transaction.cleared }),
      transaction.cleared ? 'Transaction dépointée' : 'Transaction pointée',
    );
  };

  // Pointage en masse de la sélection (rapprochement d'un relevé en un clic).
  const setSelectionCleared = (cleared: boolean) => {
    if (selectedTransactions.length === 0) return;
    const ids = selectedTransactions.map((t) => t.id);
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, cleared }),
      (result) => `${(result as { updated: number }).updated} transactions ${cleared ? 'pointées' : 'dépointées'}`,
    ).then((ok) => { if (ok) clearSelection(); });
  };

  // Suppression en masse de la sélection (ex: nettoyage d'un import raté).
  const deleteSelection = () => {
    if (selectedTransactions.length === 0) return;
    if (!window.confirm(`Supprimer définitivement ${selectedCount} transaction${selectedCount > 1 ? 's' : ''} ? Cette action est irréversible.`)) return;
    const ids = selectedTransactions.map((t) => t.id);
    void run(
      () => api.bulkDeleteTransactions(userId, ids),
      (result) => `${(result as { deleted: number }).deleted} transactions supprimées`,
    ).then((ok) => { if (ok) clearSelection(); });
  };

  // Ajout d'un tag à toute la sélection (taguer 20 lignes « vacances » d'un coup).
  const addTagToSelection = (tagId: number) => {
    if (selectedTransactions.length === 0 || !Number.isFinite(tagId) || tagId <= 0) return;
    const ids = selectedTransactions.map((t) => t.id);
    const tagName = tags.find((tag) => tag.id === tagId)?.name ?? 'tag';
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, add_tag_id: tagId }),
      (result) => `${(result as { updated: number }).updated} transactions taguées « ${tagName} »`,
    ).then((ok) => { if (ok) clearSelection(); });
  };

  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const splits = addType !== 'transfer' && addSplitEnabled ? splitPayloadFromDrafts(addSplits) : undefined;
    const body = {
      account_id: numberOrNull(data.get('account_id')),
      to_account_id: addType === 'transfer' ? numberOrNull(data.get('to_account_id')) : null,
      category_id: addType === 'transfer' || (splits && splits.length > 0) ? null : numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: addType,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
      tag_ids: addTagIds,
      ...(splits ? { splits } : {}),
    };
    // Le formulaire n'est vidé qu'après un succès : en cas d'erreur serveur,
    // la saisie reste en place pour corriger et resoumettre.
    void run(() => api.createTransaction(userId, body), 'Transaction ajoutée').then((ok) => {
      if (!ok) return;
      form.reset();
      setAddType('expense');
      setAddTagIds([]);
      setAddSplitEnabled(false);
      setAddSplits([emptySplitDraft(), emptySplitDraft()]);
      setAddAmount('');
    });
  };

  const submitQuick = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.createTransaction(userId, {
      account_id: numberOrNull(data.get('account_id')),
      category_id: numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: quickType,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
    }), 'Transaction ajoutée').then((ok) => {
      if (!ok) return;
      form.reset();
      setQuickType('expense');
      // Saisies en chaîne : le curseur revient sur le montant.
      quickAmountRef.current?.focus();
    });
  };

  // Recrée une transaction supprimée (action « Annuler » du toast). Les liens
  // que d'autres transactions portaient vers elle (remboursements reçus) ne
  // sont pas restaurés — la transaction recréée a un nouvel id.
  const recreateBody = (t: Transaction) => ({
    account_id: t.account_id,
    to_account_id: t.to_account_id,
    category_id: (t.splits ?? []).length > 0 ? null : t.category_id,
    amount: t.amount,
    to_amount: t.to_amount,
    type: t.type,
    date: t.date.slice(0, 10),
    description: t.description,
    cleared: t.cleared,
    tag_ids: (t.tags ?? []).map((tag) => tag.id),
    splits: (t.splits ?? []).map((split) => ({ category_id: split.category_id, amount: split.amount, note: split.note })),
  });

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    const splits = editType !== 'transfer' ? (editSplitEnabled ? splitPayloadFromDrafts(editSplits) : []) : [];
    const body = {
      account_id: numberOrNull(data.get('account_id')),
      to_account_id: editType === 'transfer' ? numberOrNull(data.get('to_account_id')) : null,
      category_id: editType === 'transfer' || splits.length > 0 ? null : numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: editType,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
      tag_ids: editTagIds,
      splits,
    };
    const action = editing.id > 0
      ? run(() => api.updateTransaction(userId, editing.id, body), 'Transaction modifiée')
      : run(() => api.createTransaction(userId, body), 'Transaction copiée');
    void action.then((ok) => {
      if (ok) closeModal();
    });
  };

  const submitBulkEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedTransactions.length === 0) return;
    const data = new FormData(event.currentTarget);
    const body: Partial<Pick<Transaction, 'account_id' | 'category_id'>> = {};
    if (data.get('apply_account') === 'on') {
      body.account_id = numberOrNull(data.get('account_id'));
    }
    if (data.get('apply_category') === 'on') {
      body.category_id = numberOrNull(data.get('category_id'));
    }
    if (Object.keys(body).length === 0) return;
    const ids = selectedTransactions.map((t) => t.id);
    void run(
      () => api.bulkUpdateTransactions(userId, { ids, ...body }),
      (result) => `${(result as { updated: number }).updated} transactions modifiées`,
    );
    setBulkEditing(false);
    clearSelection();
  };

  const submitRefund = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!refundingExpense) return;
    const data = new FormData(event.currentTarget);
    const amount = Number(refundAmount);
    // Un remboursement peut dépasser la dépense (assurance, geste commercial…).
    // On ne peut nette que ce qui a été dépensé : l'allocation est plafonnée au
    // reste remboursable de la dépense, le surplus restant un simple revenu.
    const remainingExpense = roundAmount(refundingExpense.amount - refundedAmount(refundingExpense));
    const allocationAmount = roundAmount(Math.min(amount, Math.max(0, remainingExpense)));
    void run(() => api.createTransaction(userId, {
      type: 'income',
      refund_allocations: allocationAmount > 0
        ? [{ expense_transaction_id: refundingExpense.id, amount: allocationAmount }]
        : [],
      account_id: numberOrNull(data.get('account_id')),
      category_id: null,
      amount,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
    }), 'Remboursement enregistré');
    setRefundingExpense(null);
  };

  const submitRecurringLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!linking) return;
    const data = new FormData(event.currentTarget);
    const recurringId = numberOrNull(data.get('recurring_transaction_id'));
    void run(() => api.linkTransactionRecurring(userId, linking.id, {
      recurring_transaction_id: recurringId,
      sync_description: data.get('sync_description') === 'on',
      sync_amount: data.get('sync_amount') === 'on',
      sync_category_account: data.get('sync_category_account') === 'on',
    }), recurringId ? 'Transaction liée à la récurrence' : 'Lien récurrence retiré');
    setLinking(null);
  };

  return (
    <section className="stack">
      <form className="quick-entry" onSubmit={submitQuick}>
        <div className="quick-type-toggle" role="group" aria-label="Type de transaction">
          <button type="button" className={quickType === 'expense' ? 'active' : ''} onClick={() => setQuickType('expense')}>Dépense</button>
          <button type="button" className={quickType === 'income' ? 'active' : ''} onClick={() => setQuickType('income')}>Revenu</button>
        </div>
        <input ref={quickAmountRef} name="amount" type="number" min="0.01" step="0.01" placeholder="Montant" required />
        <input name="description" placeholder="Libellé" />
        <select name="category_id">
          <option value="">Catégorie</option>
          {filteredQuickCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select name="account_id">
          <option value="">Compte</option>
          {pickableAccounts(accounts).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <input name="date" type="date" defaultValue={todayIso()} required />
        <button className="primary"><Plus size={16} /> Ajouter</button>
      </form>
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setAddOpen(!addOpen)}
          aria-expanded={addOpen}
        >
          <span className="collapsible-title"><Plus size={16} /> Ajouter une transaction</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <form className="form form-inline" onSubmit={submitAdd}>
              <label>Type
                <select value={addType} onChange={(e) => setAddType(e.target.value as TransactionType)}>
                  <option value="expense">Dépense</option>
                  <option value="income">Revenu</option>
                  <option value="transfer">Transfert</option>
                </select>
              </label>
              <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
              <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required onChange={(e) => setAddAmount(e.target.value)} /></label>
              <label>{addType === 'transfer' ? 'Depuis le compte' : 'Compte'}
                <select name="account_id" required={addType === 'transfer'}>
                  <option value="">Aucun</option>
                  {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              {addType === 'transfer'
                ? <label>Vers le compte<select name="to_account_id" required><option value="">Choisir...</option>{pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                : (
                  <>
                    <label>Catégorie<select name="category_id" disabled={addSplitEnabled}><option value="">Aucune</option>{filteredAddCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                    <label className="checkbox-row inline-checkbox">
                      <input
                        type="checkbox"
                        checked={addSplitEnabled}
                        onChange={(e) => {
                          setAddSplitEnabled(e.target.checked);
                          // Préremplit la 1re ligne avec la catégorie/le montant déjà
                          // saisis dans le formulaire (lus via le form du checkbox).
                          if (e.target.checked && addSplits.every((d) => !d.category_id && !d.amount)) {
                            const form = e.target.form;
                            const category = (form?.elements.namedItem('category_id') as HTMLSelectElement | null)?.value ?? '';
                            const amount = (form?.elements.namedItem('amount') as HTMLInputElement | null)?.value ?? '';
                            setAddSplits(prefilledSplitDrafts(category, amount));
                          }
                        }}
                      />
                      Ventiler
                    </label>
                  </>
                )}
              <label className="grow">Description<input name="description" placeholder="Ex: Carrefour, salaire, loyer..." /></label>
              <label className="grow">Tags<TagPicker value={addTagIds} tags={tags} onChange={setAddTagIds} /></label>
              {addType !== 'transfer' && addSplitEnabled && (
                <SplitEditor
                  drafts={addSplits}
                  categories={filteredAddCategories}
                  targetAmount={Number(addAmount) || 0}
                  onChange={setAddSplits}
                />
              )}
              <button className="primary"><Plus size={16} /> Ajouter</button>
            </form>
          </Collapsible>
      </div>

      <Panel title={issueFilter === 'unassigned_account' ? 'Transactions sans compte' : 'Historique du mois'}>
        {issueFilter === 'unassigned_account' && (
          <div className="bulk-bar">
            <strong>Toutes périodes</strong>
            <span>Ces revenus/dépenses sont comptés dans les Liquidités tant qu'aucun compte n'est rattaché.</span>
            <button type="button" className="secondary" onClick={onClearIssueFilter}>Revenir au mois courant</button>
          </div>
        )}
        <div className="table-tools">
          <div className="search-box inline">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher date, compte, catégorie..." />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as 'all' | TransactionType)}>
            <option value="all">Tous les types</option>
            <option value="expense">Dépenses</option>
            <option value="income">Revenus</option>
            <option value="transfer">Transferts</option>
          </select>
          <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)} aria-label="Filtre de catégorie">
            <option value="all">Toutes les catégories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterAccountGroup} onChange={(e) => setFilterAccountGroup(e.target.value)}>
            <option value="all">Tous les comptes</option>
            {ACCOUNT_GROUPS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={filterTagId} onChange={(e) => setFilterTagId(e.target.value)}>
            <option value="all">Tous les tags</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={filterCleared} onChange={(e) => setFilterCleared(e.target.value as 'all' | 'cleared' | 'uncleared')} aria-label="Filtre de pointage">
            <option value="all">Pointées ou non</option>
            <option value="cleared">Pointées</option>
            <option value="uncleared">Non pointées</option>
          </select>
          {activeFilterCount > 0 && (
            <button type="button" className="filter-reset" onClick={resetFilters}>
              {activeFilterCount} filtre{activeFilterCount > 1 ? 's' : ''} actif{activeFilterCount > 1 ? 's' : ''} · Réinitialiser
            </button>
          )}
        </div>
        <div className="tx-summary">
          <span><strong>{filteredTransactions.length}</strong> lignes</span>
          <span className="income">+ {money(txTotals.income)}</span>
          <span className="expense">- {money(txTotals.expenses)}</span>
          <span className="transfer">{money(txTotals.transfers)} transférés</span>
          <button
            type="button"
            className="ghost-button tx-density-toggle"
            onClick={() => setCompact(!compact)}
            title={compact ? 'Affichage confortable' : 'Affichage compact'}
          >
            {compact ? <Rows3 size={15} /> : <Rows2 size={15} />}
            {compact ? 'Confortable' : 'Compact'}
          </button>
        </div>
        {selectedCount > 0 && (
          <div className="bulk-bar">
            <strong>{selectedCount} sélectionnée{selectedCount > 1 ? 's' : ''}</strong>
            <button type="button" className="secondary" onClick={() => setBulkEditing(true)}>Modifier la sélection</button>
            {tags.length > 0 && (
              <select
                className="bulk-tag-select"
                aria-label="Ajouter un tag à la sélection"
                value=""
                onChange={(e) => { if (e.target.value) addTagToSelection(Number(e.target.value)); }}
              >
                <option value="">Ajouter un tag…</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <button type="button" className="secondary" onClick={() => setSelectionCleared(true)}>Pointer</button>
            <button type="button" className="ghost-button" onClick={() => setSelectionCleared(false)}>Dépointer</button>
            <button type="button" className="danger" onClick={deleteSelection}>Supprimer</button>
            <button type="button" className="ghost-button" onClick={clearSelection}>Désélectionner</button>
          </div>
        )}
        <TransactionsTable
          transactions={pagedTransactions}
          emptyMessage={issueFilter === 'unassigned_account' ? 'Aucune transaction sans compte.' : 'Aucune transaction sur ce mois.'}
          compact={compact}
          categories={categories}
          accounts={accounts}
          categoryById={categoryById}
          accountById={accountById}
          selectedIds={selectedIds}
          sort={sort}
          onSort={toggleSort}
          onSelect={setTransactionSelected}
          onSelectAll={setVisibleTransactionsSelected}
          onInlineUpdate={updateTransactionInline}
          onEdit={startEdit}
          onCopy={copyTransaction}
          onLink={setLinking}
          onSplit={startSplit}
          onRefund={(t) => (t.type === 'expense' ? setRefundingExpense(t) : setLinkingRefund(t))}
          onToggleCleared={toggleCleared}
          onAttachments={setAttachmentsFor}
          onDelete={(t) => void run(
            () => api.deleteTransaction(userId, t.id),
            'Transaction supprimée',
            { undo: () => api.createTransaction(userId, recreateBody(t)) },
          )}
          highlightId={highlightId}
        />
        {totalPages > 1 && (
          <div className="pagination">
            <button
              type="button"
              className="secondary"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} /> Précédent
            </button>
            <span className="pagination-info">{pageStart}–{pageEnd} sur {sortedTransactions.length} · page {currentPage}/{totalPages}</span>
            <button
              type="button"
              className="secondary"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        )}
      </Panel>

      {editing && (
        <Modal title={editing.id > 0 ? 'Modifier la transaction' : 'Copier la transaction'} onClose={closeModal}>
          <form className="form" onSubmit={submitEdit}>
            <label>Type
              <select value={editType} onChange={(e) => setEditType(e.target.value as TransactionType)}>
                <option value="expense">Dépense</option>
                <option value="income">Revenu</option>
                <option value="transfer">Transfert</option>
              </select>
            </label>
            <label>Date<input name="date" type="date" defaultValue={editing.date.slice(0, 10)} required /></label>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" defaultValue={editing.amount} required onChange={(e) => setEditAmount(e.target.value)} /></label>
            <label>{editType === 'transfer' ? 'Depuis le compte' : 'Compte'}
              <select name="account_id" defaultValue={editing.account_id ?? ''} required={editType === 'transfer'}>
                <option value="">Aucun</option>
                {pickableAccounts(accounts, editing.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {editType === 'transfer'
              ? <label>Vers le compte<select name="to_account_id" defaultValue={editing.to_account_id ?? ''} required><option value="">Choisir...</option>{pickableAccounts(accounts, editing.to_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              : (
                <>
                  <label>Catégorie<select name="category_id" defaultValue={editing.category_id ?? ''} disabled={editSplitEnabled}><option value="">Aucune</option>{filteredEditCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label className="checkbox-row inline-checkbox">
                    <input
                      type="checkbox"
                      checked={editSplitEnabled}
                      onChange={(e) => {
                        setEditSplitEnabled(e.target.checked);
                        if (e.target.checked && editSplits.every((d) => !d.category_id && !d.amount)) {
                          const form = e.target.form;
                          const category = (form?.elements.namedItem('category_id') as HTMLSelectElement | null)?.value ?? '';
                          const amount = (form?.elements.namedItem('amount') as HTMLInputElement | null)?.value ?? '';
                          setEditSplits(prefilledSplitDrafts(category, amount));
                        }
                      }}
                    />
                    Ventiler cette transaction
                  </label>
                </>
              )}
            <label className="full">Description<input name="description" defaultValue={editing.description ?? ''} placeholder="Ex: Carrefour, salaire, loyer..." /></label>
            <label className="full">Tags<TagPicker value={editTagIds} tags={tags} onChange={setEditTagIds} /></label>
            {editType !== 'transfer' && editSplitEnabled && (
              <SplitEditor
                drafts={editSplits}
                categories={filteredEditCategories}
                targetAmount={Number(editAmount) || 0}
                onChange={setEditSplits}
              />
            )}
            <button className="primary">{editing.id > 0 ? 'Enregistrer' : 'Créer la copie'}</button>
            <button type="button" className="secondary" onClick={closeModal}>Annuler</button>
          </form>
        </Modal>
      )}

      {bulkEditing && (
        <Modal title={`Modifier ${selectedCount} transaction${selectedCount > 1 ? 's' : ''}`} onClose={() => setBulkEditing(false)}>
          <form className="form" onSubmit={submitBulkEdit}>
            <label className="bulk-field">
              <span><input type="checkbox" name="apply_account" /> Changer le compte</span>
              <select name="account_id">
                <option value="">Sans compte</option>
                {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="bulk-field">
              <span><input type="checkbox" name="apply_category" /> Changer la catégorie</span>
              <select name="category_id">
                <option value="">Sans catégorie</option>
                <optgroup label="Dépenses">
                  {categories.filter((c) => c.type === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
                <optgroup label="Revenus">
                  {categories.filter((c) => c.type === 'income').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              </select>
            </label>
            <button className="primary">Appliquer aux transactions sélectionnées</button>
            <button type="button" className="secondary" onClick={() => setBulkEditing(false)}>Annuler</button>
          </form>
        </Modal>
      )}

      {refundingExpense && (
        <Modal title="Enregistrer un remboursement" onClose={() => setRefundingExpense(null)}>
          <form className="form" onSubmit={submitRefund}>
            <label className="full">Dépense remboursée
              <input
                value={`${new Date(refundingExpense.date).toLocaleDateString('fr-FR')} - ${txLabel(refundingExpense, categoryById)} (${money(refundingExpense.amount, accountById.get(refundingExpense.account_id ?? -1)?.currency ?? 'EUR')})`}
                readOnly
              />
            </label>
            {refundedAmount(refundingExpense) > 0 && (
              <p className="panel-note">
                Déjà remboursé : {money(refundedAmount(refundingExpense), accountById.get(refundingExpense.account_id ?? -1)?.currency ?? 'EUR')}
              </p>
            )}
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            <label>Montant
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                required
              />
            </label>
            {(() => {
              const remaining = Math.max(0, roundAmount(refundingExpense.amount - refundedAmount(refundingExpense)));
              const surplus = roundAmount(Number(refundAmount) - remaining);
              if (!(surplus > 0)) return null;
              const currency = accountById.get(refundingExpense.account_id ?? -1)?.currency ?? 'EUR';
              return (
                <p className="panel-note">
                  {money(remaining, currency)} viendront annuler la dépense ; le surplus de {money(surplus, currency)} sera compté comme revenu.
                </p>
              );
            })()}
            <label>Compte crédité
              <select name="account_id" defaultValue={refundingExpense.account_id ?? ''}>
                <option value="">Aucun</option>
                {pickableAccounts(accounts, refundingExpense.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="full">Description
              <input name="description" defaultValue={`Remboursement : ${txLabel(refundingExpense, categoryById)}`} />
            </label>
            <button className="primary">Enregistrer le remboursement</button>
            <button type="button" className="secondary" onClick={() => setRefundingExpense(null)}>Annuler</button>
          </form>
        </Modal>
      )}

      {linkingRefund && (
        <RefundLinkModal
          userId={userId}
          income={linkingRefund}
          accountById={accountById}
          categoryById={categoryById}
          onClose={() => setLinkingRefund(null)}
          onSubmit={(allocations) => {
            void run(
              () => api.updateTransaction(userId, linkingRefund.id, { refund_allocations: allocations }),
              allocations.length > 0
                ? `Remboursement ventilé sur ${allocations.length} dépense${allocations.length > 1 ? 's' : ''}`
                : 'Lien de remboursement retiré',
            );
            setLinkingRefund(null);
          }}
        />
      )}

      {linking && (
        <Modal title="Lier à une récurrence" onClose={() => setLinking(null)}>
          <form className="form" onSubmit={submitRecurringLink}>
            <label className="full">Transaction<input value={`${new Date(linking.date).toLocaleDateString('fr-FR')} - ${txLabel(linking, categoryById)}`} readOnly /></label>
            <label className="full">Récurrence<select name="recurring_transaction_id" defaultValue={linking.recurring_transaction_id ?? ''}>
              <option value="">Aucune</option>
              {recurring.filter((r) => r.type === linking.type || linking.type === 'transfer').map((r) => (
                <option key={r.id} value={r.id}>{r.description} - {money(r.amount, accountById.get(r.account_id ?? -1)?.currency ?? 'EUR')}</option>
              ))}
            </select></label>
            <label><input type="checkbox" name="sync_category_account" defaultChecked /> Synchroniser compte / catégorie / type</label>
            <label><input type="checkbox" name="sync_description" /> Renommer comme la récurrence</label>
            <label><input type="checkbox" name="sync_amount" /> Remplacer le montant par celui de la récurrence</label>
            <button className="primary">Lier</button>
            <button type="button" className="secondary" onClick={() => setLinking(null)}>Annuler</button>
          </form>
        </Modal>
      )}

      {attachmentsFor && attachmentsFor.id > 0 && (
        <AttachmentsModal
          userId={userId}
          transactionId={attachmentsFor.id}
          label={txLabel(attachmentsFor, categoryById)}
          run={run}
          onClose={() => setAttachmentsFor(null)}
        />
      )}
    </section>
  );
}

// Éditeur de ventilation : la somme des lignes doit atteindre le montant de la
// transaction (la « cible »). Le « reste » est affiché en direct et chaque
// ligne propose un bouton « solde » qui la complète avec le restant — le flux
// type « courses 80 € → nourriture 60, ménager [solde] » se fait en deux clics.
function SplitEditor({ drafts, categories, targetAmount, onChange }: {
  drafts: SplitDraft[];
  categories: Category[];
  targetAmount: number;
  onChange: (drafts: SplitDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<SplitDraft>) => {
    onChange(drafts.map((draft) => draft.key === key ? { ...draft, ...patch } : draft));
  };
  const remove = (key: string) => {
    const next = drafts.filter((draft) => draft.key !== key);
    onChange(next.length > 0 ? next : [emptySplitDraft()]);
  };
  const round = (value: number) => Math.round(value * 100) / 100;
  const total = round(drafts.reduce((sum, draft) => sum + (Number(draft.amount) || 0), 0));
  const remaining = round(targetAmount - total);
  const balanced = Math.abs(remaining) <= 0.01 && targetAmount > 0;
  // « Solde » d'une ligne = le restant en ignorant sa propre valeur actuelle.
  const fillRemaining = (key: string) => {
    const others = drafts.reduce((sum, draft) => draft.key === key ? sum : sum + (Number(draft.amount) || 0), 0);
    const value = round(targetAmount - others);
    if (value > 0) update(key, { amount: String(value) });
  };
  return (
    <div className="split-editor full">
      <div className="split-editor-head">
        <strong>Ventilation</strong>
        <span className={balanced ? 'split-balanced' : targetAmount > 0 ? 'split-unbalanced' : undefined}>
          {targetAmount > 0
            ? (balanced
              ? `✓ ${money(total)} ventilés`
              : `${money(total)} / ${money(round(targetAmount))} · reste ${money(remaining)}`)
            : `Total lignes : ${money(total)}`}
        </span>
      </div>
      {drafts.map((draft) => (
        <div className="split-editor-row" key={draft.key}>
          <select
            value={draft.category_id}
            onChange={(e) => update(draft.key, { category_id: e.target.value })}
            aria-label="Catégorie de ventilation"
          >
            <option value="">Catégorie</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <div className="split-amount-cell">
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={draft.amount}
              onChange={(e) => update(draft.key, { amount: e.target.value })}
              placeholder="Montant"
              aria-label="Montant ventilé"
            />
            <button
              type="button"
              className="ghost-button split-fill"
              onClick={() => fillRemaining(draft.key)}
              disabled={targetAmount <= 0}
              title="Compléter avec le restant"
            >
              solde
            </button>
          </div>
          <input
            value={draft.note}
            onChange={(e) => update(draft.key, { note: e.target.value })}
            placeholder="Note (ex: ménager)"
            aria-label="Note de ventilation"
          />
          <button type="button" className="ghost-button icon-only" onClick={() => remove(draft.key)} aria-label="Retirer la ligne">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="secondary split-add-row" onClick={() => onChange([...drafts, emptySplitDraft()])}>
        <Plus size={16} /> Ajouter une ligne
      </button>
    </div>
  );
}

// Lier un revenu à la dépense qu'il rembourse : recherche les dépenses (toutes
// périodes) côté serveur, présélectionne le lien existant le cas échéant.
function RefundLinkModal({ userId, income, accountById, categoryById, onClose, onSubmit }: {
  userId: number;
  income: Transaction;
  accountById: Map<number, Account>;
  categoryById: Map<number, Category>;
  onClose: () => void;
  onSubmit: (allocations: RefundAllocationDraft[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Record<number, string>>(() => {
    const allocations = income.refund_allocations ?? [];
    if (allocations.length > 0) {
      return Object.fromEntries(allocations.map((allocation) => [
        allocation.expense_transaction_id,
        String(allocation.amount),
      ]));
    }
    return income.refunds_transaction_id != null ? { [income.refunds_transaction_id]: String(income.amount) } : {};
  });
  const [searching, setSearching] = useState(false);
  const selectedTotal = roundAmount(Object.values(selected).reduce((sum, value) => sum + (Number(value) || 0), 0));
  const selectedCount = Object.keys(selected).length;
  const overAllocated = selectedTotal - income.amount > 0.01;
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const existingAllocationByExpenseId = new Map((income.refund_allocations ?? []).map((allocation) => [allocation.expense_transaction_id, allocation]));
  // Reste remboursable d'une dépense : son montant moins ce que d'autres revenus
  // ont déjà remboursé (l'allocation du revenu courant, remplacée, est exclue).
  const remainingForExpense = (t: Transaction) =>
    roundAmount(t.amount - (refundedAmount(t) - (existingAllocationByExpenseId.get(t.id)?.amount ?? 0)));
  // On ne peut nette qu'une dépense réelle : un montant alloué supérieur à ce
  // reste serait refusé côté serveur. On le signale plutôt que de tenter.
  const overAllocatedExpenseIds = new Set(
    candidates
      .filter((t) => selected[t.id] !== undefined && (Number(selected[t.id]) || 0) - remainingForExpense(t) > 0.01)
      .map((t) => t.id),
  );

  // Recherche débouncée côté serveur ; sans requête on liste les plus récentes.
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.findTransactions(userId, { type: 'expense', q: query.trim() || undefined, limit: 20 })
        .then((rows) => { if (!cancelled) setCandidates(rows); })
        .catch(() => { if (!cancelled) setCandidates([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, query]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const allocations = Object.entries(selected)
      .map(([expenseId, amountValue]) => ({
        expense_transaction_id: Number(expenseId),
        amount: roundAmount(Number(amountValue)),
      }))
      .filter((allocation) => Number.isFinite(allocation.expense_transaction_id) && allocation.expense_transaction_id > 0 && allocation.amount > 0);
    if (allocations.length === 0 || overAllocated || overAllocatedExpenseIds.size > 0) return;
    onSubmit(allocations);
  };

  const updateSelectedAmount = (expenseId: number, amount: string) => {
    setSelected((current) => ({ ...current, [expenseId]: amount }));
  };

  const toggleExpense = (transaction: Transaction, checked: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      if (!checked) {
        delete next[transaction.id];
        return next;
      }
      const alreadySelected = Object.entries(next)
        .filter(([expenseId]) => Number(expenseId) !== transaction.id)
        .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0);
      const remainingIncome = Math.max(0.01, income.amount - alreadySelected);
      const remainingExpense = Math.max(0.01, transaction.amount - refundedAmount(transaction));
      next[transaction.id] = String(roundAmount(Math.min(remainingIncome, remainingExpense)));
      return next;
    });
  };

  const expenseLabel = (expenseId: number) => {
    const candidate = candidateById.get(expenseId);
    if (candidate) {
      return `${new Date(candidate.date).toLocaleDateString('fr-FR')} · ${txLabel(candidate, categoryById)}`;
    }
    const existing = existingAllocationByExpenseId.get(expenseId)?.expense_transaction;
    if (existing) {
      return `${new Date(existing.date).toLocaleDateString('fr-FR')} · ${existing.description ?? `Dépense #${existing.id}`}`;
    }
    return `Dépense #${expenseId}`;
  };

  return (
    <Modal title="Ventiler le remboursement" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="full">Remboursement
          <input
            value={`${new Date(income.date).toLocaleDateString('fr-FR')} - ${txLabel(income, categoryById)} (+${money(income.amount, accountById.get(income.account_id ?? -1)?.currency ?? 'EUR')})`}
            readOnly
          />
        </label>
        <div className={`full refund-allocation-total ${overAllocated ? 'error' : ''}`}>
          <span>Alloué : {money(selectedTotal, accountById.get(income.account_id ?? -1)?.currency ?? 'EUR')}</span>
          <span>Reste : {money(Math.max(0, roundAmount(income.amount - selectedTotal)), accountById.get(income.account_id ?? -1)?.currency ?? 'EUR')}</span>
        </div>
        {selectedCount > 0 && (
          <div className="full refund-selected-list">
            {Object.entries(selected).map(([expenseId, amount]) => (
              <span key={expenseId}>
                {expenseLabel(Number(expenseId))} · {money(Number(amount) || 0, accountById.get(income.account_id ?? -1)?.currency ?? 'EUR')}
              </span>
            ))}
          </div>
        )}
        <label className="full">Chercher la dépense
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex: Carrefour, restaurant..."
            autoFocus
          />
        </label>
        <div className="full refund-candidates">
          {searching && candidates.length === 0 && <p className="empty">Recherche…</p>}
          {!searching && candidates.length === 0 && <p className="empty">Aucune dépense trouvée.</p>}
          {candidates.map((t) => {
            const currency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
            const refunded = refundedAmount(t);
            const checked = selected[t.id] !== undefined;
            const expenseOver = overAllocatedExpenseIds.has(t.id);
            return (
              <div key={t.id} className="refund-candidate">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleExpense(t, event.target.checked)}
                />
                <span>
                  {new Date(t.date).toLocaleDateString('fr-FR')} · {txLabel(t, categoryById)} · {money(t.amount, currency)}
                  {refunded > 0 && ` (déjà remboursé ${money(refunded, currency)})`}
                </span>
                {checked && (
                  <input
                    className={`refund-allocation-input ${expenseOver ? 'error' : ''}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={selected[t.id]}
                    onChange={(event) => updateSelectedAmount(t.id, event.target.value)}
                    aria-label={`Montant alloué à ${txLabel(t, categoryById)}`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {overAllocated && <p className="panel-note error">Le total alloué dépasse le montant du remboursement.</p>}
        {overAllocatedExpenseIds.size > 0 && (
          <p className="panel-note error">Une allocation dépasse le reste remboursable de sa dépense.</p>
        )}
        <button className="primary" disabled={selectedCount === 0 || overAllocated || overAllocatedExpenseIds.size > 0}>Enregistrer la ventilation</button>
        {selectedCount > 0 && (
          <button type="button" className="secondary" onClick={() => onSubmit([])}>Retirer les liens</button>
        )}
        <button type="button" className="secondary" onClick={onClose}>Annuler</button>
      </form>
    </Modal>
  );
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}
