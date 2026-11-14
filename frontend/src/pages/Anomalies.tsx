import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, CircleSlash, Copy, ExternalLink, Loader2, ScanLine, Tags, Trash2 } from 'lucide-react';
import type { Account, AnomalyReport, AnomalyTxRef, Category } from '@suzanne/shared';
import { api, http } from '../lib/api';
import { money } from '../lib/format';
import { pickableAccounts } from '../lib/account';
import { localeTag } from '../i18n';
import type { Run } from '../lib/run';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';
import { CategoryName } from '../components/CategoryName';

const signedMoney = (tx: AnomalyTxRef) => `${tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${money(Math.abs(tx.amount))}`;
const formatDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(localeTag());

// « À vérifier » : chaque signalement se règle sur place (catégorie, compte,
// doublon validé ou supprimé) ; « Voir » ouvre l'opération dans le journal,
// sur son mois.
export function Anomalies({ userId, accounts, accountById, categories, categoryById, dataVersion, run }: {
  userId: number;
  accounts: Account[];
  accountById: Map<number, Account>;
  categories: Category[];
  categoryById: Map<number, Category>;
  dataVersion: number;
  run: Run;
}) {
  const { t } = useTranslation();
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading((current) => current && report === null);
    api.anomalies(userId)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setReport(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dataVersion]);

  const byType = useMemo(() => ({
    expense: categories.filter((c) => c.type === 'expense'),
    income: categories.filter((c) => c.type === 'income'),
  }), [categories]);

  const accountName = (id: number | null) => (id != null ? accountById.get(id)?.name ?? `#${id}` : '—');
  // Le journal bascule de lui-même sur le mois de l'opération (?tx=).
  const openTx = (tx: AnomalyTxRef) => navigate(`/transactions?tx=${tx.id}`);

  const setCategory = (tx: AnomalyTxRef, categoryId: number) => {
    const name = categoryById.get(categoryId)?.name ?? '';
    void run(() => api.updateTransaction(userId, tx.id, { category_id: categoryId }), t('operations.review.categorized_as', { name }));
  };
  const acceptAll = (rows: Array<AnomalyTxRef & { suggested_category_id?: number | null }>) => {
    const todo = rows.filter((r) => r.suggested_category_id != null);
    void run(async () => {
      // Regroupées par catégorie : une requête groupée par catégorie proposée.
      const groups = new Map<number, number[]>();
      for (const r of todo) groups.set(r.suggested_category_id!, [...(groups.get(r.suggested_category_id!) ?? []), r.id]);
      for (const [category_id, ids] of groups) await api.bulkUpdateTransactions(userId, { ids, category_id });
    }, t('operations.review.categorized_count', { count: todo.length }));
  };
  const setAccount = (tx: AnomalyTxRef, accountId: number) => {
    void run(() => api.updateTransaction(userId, tx.id, { account_id: accountId }), t('operations.review.attached_to', { name: accountName(accountId) }));
  };
  const dismissPair = (a: AnomalyTxRef, b: AnomalyTxRef) => {
    void run(
      () => http(`/users/${userId}/anomalies/duplicates/dismiss`, { method: 'POST', body: JSON.stringify({ a_id: a.id, b_id: b.id }) }),
      t('operations.review.not_duplicate_done'),
    );
  };
  const restoreDismissed = () => {
    void run(() => http(`/users/${userId}/anomalies/duplicates/dismiss`, { method: 'DELETE' }), t('operations.review.dismissed_restored'));
  };
  const deleteTx = (tx: AnomalyTxRef) => {
    void run(
      () => api.deleteTransaction(userId, tx.id),
      t('operations.review.duplicate_trashed'),
      { undo: () => api.restoreTransaction(userId, tx.id) },
    );
  };

  if (loading) return <p className="empty"><Loader2 className="spin-icon" size={16} /> {t('operations.review.analyzing')}</p>;
  if (!report) return <p className="empty">{t('operations.review.unavailable')}</p>;

  const clean = report.no_account.length === 0 && report.no_category.length === 0 && report.duplicates.length === 0;
  const suggestedCount = report.no_category.filter((r) => r.suggested_category_id != null).length;
  const noLabel = <span className="muted">{t('operations.review.no_label')}</span>;
  const viewLabel = t('operations.review.view_in_journal');
  const col = {
    date: t('operations.review.col_date'),
    label: t('operations.review.col_label'),
    amount: t('operations.review.col_amount'),
    account: t('operations.review.col_account'),
    category: t('operations.review.col_category'),
    actions: t('operations.review.col_actions'),
  };

  return (
    <section className="stack">
      {clean && (
        <Panel title={t('operations.review.clean_title')} icon={<ScanLine />}>
          <p className="panel-note">{t('operations.review.clean_note')}</p>
        </Panel>
      )}

      {report.no_account.length > 0 && (
        <Panel title={t('operations.review.no_account_title', { n: report.no_account.length })} icon={<CircleSlash />}>
          <p className="panel-note">{t('operations.review.no_account_note')}</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>{col.date}</th><th>{col.label}</th><th className="amount-cell">{col.amount}</th><th>{col.account}</th><th className="actions-cell">{col.actions}</th></tr></thead>
            <tbody>
              {report.no_account.map((tx) => (
                <tr key={tx.id}>
                  <td data-label={col.date}>{formatDay(tx.date)}</td>
                  <td data-label={col.label}>{tx.description ?? noLabel}</td>
                  <td className={`amount-cell ${tx.type === 'income' ? 'income' : 'expense'}`} data-label={col.amount}>{signedMoney(tx)}</td>
                  <td data-label={col.account}>
                    <select value="" onChange={(e) => { if (e.target.value) setAccount(tx, Number(e.target.value)); }} aria-label={t('operations.review.attach_to_account')}>
                      <option value="">{t('operations.review.choose')}</option>
                      {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className="actions-cell"><IconButton label={viewLabel} tone="neutral" icon={<ExternalLink size={16} />} onClick={() => openTx(tx)} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {report.no_category.length > 0 && (
        <Panel
          title={t('operations.review.no_category_title', { n: report.no_category.length })}
          icon={<Tags />}
          action={suggestedCount > 0 ? (
            <button type="button" className="secondary" onClick={() => acceptAll(report.no_category)}>
              <Check size={16} /> {t('operations.review.accept_suggestions', { count: suggestedCount })}
            </button>
          ) : undefined}
        >
          <p className="panel-note">{t('operations.review.no_category_note')}</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>{col.date}</th><th>{col.account}</th><th>{col.label}</th><th className="amount-cell">{col.amount}</th><th>{col.category}</th><th className="actions-cell">{col.actions}</th></tr></thead>
            <tbody>
              {report.no_category.map((tx) => {
                const suggestion = tx.suggested_category_id != null ? categoryById.get(tx.suggested_category_id) : undefined;
                const options = tx.type === 'income' ? byType.income : byType.expense;
                const value = picked[tx.id] ?? (suggestion ? String(suggestion.id) : '');
                return (
                  <tr key={tx.id}>
                    <td data-label={col.date}>{formatDay(tx.date)}</td>
                    <td data-label={col.account}>{accountName(tx.account_id)}</td>
                    <td data-label={col.label}>{tx.description ?? noLabel}</td>
                    <td className={`amount-cell ${tx.type === 'income' ? 'income' : 'expense'}`} data-label={col.amount}>{signedMoney(tx)}</td>
                    <td data-label={col.category}>
                      <div className="review-cat">
                        <select
                          value={value}
                          onChange={(e) => {
                            setPicked((cur) => ({ ...cur, [tx.id]: e.target.value }));
                            // Choix explicite = appliqué tout de suite.
                            if (e.target.value) setCategory(tx, Number(e.target.value));
                          }}
                          aria-label={col.category}
                        >
                          <option value="">{t('operations.review.choose')}</option>
                          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {suggestion && picked[tx.id] === undefined && <small className="muted">{t('operations.review.suggested')} <CategoryName category={suggestion} /></small>}
                      </div>
                    </td>
                    <td className="actions-cell">
                      {suggestion && picked[tx.id] === undefined && (
                        <IconButton label={t('operations.review.accept_named', { name: suggestion.name })} tone="neutral" icon={<Check size={16} />} onClick={() => setCategory(tx, suggestion.id)} />
                      )}
                      <IconButton label={viewLabel} tone="neutral" icon={<ExternalLink size={16} />} onClick={() => openTx(tx)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {(report.duplicates.length > 0 || (report.dismissed_duplicates ?? 0) > 0) && (
        <Panel
          title={t('operations.review.duplicates_title', { n: report.duplicates.length })}
          icon={<Copy />}
          action={(report.dismissed_duplicates ?? 0) > 0 ? (
            <button type="button" className="secondary" onClick={restoreDismissed}>{t('operations.review.show_dismissed', { count: report.dismissed_duplicates })}</button>
          ) : undefined}
        >
          <p className="panel-note">{t('operations.review.duplicates_note')}</p>
          {report.duplicates.length === 0 ? <p className="panel-note">{t('operations.review.no_pending_duplicate')}</p> : (
            <DataTable scroll empty={null}>
              <thead><tr><th>{col.account}</th><th className="amount-cell">{col.amount}</th><th>{t('operations.review.col_tx_a')}</th><th>{t('operations.review.col_tx_b')}</th><th>{t('operations.review.col_gap')}</th><th className="actions-cell">{col.actions}</th></tr></thead>
              <tbody>
                {report.duplicates.map((p, i) => (
                  <tr key={`${p.a.id}-${p.b.id}-${i}`}>
                    <td data-label={col.account}>{accountName(p.a.account_id)}</td>
                    <td className={`amount-cell ${p.a.type === 'income' ? 'income' : 'expense'}`} data-label={col.amount}>{signedMoney(p.a)}</td>
                    <td data-label="A">
                      <button type="button" className="link-button" onClick={() => openTx(p.a)}>{formatDay(p.a.date)} · {p.a.description ?? '—'}</button>
                    </td>
                    <td data-label="B">
                      <button type="button" className="link-button" onClick={() => openTx(p.b)}>{formatDay(p.b.date)} · {p.b.description ?? '—'}</button>
                    </td>
                    <td data-label={t('operations.review.col_gap')}>{t('operations.review.days', { n: p.days_apart })}</td>
                    <td className="actions-cell">
                      <IconButton label={t('operations.review.not_duplicate')} tone="neutral" icon={<Check size={16} />} onClick={() => dismissPair(p.a, p.b)} />
                      <IconButton label={t('operations.review.delete_b')} tone="danger" icon={<Trash2 size={16} />} onClick={() => deleteTx(p.b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>
      )}
    </section>
  );
}
