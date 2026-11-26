import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accountFeatures, wealthReturn, type Account, type DashboardSummary, type Transaction, type WealthHistoryPoint } from '@suzanne/shared';
import { api } from '../../lib/api';
import { accountsApi } from '../../lib/api-accounts';
import { formatDateFr } from '../../lib/pea';
import { localeTag } from '../../i18n';
import '../../styles/components/wealth-return.css';

// Patrimoine : rendement de l'épargne placée (livrets, PEL, PEA, CTO,
// assurance-vie, PER, crypto), versements neutralisés : XIRR depuis le début
// et rendement par année civile.
export function WealthReturnCard({ userId, accounts, summary, currency, money }: {
  userId: number;
  accounts: Account[];
  summary: DashboardSummary | null;
  currency: string;
  money: (v: number) => string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ history: WealthHistoryPoint[]; txByAccount: Map<number, Transaction[]>; withPositions: Set<number> } | null>(null);
  const invested = useMemo(() => accounts.filter((a) => !a.professional && (accountFeatures(a.type).holdings || accountFeatures(a.type).interest)).map((a) => a.id), [accounts]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.wealthHistory(userId, 'all', 'month', currency),
      Promise.all(invested.map((id) => accountsApi.transactions(userId, id).then((txs) => [id, txs] as const))),
      api.holdingsValuation(userId, currency).catch(() => null),
    ]).then(([history, perAccount, valuation]) => {
      if (cancelled) return;
      const withPositions = new Set((valuation?.holdings ?? []).filter((h) => h.quantity > 0).map((h) => h.account_id));
      setData({ history, txByAccount: new Map(perAccount), withPositions });
    }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [userId, currency, summary, invested]);

  const result = useMemo(() => {
    if (!data || !summary || invested.length === 0) return null;
    const set = new Set(invested);
    const points = data.history.map((p) => ({ date: p.date.slice(0, 10), byAccount: p.by_account }));
    const series = points.map((p) => ({ date: p.date, value: invested.reduce((s, id) => s + (p.byAccount[id] ?? 0), 0) }));
    const flows: Array<{ date: string; amount: number }> = [];
    // 1. Virements avec les comptes non placés (0 entre deux comptes placés).
    const seen = new Set<number>();
    for (const txs of data.txByAccount.values()) {
      for (const tx of txs) {
        if (tx.kind !== 'transfer' || seen.has(tx.id)) continue;
        seen.add(tx.id);
        const amount = (tx.lines ?? []).filter((l) => l.account_id != null && set.has(l.account_id)).reduce((s, l) => s + l.amount, 0);
        if (Math.abs(amount) > 0.005) flows.push({ date: tx.date.slice(0, 10), amount });
      }
    }
    // 2. Variation non expliquée par les opérations d'un compte sans titres (relevés
    //    saisis, versements prélevés ailleurs) : un versement, pas du rendement.
    for (const id of invested) {
      if (data.withPositions.has(id)) continue;
      const txs = data.txByAccount.get(id) ?? [];
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!.date;
        const to = points[i]!.date;
        const delta = (points[i]!.byAccount[id] ?? 0) - (points[i - 1]!.byAccount[id] ?? 0);
        const moved = txs.filter((tx) => tx.date.slice(0, 10) > from && tx.date.slice(0, 10) <= to)
          .reduce((s, tx) => s + (tx.lines ?? []).filter((l) => l.account_id === id).reduce((x, l) => x + l.amount, 0), 0);
        const residual = delta - moved;
        if (Math.abs(residual) > 0.5) flows.push({ date: to, amount: residual });
      }
    }
    const current = summary.account_balances.filter((b) => set.has(b.account_id)).reduce((s, b) => s + b.signed_balance, 0);
    return wealthReturn(series, flows, new Date().toISOString().slice(0, 10), current);
  }, [data, summary, invested]);

  if (!result || result.since == null) return null;
  // Arrondi d'abord : un −0,001 % ne doit pas s'afficher « +-0 % ».
  const pct = (v: number | null) => {
    if (v == null) return '—';
    const r = Math.round(v * 100) / 100;
    return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toLocaleString(localeTag(), { maximumFractionDigits: 2 })} %`;
  };
  const years = result.byYear.filter((y) => y.pct != null);
  const maxAbs = Math.max(1, ...years.map((y) => Math.abs(y.pct!)));

  return (
    <section className="pg-card wr">
      <div className="pg-card-head"><h2>{t('patrimoine.return.title')}</h2></div>
      <div className="wr-top">
        <div>
          <strong className={`wr-rate num ${(result.annualized ?? 0) >= 0 ? 'income' : 'expense'}`}>{pct(result.annualized)}</strong>
          <span className="acc-muted">{t('patrimoine.return.per_year_since', { date: formatDateFr(result.since) })}</span>
        </div>
        <dl className="wr-dl">
          <div><dt>{t('patrimoine.return.start_value')}</dt><dd className="num">{money(result.startValue)}</dd></div>
          <div><dt>{t('patrimoine.return.net_deposits')}</dt><dd className="num">{result.netDeposits >= 0 ? '+' : '−'}{money(Math.abs(result.netDeposits))}</dd></div>
          <div><dt>{t('patrimoine.return.gain')}</dt><dd className={`num ${result.gain >= 0 ? 'income' : 'expense'}`}>{result.gain >= 0 ? '+' : '−'}{money(Math.abs(result.gain))}</dd></div>
          <div><dt>{t('patrimoine.return.current')}</dt><dd className="num">{money(result.currentValue)}</dd></div>
        </dl>
      </div>
      {years.length > 0 && (
        <ul className="wr-years">
          {years.map((y) => (
            <li key={y.year}>
              <span>{y.year}</span>
              <span className="wr-track"><i className={y.pct! >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(y.pct!) / maxAbs) * 100}%` }} /></span>
              <span className={`num ${y.pct! >= 0 ? 'income' : 'expense'}`}>{pct(y.pct)}</span>
              <span className="num acc-muted">{y.gain >= 0 ? '+' : '−'}{money(Math.abs(y.gain))}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="acc-muted wr-note">{t('patrimoine.return.note')}</p>
    </section>
  );
}
