import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Scale } from 'lucide-react';
import { accountsApi, type Reconciliation, type ReconciliationPeriod } from '../../lib/api-accounts';
import { money } from '../../lib/format';
import { formatDateFr } from '../../lib/pea';
import '../../styles/pages/reconciliation.css';
import type { Run } from '../../lib/run';
import { useTranslation } from 'react-i18next';

// Rapprochement des relevés : entre deux soldes connus (solde initial, relevés),
// la somme des opérations doit égaler l'écart de solde. Le relevé faisant foi
// pour le solde, un écart ne fausse pas le solde affiché mais révèle une
// opération manquante ou en trop (donc des statistiques fausses).
export function ReconciliationPanel({ userId, accountId, currency, refreshKey, run }: {
  userId: number;
  accountId: number;
  currency: string;
  /** Change quand les relevés / opérations changent → recharge. */
  refreshKey: string;
  run: Run;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<Reconciliation | null>(null);
  const [version, setVersion] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    accountsApi.reconciliation(userId, accountId)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [userId, accountId, refreshKey, version]);

  if (!data || data.periods.length === 0) return null;
  const fmt = (v: number) => money(v, currency);
  // Plus récente d'abord ; les périodes antérieures à l'historique d'opérations sont écartées.
  const periods = data.periods.filter((p) => !p.no_history).reverse();
  const beforeHistory = data.periods.length - periods.length;
  const withGap = periods.filter((p) => Math.abs(p.gap) >= 0.01);
  const visible = showAll ? periods : withGap.slice(0, 8);

  const adjust = (p: ReconciliationPeriod) => {
    void run(
      () => accountsApi.adjust(userId, accountId, { date: p.to.date, amount: p.gap, description: `Ajustement de rapprochement (${formatDateFr(p.from.date)} → ${formatDateFr(p.to.date)})` }),
      'Ajustement créé : la période est rapprochée',
    ).then((ok) => { if (ok) setVersion((v) => v + 1); });
  };

  const openPeriod = (p: ReconciliationPeriod) => {
    navigate(`/transactions?account=${accountId}&month=${p.to.date.slice(0, 7)}`);
  };

  return (
    <details className="acc-fold" open={withGap.length > 0}>
      <summary>
        
        {t('comptes.reconciliation_panel.statement_reconciliation')}
        {withGap.length > 0
          ? <span className="acc-count rc-bad">{withGap.length}  {t('comptes.reconciliation_panel.gap')}{withGap.length > 1 ? 's' : ''}</span>
          : <span className="acc-count rc-ok">{t('comptes.reconciliation_panel.up_to_date')}</span>}
      </summary>
      <div className="ad-fold-body rc">
        {withGap.length === 0 ? (
          <p className="rc-all-ok"><CheckCircle2 size={16} />  {t('comptes.reconciliation_panel.the')} {periods.length}  {t('comptes.reconciliation_panel.periods_between_your_statements_match')}</p>
        ) : (
          <p className="acc-muted">
            
            {t('comptes.reconciliation_panel.between_two_statements_transactions_shou')}
          </p>
        )}
        {visible.length > 0 && (
          <ul className="rc-list">
            {visible.map((p) => {
              const bad = Math.abs(p.gap) >= 0.01;
              return (
                <li key={`${p.from.date}-${p.to.date}`} className={bad ? 'rc-row bad' : 'rc-row'}>
                  <div className="rc-main">
                    <strong>{formatDateFr(p.from.date)} → {formatDateFr(p.to.date)}</strong>
                    <span className="acc-muted">
                      
                      {t('comptes.reconciliation_panel.statements')} {fmt(p.from.value)} → {fmt(p.to.value)} · {p.count}  {t('comptes.reconciliation_panel.transaction')}{p.count > 1 ? 's' : ''}  {t('comptes.reconciliation_panel.for')} <span className="num">{fmt(p.movements)}</span>
                      {p.adjustments !== 0 && <>  {t('comptes.reconciliation_panel.incl_adjustment')} <span className="num">{fmt(p.adjustments)}</span></>}
                    </span>
                  </div>
                  <span className={bad ? 'rc-gap num expense' : 'rc-gap num'}>{bad ? `${p.gap > 0 ? '+' : '−'}${fmt(Math.abs(p.gap))}` : 'OK'}</span>
                  {bad && (
                    <div className="rc-actions">
                      <button type="button" className="secondary" onClick={() => openPeriod(p)}><ArrowUpRight size={15} />  {t('comptes.reconciliation_panel.view_transactions')}</button>
                      <button type="button" className="secondary" title={t('comptes.reconciliation_panel.creates_adjustment_transaction_neither_e')} onClick={() => adjust(p)}>
                        <Scale size={15} />  {t('comptes.reconciliation_panel.adjust')}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {(periods.length > visible.length || showAll) && (
          <button type="button" className="secondary rc-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Écarts seulement' : `Voir les ${periods.length} périodes`}
          </button>
        )}
        {beforeHistory > 0 && (
          <p className="acc-muted rc-open">{beforeHistory}  {t('comptes.reconciliation_panel.statement')}{beforeHistory > 1 ? 's' : ''}  {t('comptes.reconciliation_panel.older')}{beforeHistory > 1 ? 's' : ''}  {t('comptes.reconciliation_panel.than_your_transaction_history_not')}{beforeHistory > 1 ? 's' : ''}.</p>
        )}
        {data.open.count > 0 && (
          <p className="acc-muted rc-open">
            
            {t('comptes.reconciliation_panel.since_last_statement')}{formatDateFr(data.open.from.date)}) : {data.open.count}  {t('comptes.reconciliation_panel.transaction')}{data.open.count > 1 ? 's' : ''}  {t('comptes.reconciliation_panel.for')} <span className="num">{fmt(data.open.movements)}</span>{t('comptes.reconciliation_panel.enter_statement_to_check_them')}
          </p>
        )}
      </div>
    </details>
  );
}
