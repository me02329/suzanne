import { FormEvent, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, Rows2, Rows3, Search, Trash2 } from 'lucide-react';
import {
  ACCOUNT_GROUPS,
  accountTypeGroup,
  refundedAmount,
  type Account,
  type Category,
  type RecurringTransaction,
  type Tag,
  type Transaction,
  type TransactionType,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { numberOrNull } from '../lib/forms';
import { money, todayIso, txLabel, typeLabel } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { TagPicker } from '../components/TagPicker';
import { TransactionsTable, type TxSort, type TxSortKey } from '../components/TransactionsTable';

import type { Run } from '../lib/run';

const PAGE_SIZE = 50;

type SplitDraft = { key: string; category_id: string; amount: string; note: string };

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

export function Transactions({ userId, transactions, unassignedTransactions, issueFilter, onClearIssueFilter, recurring, accounts, categories, tags, categoryById, accountById, run }: {
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
  run: Run;
}) {
  // `editing` doubles as the modal trigger: open when non-null, closed otherwise.
  // Negative ids encode "copy" (no real backend row yet).
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [linking, setLinking] = useState<Transaction | null>(null);
  // Remboursements : dépense → créer le revenu lié ; revenu → choisir la dépense liée.
  const [refundingExpense, setRefundingExpense] = useState<Transaction | null>(null);
  const [linkingRefund, setLinkingRefund] = useState<Transaction | null>(null);
  const [addType, setAddType] = useState<TransactionType>('expense');
  const [quickType, setQuickType] = useState<Exclude<TransactionType, 'transfer'>>('expense');
  const [addTagIds, setAddTagIds] = useState<number[]>([]);
  const [addSplitEnabled, setAddSplitEnabled] = useState(false);
  const [addSplits, setAddSplits] = useState<SplitDraft[]>(() => [emptySplitDraft(), emptySplitDraft()]);
  const [editType, setEditType] = useState<TransactionType>('expense');
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [editSplitEnabled, setEditSplitEnabled] = useState(false);
  const [editSplits, setEditSplits] = useState<SplitDraft[]>([]);
  const [filterTagId, setFilterTagId] = usePersistedState<string>('tx_filter_tag', 'all');
  const [bulkEditing, setBulkEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = usePersistedState<'all' | TransactionType>('tx_filter_type', 'all');
  const [filterAccountGroup, setFilterAccountGroup] = usePersistedState<string>('tx_filter_account_group', 'all');
  const [sort, setSort] = usePersistedState<TxSort>('tx_sort', { key: 'date', dir: 'desc' });
  const [compact, setCompact] = usePersistedState<boolean>('tx_compact', false);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('tx_add_open', transactions.length === 0);

  // Any change to what's shown (search, filters, sort, source list) sends the
  // user back to the first page so they aren't stranded on an out-of-range one.
  useEffect(() => {
    setPage(1);
  }, [query, filterType, filterAccountGroup, filterTagId, sort.key, sort.dir, issueFilter]);

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
    return (filterType === 'all' || t.type === filterType)
      && (filterAccountGroup === 'all' || groups.includes(filterAccountGroup as ReturnType<typeof accountTypeGroup>))
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
  const pageStart = sortedTransactions.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, sortedTransactions.length);
  const txTotals = filteredTransactions.reduce((acc, t) => {
    if (t.type === 'income') acc.income += t.amount;
    if (t.type === 'expense') acc.expenses += t.amount;
    if (t.type === 'transfer') acc.transfers += t.amount;
    return acc;
  }, { income: 0, expenses: 0, transfers: 0 });

  const startEdit = (t: Transaction) => {
    setEditType(t.type);
    setEditTagIds((t.tags ?? []).map((tag) => tag.id));
    setEditSplitEnabled((t.splits ?? []).length > 0);
    setEditSplits(splitDraftsFromTransaction(t));
    setEditing(t);
  };

  const copyTransaction = (t: Transaction) => {
    setEditType(t.type);
    setEditTagIds((t.tags ?? []).map((tag) => tag.id));
    setEditSplitEnabled((t.splits ?? []).length > 0);
    setEditSplits(splitDraftsFromTransaction(t));
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
    });
  };

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
    void run(() => api.createTransaction(userId, {
      type: 'income',
      refunds_transaction_id: refundingExpense.id,
      account_id: numberOrNull(data.get('account_id')),
      category_id: null,
      amount: Number(data.get('amount')),
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
        <input name="amount" type="number" min="0.01" step="0.01" placeholder="Montant" required />
        <input name="description" placeholder="Libellé" />
        <select name="category_id">
          <option value="">Catégorie</option>
          {filteredQuickCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select name="account_id">
          <option value="">Compte</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
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
        {addOpen && (
          <div className="collapsible-body">
            <form className="form form-inline" onSubmit={submitAdd}>
              <label>Type
                <select value={addType} onChange={(e) => setAddType(e.target.value as TransactionType)}>
                  <option value="expense">Dépense</option>
                  <option value="income">Revenu</option>
                  <option value="transfer">Transfert</option>
                </select>
              </label>
              <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
              <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label>{addType === 'transfer' ? 'Depuis le compte' : 'Compte'}
                <select name="account_id" required={addType === 'transfer'}>
                  <option value="">Aucun</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              {addType === 'transfer'
                ? <label>Vers le compte<select name="to_account_id" required><option value="">Choisir...</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                : (
                  <>
                    <label>Catégorie<select name="category_id" disabled={addSplitEnabled}><option value="">Aucune</option>{filteredAddCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                    <label className="checkbox-row inline-checkbox">
                      <input
                        type="checkbox"
                        checked={addSplitEnabled}
                        onChange={(e) => {
                          setAddSplitEnabled(e.target.checked);
                          if (e.target.checked && addSplits.length === 0) setAddSplits([emptySplitDraft(), emptySplitDraft()]);
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
                  onChange={setAddSplits}
                />
              )}
              <button className="primary"><Plus size={16} /> Ajouter</button>
            </form>
          </div>
        )}
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
          <select value={filterAccountGroup} onChange={(e) => setFilterAccountGroup(e.target.value)}>
            <option value="all">Tous les comptes</option>
            {ACCOUNT_GROUPS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={filterTagId} onChange={(e) => setFilterTagId(e.target.value)}>
            <option value="all">Tous les tags</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
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
          onRefund={(t) => (t.type === 'expense' ? setRefundingExpense(t) : setLinkingRefund(t))}
          onDelete={(t) => void run(() => api.deleteTransaction(userId, t.id), 'Transaction supprimée')}
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
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" defaultValue={editing.amount} required /></label>
            <label>{editType === 'transfer' ? 'Depuis le compte' : 'Compte'}
              <select name="account_id" defaultValue={editing.account_id ?? ''} required={editType === 'transfer'}>
                <option value="">Aucun</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {editType === 'transfer'
              ? <label>Vers le compte<select name="to_account_id" defaultValue={editing.to_account_id ?? ''} required><option value="">Choisir...</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              : (
                <>
                  <label>Catégorie<select name="category_id" defaultValue={editing.category_id ?? ''} disabled={editSplitEnabled}><option value="">Aucune</option>{filteredEditCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label className="checkbox-row inline-checkbox">
                    <input
                      type="checkbox"
                      checked={editSplitEnabled}
                      onChange={(e) => {
                        setEditSplitEnabled(e.target.checked);
                        if (e.target.checked && editSplits.length === 0) setEditSplits([emptySplitDraft(), emptySplitDraft()]);
                      }}
                    />
                    Ventiler cette transaction
                  </label>
                </>
              )}
            <label className="full">Description<input name="description" defaultValue={editing.description ?? ''} placeholder="Ex: Carrefour, salaire, loyer..." /></label>
            <label className="full">Tags<TagPicker value={editTagIds} tags={tags} onChange={setEditTagIds} /></label>
            {editType !== 'transfer' && editSplitEnabled && (
              <SplitEditor drafts={editSplits} categories={filteredEditCategories} onChange={setEditSplits} />
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
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
                defaultValue={Math.max(0.01, Math.round((refundingExpense.amount - refundedAmount(refundingExpense)) * 100) / 100)}
                required
              />
            </label>
            <label>Compte crédité
              <select name="account_id" defaultValue={refundingExpense.account_id ?? ''}>
                <option value="">Aucun</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
          onSubmit={(expenseId) => {
            void run(
              () => api.updateTransaction(userId, linkingRefund.id, { refunds_transaction_id: expenseId }),
              expenseId ? 'Remboursement lié à la dépense' : 'Lien de remboursement retiré',
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
    </section>
  );
}

function SplitEditor({ drafts, categories, onChange }: {
  drafts: SplitDraft[];
  categories: Category[];
  onChange: (drafts: SplitDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<SplitDraft>) => {
    onChange(drafts.map((draft) => draft.key === key ? { ...draft, ...patch } : draft));
  };
  const remove = (key: string) => {
    const next = drafts.filter((draft) => draft.key !== key);
    onChange(next.length > 0 ? next : [emptySplitDraft()]);
  };
  const total = drafts.reduce((sum, draft) => sum + (Number(draft.amount) || 0), 0);
  return (
    <div className="split-editor full">
      <div className="split-editor-head">
        <strong>Ventilation</strong>
        <span>Total lignes : {money(Math.round(total * 100) / 100)}</span>
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
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={draft.amount}
            onChange={(e) => update(draft.key, { amount: e.target.value })}
            placeholder="Montant"
            aria-label="Montant ventilé"
          />
          <input
            value={draft.note}
            onChange={(e) => update(draft.key, { note: e.target.value })}
            placeholder="Note"
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
  onSubmit: (expenseId: number | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Transaction[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(income.refunds_transaction_id);
  const [searching, setSearching] = useState(false);

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
    if (selectedId == null) return;
    onSubmit(selectedId);
  };

  return (
    <Modal title="Lier à une dépense remboursée" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="full">Remboursement
          <input
            value={`${new Date(income.date).toLocaleDateString('fr-FR')} - ${txLabel(income, categoryById)} (+${money(income.amount, accountById.get(income.account_id ?? -1)?.currency ?? 'EUR')})`}
            readOnly
          />
        </label>
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
            return (
              <label key={t.id} className="refund-candidate">
                <input
                  type="radio"
                  name="refund_target"
                  checked={selectedId === t.id}
                  onChange={() => setSelectedId(t.id)}
                />
                <span>
                  {new Date(t.date).toLocaleDateString('fr-FR')} · {txLabel(t, categoryById)} · {money(t.amount, currency)}
                  {refunded > 0 && ` (déjà remboursé ${money(refunded, currency)})`}
                </span>
              </label>
            );
          })}
        </div>
        <button className="primary" disabled={selectedId == null}>Lier le remboursement</button>
        {income.refunds_transaction_id != null && (
          <button type="button" className="secondary" onClick={() => onSubmit(null)}>Retirer le lien</button>
        )}
        <button type="button" className="secondary" onClick={onClose}>Annuler</button>
      </form>
    </Modal>
  );
}
