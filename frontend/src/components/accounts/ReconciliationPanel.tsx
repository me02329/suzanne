import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Scale } from 'lucide-react';
import { accountsApi, type Reconciliation, type ReconciliationPeriod } from '../../lib/api-accounts';
import { money } from '../../lib/format';
import { formatDateFr } from '../../lib/pea';
import '../../styles/pages/reconciliation.css';
import type { Run } from '../../lib/run';

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
  const periods = [...data.periods].reverse(); // plus récente d'abord
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
        Rapprochement des relevés
        {withGap.length > 0
          ? <span className="acc-count rc-bad">{withGap.length} écart{withGap.length > 1 ? 's' : ''}</span>
          : <span className="acc-count rc-ok">à jour</span>}
      </summary>
      <div className="ad-fold-body rc">
        {withGap.length === 0 ? (
          <p className="rc-all-ok"><CheckCircle2 size={16} /> Les {periods.length} périodes entre tes relevés concordent au centime avec les opérations.</p>
        ) : (
          <p className="acc-muted">
            Entre deux relevés, les opérations devraient expliquer tout l'écart de solde. Un écart = une opération manquante (écart positif)
            ou en trop / en double (écart négatif). Le solde affiché reste juste (le relevé fait foi) ; ce sont les statistiques qui sont faussées.
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
                      relevés {fmt(p.from.value)} → {fmt(p.to.value)} · {p.count} opération{p.count > 1 ? 's' : ''} pour <span className="num">{fmt(p.movements)}</span>
                      {p.adjustments !== 0 && <> · dont ajustement <span className="num">{fmt(p.adjustments)}</span></>}
                    </span>
                  </div>
                  <span className={bad ? 'rc-gap num expense' : 'rc-gap num'}>{bad ? `${p.gap > 0 ? '+' : '−'}${fmt(Math.abs(p.gap))}` : 'OK'}</span>
                  {bad && (
                    <div className="rc-actions">
                      <button type="button" className="secondary" onClick={() => openPeriod(p)}><ArrowUpRight size={15} /> Voir les opérations</button>
                      <button type="button" className="secondary" title="Crée une opération d'ajustement (ni dépense ni revenu) du montant de l'écart" onClick={() => adjust(p)}>
                        <Scale size={15} /> Ajuster
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
        {data.open.count > 0 && (
          <p className="acc-muted rc-open">
            Depuis le dernier relevé ({formatDateFr(data.open.from.date)}) : {data.open.count} opération{data.open.count > 1 ? 's' : ''} pour <span className="num">{fmt(data.open.movements)}</span>. Saisis un relevé pour les vérifier.
          </p>
        )}
      </div>
    </details>
  );
}
