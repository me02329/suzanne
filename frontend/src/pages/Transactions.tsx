import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarRange, CheckSquare, ChevronLeft, ChevronRight, Rows2, Rows3, Trash2 } from 'lucide-react';
import type { Account, Category, RecurringTransaction, Tag, Transaction } from '@suzanne/shared';
import { api, http } from '../lib/api';
import { money, txLabel } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import type { Run } from '../lib/run';
import { AttachmentsModal } from '../components/AttachmentsModal';
import { TrashModal } from '../components/TrashModal';
import { Modal } from '../components/Modal';
import { TransactionsTable } from '../components/TransactionsTable';
import { QuickEntry } from '../components/transactions/QuickEntry';
import { FilterBar } from '../components/transactions/FilterBar';
import { BulkBar, BulkEditModal } from '../components/transactions/BulkBar';
import { JournalList } from '../components/transactions/JournalList';
import { RefundModal } from '../components/transactions/RefundModal';
import { RecurringLinkModal } from '../components/transactions/RecurringLinkModal';
import { RowMenu, useTxMenuItems, type TxActionHandlers } from '../components/transactions/RowMenu';
import { TransactionFormModal, type TxDraft, type TxFormMode } from '../components/transactions/TransactionFormModal';
import { TransactionDetailModal } from '../components/transactions/TransactionDetailModal';
import { useTransactionFilters } from '../components/transactions/useTransactionFilters';
import { useSelection } from '../components/transactions/useSelection';
import { formatTxDate, isReadOnly, useMediaQuery } from '../components/transactions/txUtils';
import '../styles/pages/transactions.css';

// Une seule modale ouverte à la fois.
type Dialog =
  | { kind: 'form'; mode: TxFormMode; tx?: Transaction; draft?: TxDraft }
  | { kind: 'refund'; txs: Transaction[]; fromSelection?: boolean }
  | { kind: 'recurring'; tx: Transaction }
  | { kind: 'attachments'; tx: Transaction }
  | { kind: 'bulkEdit' }
  | { kind: 'trash' }
  | { kind: 'refunded'; tx: Transaction; expenses: RefundedExpense[] }
  | { kind: 'detail'; id: number }
  | null;

// Dépense remboursée par un revenu (aperçu renvoyé par l'API).
type RefundedExpense = { id: number; amount: number; date: string; description: string | null };

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

  // « Toutes les périodes » : la page charge elle-même tout l'historique (les
  // filtres s'appliquent côté client comme pour un mois). Rechargé quand App
  // recharge le mois (prop transactions), c.-à-d. après chaque modification.
  const [allPeriods, setAllPeriods] = useState(false);
  const [allTxs, setAllTxs] = useState<Transaction[] | null>(null);
  useEffect(() => {
    if (!allPeriods) { setAllTxs(null); return; }
    let cancelled = false;
    api.transactions(userId).then((rows) => { if (!cancelled) setAllTxs(rows); }).catch(() => { if (!cancelled) setAllTxs([]); });
    return () => { cancelled = true; };
  }, [allPeriods, userId, transactions]);
  // Changer de mois (sélecteur du haut) revient à la vue mensuelle.
  const shownMonth = useRef(month);
  useEffect(() => {
    if (shownMonth.current !== month) setAllPeriods(false);
    shownMonth.current = month;
  }, [month]);

  const source = issueFilter === 'unassigned_account' ? unassignedTransactions : allPeriods ? (allTxs ?? []) : transactions;
  // Le mois n'est connu que via le prop (optionnel) ; à défaut, la liste
  // source elle-même sert de clé de remise à zéro.
  const scopeKey = `${allPeriods ? 'all' : month ?? ''}|${issueFilter ?? ''}`;
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
    const periodParam = searchParams.get('period');
    if ([category, q, monthParam, txParam, typeParam, focusParam, accountParam, periodParam].every((v) => v === null)) return;
    if (periodParam === 'all') setAllPeriods(true);
    else if (monthParam !== null) setAllPeriods(false);
    // Bouton « + » : sur mobile la saisie rapide est masquée (elle mangeait le
    // haut de l'écran) → on ouvre directement le formulaire complet.
    if (focusParam === 'quick' && mobile) setDialog({ kind: 'form', mode: 'create' });
    else if (focusParam === 'quick') {
      const input = quickAmountRef.current;
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
    }
    if (category !== null || q !== null || monthParam !== null || txParam !== null || typeParam !== null || accountParam !== null || periodParam !== null) {
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
  const pendingTxRef = useRef(pendingTxId);
  pendingTxRef.current = pendingTxId;
  const monthRef = useRef(month);
  monthRef.current = month;
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
    // Une seule opération demandée (et non tout l'historique). La réponse est
    // appliquée tant que cette opération est toujours la cible — et non
    // annulée au moindre rechargement de la liste du mois, qui arrive souvent
    // pendant la requête : on ne la relancerait plus et le lien resterait sans effet.
    http<Transaction>(`/users/${userId}/transactions/${target}`)
      .then((found) => {
        if (pendingTxRef.current !== target) return;
        const txMonth = found.date.slice(0, 7);
        if (monthRef.current !== undefined && txMonth === monthRef.current) { setPendingTxId(null); return; }
        onMonthChange(txMonth);
      })
      .catch(() => { if (pendingTxRef.current === target) setPendingTxId(null); });
  }, [pendingTxId, goToTransaction, userId, onMonthChange]);

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
      t('operations.transaction_moved_to_trash'),
      { undo: () => api.restoreTransaction(userId, tx.id) },
    ).then((ok) => {
      if (ok) setDialog((d) => (d && 'tx' in d && d.tx?.id === tx.id ? null : d && 'txs' in d && d.txs.some((x) => x.id === tx.id) ? null : d));
    });
  }, [run, t, userId]);

  const handlers: TxActionHandlers = useMemo(() => ({
    onDetails: (tx) => setDialog({ kind: 'detail', id: tx.id }),
    onCopy: (tx) => setDialog({ kind: 'form', mode: 'copy', tx }),
    onLink: (tx) => setDialog({ kind: 'recurring', tx }),
    onSplit: (tx) => setDialog({ kind: 'form', mode: 'split', tx }),
    onRefund: (tx) => setDialog({ kind: 'refund', txs: [tx] }),
    onAttachments: (tx) => setDialog({ kind: 'attachments', tx }),
    onDelete: deleteTx,
  }), [deleteTx]);

  // Aller à une opération (même hors du mois affiché) : filtres remis à zéro,
  // bascule sur son mois puis surlignage (même mécanisme que ?tx=…).
  const goToTx = (id: number) => {
    filters.reset();
    lookedUpTx.current = null;
    setPendingTxId(id);
  };

  // Badge « remboursement » : une dépense → on y va ; plusieurs → on choisit.
  const showRefunded = (tx: Transaction) => {
    const expenses: RefundedExpense[] = (tx.refund_allocations ?? [])
      .map((a) => a.expense_transaction ?? { id: a.expense_transaction_id, amount: a.amount, date: '', description: null });
    if (expenses.length === 0 && tx.refunds_transaction) expenses.push(tx.refunds_transaction);
    if (expenses.length === 1) goToTx(expenses[0]!.id);
    else if (expenses.length > 1) setDialog({ kind: 'refunded', tx, expenses });
  };

  const openEdit = (tx: Transaction) => {
    if (!isReadOnly(tx)) setDialog({ kind: 'form', mode: 'edit', tx });
  };

  const toggleCleared = (tx: Transaction) => {
    void run(
      () => api.updateTransaction(userId, tx.id, { cleared: !tx.cleared }),
      tx.cleared ? t('operations.transaction_uncleared') : t('operations.transaction_cleared'),
    );
  };

  const inlineUpdate = (tx: Transaction, patch: Partial<Pick<Transaction, 'account_id' | 'to_account_id' | 'category_id'>>) => {
    void run(() => api.updateTransaction(userId, tx.id, patch), t('operations.transaction_updated'));
  };

  const { totals, page, totalPages, pageStart, pageEnd, sorted, paged } = filters;
  const emptyMessage = issueFilter === 'unassigned_account'
    ? t('operations.no_transactions_without_account')
    : allPeriods && allTxs === null ? t('operations.loading_history')
    : filters.activeCount > 0 ? t('operations.no_transactions_match_filters')
    : allPeriods ? t('operations.no_transactions') : t('operations.no_transactions_this_month');

  return (
    <section className="stack journal">
      {issueFilter === 'unassigned_account' && (
        <div className="jr-notice">
          <div>
            <strong>{t('operations.transactions_without_account_all_periods')}</strong>
            <span>{t('operations.they_count_as_cash_until')}</span>
          </div>
          <button type="button" className="secondary" onClick={onClearIssueFilter}>{t('operations.back_to_current_month')}</button>
        </div>
      )}

      {!mobile && (
        <QuickEntry
          ref={quickAmountRef}
          userId={userId}
          accounts={accounts}
          categories={categories}
          tags={tags}
          run={run}
          onMore={(draft) => setDialog({ kind: 'form', mode: 'create', draft })}
        />
      )}

      <div className="panel jr-panel">
        <FilterBar state={filters} categories={categories} tags={tags} mobile={mobile} accounts={accounts} />

        <div className="jr-summary">
          <span className="jr-summary-count"><strong>{filters.filtered.length}</strong> {t(filters.filtered.length > 1 ? 'operations.transactions_2' : 'operations.transaction')}</span>
          <span className="jr-totals">
            <span className="jr-num income" title={t('commun.income')}>+{money(totals.income)}</span>
            <span className="jr-num expense" title={totals.refunds > 0 ? t('operations.expenses_net_refunds') : t('commun.expenses')}>{totals.expenses < 0 ? '+' : '−'}{money(Math.abs(totals.expenses))}</span>
            {(() => {
              const net = totals.income - totals.expenses;
              return (
                <span className={`jr-num jr-net ${net >= 0 ? 'income' : 'expense'}`} title={t('operations.net_balance')}>
                  = {net >= 0 ? '+' : '−'}{money(Math.abs(net))}
                </span>
              );
            })()}
            {totals.refunds > 0.004 && (
              <span className="jr-num jr-muted" title={t('operations.refunds_received_they_cancel_refunded', { gross: money(totals.expenses + totals.refunds) })}>
                ↺ {t('operations.incl_amount_refunded', { amount: money(totals.refunds) })}
              </span>
            )}
            {totals.transfers > 0 && <span className="jr-num jr-muted" title={t('operations.transfers')}>⇄ {money(totals.transfers)}</span>}
            {totals.professional > 0 && <span className="jr-num jr-muted" title={t('operations.pro_excluded_hint')}>{t('operations.pro_excluded', { count: totals.professional })}</span>}
          </span>
          <span className="jr-spacer" />
          {issueFilter === null && (
            <button
              type="button"
              className={`jr-tool${allPeriods ? ' on' : ''}`}
              aria-pressed={allPeriods}
              title={t('operations.all_periods_hint')}
              onClick={() => setAllPeriods(!allPeriods)}
            >
              <CalendarRange size={16} /> {mobile ? <span className="jr-sr">{t('operations.all_periods')}</span> : t('operations.all_periods')}
            </button>
          )}
          {mobile ? (
            <button
              type="button"
              className={`jr-tool${selecting ? ' on' : ''}`}
              title={t('operations.select')}
              onClick={() => { if (selecting) selection.clear(); setSelecting(!selecting); }}
            >
              <CheckSquare size={16} /> {selecting ? t('operations.done') : <span className="jr-sr">{t('operations.select')}</span>}
            </button>
          ) : (
            <button type="button" className="jr-tool" onClick={() => setCompact(!compact)} title={compact ? t('operations.comfortable_view') : t('operations.compact_view')}>
              {compact ? <Rows3 size={16} /> : <Rows2 size={16} />} {compact ? t('operations.comfortable') : t('operations.compact')}
            </button>
          )}
          <button type="button" className="jr-tool" onClick={() => setDialog({ kind: 'trash' })} title={t('operations.trash')} aria-label={t('operations.trash')}>
            <Trash2 size={16} /> {!mobile && t('operations.trash')}
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
            onOpen={(tx) => setDialog({ kind: 'detail', id: tx.id })}
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
            onShowRefunded={showRefunded}
          />
        )}

        {totalPages > 1 && (
          <nav className="jr-pages" aria-label={t('operations.pagination')}>
            <button type="button" className="secondary" disabled={page <= 1} onClick={() => filters.setPage(page - 1)} aria-label={t('operations.previous')}>
              <ChevronLeft size={16} /> {!mobile && t('operations.previous')}
            </button>
            <span>{t('operations.start_end_total', { start: pageStart, end: pageEnd, total: sorted.length })}</span>
            <button type="button" className="secondary" disabled={page >= totalPages} onClick={() => filters.setPage(page + 1)} aria-label={t('operations.next')}>
              {!mobile && t('operations.next')} <ChevronRight size={16} />
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
            ? <RowMenu items={menuItems(dialog.tx, handlers)} label={t('operations.more_actions')} />
            : undefined}
        />
      )}
      {dialog?.kind === 'refund' && (
        <RefundModal seed={dialog.txs} userId={userId} accounts={accounts} accountById={accountById} categoryById={categoryById} run={run} onClose={closeDialog} onDone={dialog.fromSelection ? selection.clear : undefined} />
      )}
      {dialog?.kind === 'recurring' && (
        <RecurringLinkModal tx={dialog.tx} userId={userId} recurring={recurring} accountById={accountById} categoryById={categoryById} run={run} onClose={closeDialog} />
      )}
      {dialog?.kind === 'detail' && (
        <TransactionDetailModal
          userId={userId}
          transactionId={dialog.id}
          categoryById={categoryById}
          accountById={accountById}
          onEdit={(tx) => setDialog(isReadOnly(tx) ? null : { kind: 'form', mode: 'edit', tx })}
          onAttachments={(tx) => setDialog({ kind: 'attachments', tx })}
          onGoTo={(id) => { setDialog(null); goToTx(id); }}
          onClose={closeDialog}
        />
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
      {dialog?.kind === 'refunded' && (
        <Modal title={t('operations.refund_link.refunded_expenses')} onClose={closeDialog}>
          <p className="muted">{t('operations.refund_link.pick_expense', { label: txLabel(dialog.tx, categoryById) })}</p>
          <ul className="refunded-list">
            {dialog.expenses.map((e) => (
              <li key={e.id}>
                <button type="button" className="refunded-item" onClick={() => { closeDialog(); goToTx(e.id); }}>
                  <span className="refunded-date">{e.date ? formatTxDate(e.date) : ''}</span>
                  <span className="refunded-label">{e.description ?? `#${e.id}`}</span>
                  <span className="jr-num">{money(e.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  );
}
