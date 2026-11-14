import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckSquare, ChevronLeft, ChevronRight, Rows2, Rows3, Trash2 } from 'lucide-react';
import type { Account, Category, RecurringTransaction, Tag, Transaction } from '@suzanne/shared';
import { api, http } from '../lib/api';
import { money, txLabel } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import type { Run } from '../lib/run';
import { AttachmentsModal } from '../components/AttachmentsModal';
import { TrashModal } from '../components/TrashModal';
import { TransactionsTable } from '../components/TransactionsTable';
import { QuickEntry } from '../components/transactions/QuickEntry';
import { FilterBar } from '../components/transactions/FilterBar';
import { BulkBar, BulkEditModal } from '../components/transactions/BulkBar';
import { JournalList } from '../components/transactions/JournalList';
import { RefundModal } from '../components/transactions/RefundModal';
import { RecurringLinkModal } from '../components/transactions/RecurringLinkModal';
import { RowMenu, useTxMenuItems, type TxActionHandlers } from '../components/transactions/RowMenu';
import { TransactionFormModal, type TxDraft, type TxFormMode } from '../components/transactions/TransactionFormModal';
import { useTransactionFilters } from '../components/transactions/useTransactionFilters';
import { useSelection } from '../components/transactions/useSelection';
import { isReadOnly, useMediaQuery } from '../components/transactions/txUtils';
import '../styles/pages/transactions.css';

// Une seule modale ouverte à la fois.
type Dialog =
  | { kind: 'form'; mode: TxFormMode; tx?: Transaction; draft?: TxDraft }
  | { kind: 'refund'; txs: Transaction[]; fromSelection?: boolean }
  | { kind: 'recurring'; tx: Transaction }
  | { kind: 'attachments'; tx: Transaction }
  | { kind: 'bulkEdit' }
  | { kind: 'trash' }
  | null;

export function Transactions({ userId, month, transactions, unassignedTransactions, issueFilter, onClearIssueFilter, recurring, accounts, categories, tags, categoryById, accountById, onMonthChange, run }: {
  userId: number;
  month?: string;
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
  // Le mois appartient à App (il pilote le reload) ; les deep links s'en
  // servent pour amener l'utilisateur sur le bon mois.
  onMonthChange: (month: string) => void;
  run: Run;
}) {
  const { t } = useTranslation();
  const mobile = useMediaQuery('(max-width: 640px)');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [compact, setCompact] = usePersistedState<boolean>('tx_compact', false);
  const [selecting, setSelecting] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [pendingTxId, setPendingTxId] = useState<number | null>(null);
  const lookedUpTx = useRef<number | null>(null);
  const quickAmountRef = useRef<HTMLInputElement>(null);
  const menuItems = useTxMenuItems();

  const source = issueFilter === 'unassigned_account' ? unassignedTransactions : transactions;
  // Le mois n'est connu que via le prop (optionnel) ; à défaut, la liste
  // source elle-même sert de clé de remise à zéro.
  const scopeKey = `${month ?? ''}|${issueFilter ?? ''}`;
  const filters = useTransactionFilters(source, categoryById, accountById, scopeKey);
  const selection = useSelection(source, filters.signature);

  // Fin du mode sélection mobile = sélection vidée.
  useEffect(() => { if (!mobile) setSelecting(false); }, [mobile]);

  // ---- Deep links ---------------------------------------------------------
  // ?category, ?q, ?type, ?month (drill-down), ?tx (recherche, popovers),
  // ?focus=quick (bouton « + » mobile, raccourci n). Les autres filtres sont
  // remis à zéro pour que la cible soit visible, puis l'URL est nettoyée.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const category = searchParams.get('category');
    const q = searchParams.get('q');
    const monthParam = searchParams.get('month');
    const txParam = searchParams.get('tx');
    const typeParam = searchParams.get('type');
    const focusParam = searchParams.get('focus');
    const accountParam = searchParams.get('account');
    if ([category, q, monthParam, txParam, typeParam, focusParam, accountParam].every((v) => v === null)) return;
    if (focusParam === 'quick') {
      const input = quickAmountRef.current;
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
    }
    if (category !== null || q !== null || monthParam !== null || txParam !== null || typeParam !== null || accountParam !== null) {
      filters.reset();
      if (accountParam !== null && /^\d+$/.test(accountParam)) filters.setAccountGroup(`account:${accountParam}`);
      if (typeParam === 'income' || typeParam === 'expense' || typeParam === 'transfer') filters.setType(typeParam);
      if (category !== null) filters.setCategoryId(category);
      if (q !== null) filters.setQuery(q);
      if (/^\d{4}-\d{2}$/.test(monthParam ?? '')) onMonthChange(monthParam!);
      const txId = Number(txParam);
      if (txParam !== null && Number.isFinite(txId) && txId > 0) {
        lookedUpTx.current = null;
        setPendingTxId(txId);
      }
      if (issueFilter) onClearIssueFilter();
    }
    setSearchParams({}, { replace: true });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transaction ciblée : dès qu'elle est dans la liste, on saute à sa page et
  // on la surligne. Sinon on cherche sa date (toutes périodes) et on bascule
  // sur son mois ; l'effet reprend quand le mois est rechargé.
  const { goToTransaction } = filters;
  useEffect(() => {
    if (pendingTxId === null) return;
    if (goToTransaction(pendingTxId)) {
      setHighlightId(pendingTxId);
      setPendingTxId(null);
      return;
    }
    if (lookedUpTx.current === pendingTxId) return;
    lookedUpTx.current = pendingTxId;
    const target = pendingTxId;
    let cancelled = false;
    // Une seule opération demandée (et non tout l'historique).
    http<Transaction>(`/users/${userId}/transactions/${target}`)
      .then((found) => {
        if (cancelled) return;
        const txMonth = found.date.slice(0, 7);
        if (month !== undefined && txMonth === month) { setPendingTxId(null); return; }
        onMonthChange(txMonth);
      })
      .catch(() => { if (!cancelled) setPendingTxId(null); });
    return () => { cancelled = true; };
  }, [pendingTxId, goToTransaction, userId, month, onMonthChange]);

  // La surbrillance s'éteint d'elle-même.
  useEffect(() => {
    if (highlightId === null) return;
    const timer = window.setTimeout(() => setHighlightId(null), 6000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  // ---- Actions ------------------------------------------------------------
  const closeDialog = useCallback(() => setDialog(null), []);

  const deleteTx = useCallback((tx: Transaction) => {
    void run(
      () => api.deleteTransaction(userId, tx.id),
      t('Transaction déplacée vers la corbeille'),
      { undo: () => api.restoreTransaction(userId, tx.id) },
    ).then((ok) => {
      if (ok) setDialog((d) => (d && 'tx' in d && d.tx?.id === tx.id ? null : d && 'txs' in d && d.txs.some((x) => x.id === tx.id) ? null : d));
    });
  }, [run, t, userId]);

  const handlers: TxActionHandlers = useMemo(() => ({
    onCopy: (tx) => setDialog({ kind: 'form', mode: 'copy', tx }),
    onLink: (tx) => setDialog({ kind: 'recurring', tx }),
    onSplit: (tx) => setDialog({ kind: 'form', mode: 'split', tx }),
    onRefund: (tx) => setDialog({ kind: 'refund', txs: [tx] }),
    onAttachments: (tx) => setDialog({ kind: 'attachments', tx }),
    onDelete: deleteTx,
  }), [deleteTx]);

  const openEdit = (tx: Transaction) => {
    if (!isReadOnly(tx)) setDialog({ kind: 'form', mode: 'edit', tx });
  };

  const toggleCleared = (tx: Transaction) => {
    void run(
      () => api.updateTransaction(userId, tx.id, { cleared: !tx.cleared }),
      tx.cleared ? t('Transaction dépointée') : t('Transaction pointée'),
    );
  };

  const inlineUpdate = (tx: Transaction, patch: Partial<Pick<Transaction, 'account_id' | 'to_account_id' | 'category_id'>>) => {
    void run(() => api.updateTransaction(userId, tx.id, patch), t('Transaction modifiée'));
  };

  const { totals, page, totalPages, pageStart, pageEnd, sorted, paged } = filters;
  const emptyMessage = issueFilter === 'unassigned_account'
    ? t('Aucune transaction sans compte.')
    : filters.activeCount > 0 ? t('Aucune opération ne correspond aux filtres.') : t('Aucune transaction sur ce mois.');

  return (
    <section className="stack journal">
      {issueFilter === 'unassigned_account' && (
        <div className="jr-notice">
          <div>
            <strong>{t('Transactions sans compte · toutes périodes')}</strong>
            <span>{t('Elles comptent dans les liquidités tant qu\'aucun compte n\'est rattaché.')}</span>
          </div>
          <button type="button" className="secondary" onClick={onClearIssueFilter}>{t('Revenir au mois courant')}</button>
        </div>
      )}

      <QuickEntry
        ref={quickAmountRef}
        userId={userId}
        accounts={accounts}
        categories={categories}
        run={run}
        onMore={(draft) => setDialog({ kind: 'form', mode: 'create', draft })}
      />

      <div className="panel jr-panel">
        <FilterBar state={filters} categories={categories} tags={tags} mobile={mobile} accounts={accounts} />

        <div className="jr-summary">
          <span className="jr-summary-count"><strong>{filters.filtered.length}</strong> {t(filters.filtered.length > 1 ? 'opérations' : 'opération')}</span>
          <span className="jr-totals">
            <span className="jr-num income" title={t('Revenus')}>+{money(totals.income)}</span>
            <span className="jr-num expense" title={totals.refunds > 0 ? t('Dépenses nettes des remboursements') : t('Dépenses')}>{totals.expenses < 0 ? '+' : '−'}{money(Math.abs(totals.expenses))}</span>
            {totals.refunds > 0.004 && (
              <span className="jr-num jr-muted" title={t('Remboursements reçus : ils annulent les dépenses remboursées au lieu de compter comme revenus (dépenses brutes : {{gross}})', { gross: money(totals.expenses + totals.refunds) })}>
                ↺ {t('dont {{amount}} remboursés', { amount: money(totals.refunds) })}
              </span>
            )}
            {totals.transfers > 0 && <span className="jr-num jr-muted" title={t('Transferts')}>⇄ {money(totals.transfers)}</span>}
          </span>
          <span className="jr-spacer" />
          {mobile ? (
            <button
              type="button"
              className={`jr-tool${selecting ? ' on' : ''}`}
              title={t('Sélectionner')}
              onClick={() => { if (selecting) selection.clear(); setSelecting(!selecting); }}
            >
              <CheckSquare size={16} /> {selecting ? t('Terminé') : <span className="jr-sr">{t('Sélectionner')}</span>}
            </button>
          ) : (
            <button type="button" className="jr-tool" onClick={() => setCompact(!compact)} title={compact ? t('Affichage confortable') : t('Affichage compact')}>
              {compact ? <Rows3 size={16} /> : <Rows2 size={16} />} {compact ? t('Confortable') : t('Compact')}
            </button>
          )}
          <button type="button" className="jr-tool" onClick={() => setDialog({ kind: 'trash' })} title={t('Corbeille')} aria-label={t('Corbeille')}>
            <Trash2 size={16} /> {!mobile && t('Corbeille')}
          </button>
        </div>

        <BulkBar selection={selection} userId={userId} tags={tags} run={run} onEdit={() => setDialog({ kind: 'bulkEdit' })} onRefund={() => setDialog({ kind: 'refund', txs: selection.selected, fromSelection: true })} />

        {mobile ? (
          <JournalList
            rows={paged}
            grouped={filters.sort.key === 'date'}
            emptyMessage={emptyMessage}
            categoryById={categoryById}
            accountById={accountById}
            highlightId={highlightId}
            selection={selection}
            selecting={selecting}
            onOpen={openEdit}
          />
        ) : (
          <TransactionsTable
            transactions={paged}
            emptyMessage={emptyMessage}
            compact={compact}
            categories={categories}
            accounts={accounts}
            categoryById={categoryById}
            accountById={accountById}
            selectedIds={selection.ids}
            sort={filters.sort}
            onSort={filters.toggleSort}
            onSelect={selection.toggle}
            onSelectAll={(on) => selection.setMany(paged, on)}
            onInlineUpdate={inlineUpdate}
            onEdit={openEdit}
            onToggleCleared={toggleCleared}
            actions={handlers}
            highlightId={highlightId}
          />
        )}

        {totalPages > 1 && (
          <nav className="jr-pages" aria-label={t('Pagination')}>
            <button type="button" className="secondary" disabled={page <= 1} onClick={() => filters.setPage(page - 1)} aria-label={t('Précédent')}>
              <ChevronLeft size={16} /> {!mobile && t('Précédent')}
            </button>
            <span>{t('{{start}}–{{end}} sur {{total}}', { start: pageStart, end: pageEnd, total: sorted.length })}</span>
            <button type="button" className="secondary" disabled={page >= totalPages} onClick={() => filters.setPage(page + 1)} aria-label={t('Suivant')}>
              {!mobile && t('Suivant')} <ChevronRight size={16} />
            </button>
          </nav>
        )}
      </div>

      {dialog?.kind === 'form' && (
        <TransactionFormModal
          key={`${dialog.mode}-${dialog.tx?.id ?? 'new'}`}
          mode={dialog.mode}
          tx={dialog.tx}
          draft={dialog.draft}
          userId={userId}
          accounts={accounts}
          categories={categories}
          tags={tags}
          run={run}
          onClose={closeDialog}
          extraActions={dialog.mode === 'edit' && dialog.tx
            ? <RowMenu items={menuItems(dialog.tx, handlers)} label={t('Autres actions')} />
            : undefined}
        />
      )}
      {dialog?.kind === 'refund' && (
        <RefundModal seed={dialog.txs} userId={userId} accounts={accounts} accountById={accountById} categoryById={categoryById} run={run} onClose={closeDialog} onDone={dialog.fromSelection ? selection.clear : undefined} />
      )}
      {dialog?.kind === 'recurring' && (
        <RecurringLinkModal tx={dialog.tx} userId={userId} recurring={recurring} accountById={accountById} categoryById={categoryById} run={run} onClose={closeDialog} />
      )}
      {dialog?.kind === 'attachments' && (
        <AttachmentsModal userId={userId} transactionId={dialog.tx.id} label={txLabel(dialog.tx, categoryById)} run={run} onClose={closeDialog} />
      )}
      {dialog?.kind === 'bulkEdit' && (
        <BulkEditModal selection={selection} userId={userId} accounts={accounts} categories={categories} run={run} onClose={closeDialog} />
      )}
      {dialog?.kind === 'trash' && (
        <TrashModal userId={userId} categoryById={categoryById} run={run} onClose={closeDialog} />
      )}
    </section>
  );
}
