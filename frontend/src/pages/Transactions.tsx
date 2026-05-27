import { FormEvent, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import {
  ACCOUNT_GROUPS,
  accountTypeGroup,
  type Account,
  type Category,
  type RecurringTransaction,
  type Transaction,
  type TransactionType,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { numberOrNull } from '../lib/forms';
import { money, todayIso, txLabel } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { TransactionsTable } from '../components/TransactionsTable';

import type { Run } from '../lib/run';

export function Transactions({ userId, transactions, recurring, accounts, categories, categoryById, accountById, run }: {
  userId: number;
  transactions: Transaction[];
  recurring: RecurringTransaction[];
  accounts: Account[];
  categories: Category[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  run: Run;
}) {
  // `editing` doubles as the modal trigger: open when non-null, closed otherwise.
  // Negative ids encode "copy" (no real backend row yet).
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [linking, setLinking] = useState<Transaction | null>(null);
  const [addType, setAddType] = useState<TransactionType>('expense');
  const [editType, setEditType] = useState<TransactionType>('expense');
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = usePersistedState<'all' | TransactionType>('tx_filter_type', 'all');
  const [filterAccountGroup, setFilterAccountGroup] = usePersistedState<string>('tx_filter_account_group', 'all');

  const filteredAddCategories = categories.filter((c) => c.type === addType || addType === 'transfer');
  const filteredEditCategories = categories.filter((c) => c.type === editType || editType === 'transfer');
  const filteredTransactions = transactions.filter((t) => {
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
      money(t.amount, sourceAccount?.currency ?? 'EUR'),
      String(t.amount),
      new Date(t.date).toLocaleDateString('fr-FR'),
    ].filter(Boolean).join(' ').toLowerCase();
    return (filterType === 'all' || t.type === filterType)
      && (filterAccountGroup === 'all' || groups.includes(filterAccountGroup as ReturnType<typeof accountTypeGroup>))
      && haystack.includes(query.trim().toLowerCase());
  });
  const txTotals = filteredTransactions.reduce((acc, t) => {
    if (t.type === 'income') acc.income += t.amount;
    if (t.type === 'expense') acc.expenses += t.amount;
    if (t.type === 'transfer') acc.transfers += t.amount;
    return acc;
  }, { income: 0, expenses: 0, transfers: 0 });

  const startEdit = (t: Transaction) => {
    setEditType(t.type);
    setEditing(t);
  };

  const copyTransaction = (t: Transaction) => {
    setEditType(t.type);
    setEditing({ ...t, id: -t.id, date: todayIso(), created_at: todayIso() });
  };

  const closeModal = () => setEditing(null);

  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      account_id: numberOrNull(data.get('account_id')),
      to_account_id: addType === 'transfer' ? numberOrNull(data.get('to_account_id')) : null,
      category_id: addType === 'transfer' ? null : numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: addType,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
    };
    void run(() => api.createTransaction(userId, body), 'Transaction ajoutée');
    form.reset();
    setAddType('expense');
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    const body = {
      account_id: numberOrNull(data.get('account_id')),
      to_account_id: editType === 'transfer' ? numberOrNull(data.get('to_account_id')) : null,
      category_id: editType === 'transfer' ? null : numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: editType,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
    };
    if (editing.id > 0) {
      void run(() => api.updateTransaction(userId, editing.id, body), 'Transaction modifiée');
    } else {
      void run(() => api.createTransaction(userId, body), 'Transaction copiée');
    }
    closeModal();
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
    <section className="split">
      <Panel title="Ajouter une transaction" sticky>
        <form className="form" onSubmit={submitAdd}>
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
            : <label>Catégorie<select name="category_id"><option value="">Aucune</option>{filteredAddCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="full">Description<input name="description" placeholder="Ex: Carrefour, salaire, loyer..." /></label>
          <button className="primary"><Plus size={16} /> Ajouter</button>
        </form>
      </Panel>

      <Panel title="Historique du mois">
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
        </div>
        <div className="tx-summary">
          <span><strong>{filteredTransactions.length}</strong> lignes</span>
          <span className="income">+ {money(txTotals.income)}</span>
          <span className="expense">- {money(txTotals.expenses)}</span>
          <span className="transfer">{money(txTotals.transfers)} transférés</span>
        </div>
        <TransactionsTable
          transactions={filteredTransactions}
          categoryById={categoryById}
          accountById={accountById}
          onEdit={startEdit}
          onCopy={copyTransaction}
          onLink={setLinking}
          onDelete={(t) => void run(() => api.deleteTransaction(userId, t.id), 'Transaction supprimée')}
        />
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
              : <label>Catégorie<select name="category_id" defaultValue={editing.category_id ?? ''}><option value="">Aucune</option>{filteredEditCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            <label className="full">Description<input name="description" defaultValue={editing.description ?? ''} placeholder="Ex: Carrefour, salaire, loyer..." /></label>
            <button className="primary">{editing.id > 0 ? 'Enregistrer' : 'Créer la copie'}</button>
            <button type="button" className="secondary" onClick={closeModal}>Annuler</button>
          </form>
        </Modal>
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
