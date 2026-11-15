import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Account, AccountSnapshot, DashboardSummary } from '@suzanne/shared';
import { formatDateFr } from '../../lib/pea';
import { localeTag } from '../../i18n';

// Bien (immobilier, véhicule, objet) : sa valeur est une estimation. Chaque
// relevé est une nouvelle estimation ; le solde initial est le prix d'achat.
// Avec un prêt lié : reste dû et capital net (valeur − reste dû).
export function ValuationCard({ account, accounts, summary, snapshots, value, fmt, onEstimate }: {
  account: Account;
  accounts: Account[];
  summary: DashboardSummary | null;
  snapshots: AccountSnapshot[];
  value: number;
  fmt: (v: number) => string;
  onEstimate: () => void;
}) {
  const { t } = useTranslation();
  const purchase = account.initial_balance;
  const gain = value - purchase;
  const gainPct = purchase > 0 ? (gain / purchase) * 100 : null;
  const loan = account.linked_account_id != null ? accounts.find((a) => a.id === account.linked_account_id) : undefined;
  const loanRow = loan ? summary?.account_balances.find((b) => b.account_id === loan.id) : undefined;
  const owed = loanRow ? Math.abs(loanRow.balance) : null;
  const estimates = snapshots.filter((s) => s.account_id === account.id).sort((a, b) => b.date.localeCompare(a.date));
  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString(localeTag(), { maximumFractionDigits: 1 })} %`;

  return (
    <section className="pg-section ad-valuation">
      <div className="pg-section-head">
        <h2>{t('comptes.features.valuation_title')}</h2>
        <button type="button" className="secondary" onClick={onEstimate}>{t('comptes.features.new_estimate')}</button>
      </div>
      <div className="ad-kpis">
        <div className="kpi"><span>{t('comptes.features.estimated_value')}</span><strong className="num">{fmt(value)}</strong><small>{estimates[0] ? t('comptes.features.estimated_on', { date: formatDateFr(estimates[0].date) }) : t('comptes.features.no_estimate')}</small></div>
        <div className="kpi"><span>{t('comptes.features.purchase_price')}</span><strong className="num">{fmt(purchase)}</strong><small>{formatDateFr(account.initial_balance_date)}</small></div>
        <div className="kpi"><span>{t('comptes.features.capital_gain')}</span><strong className={`num ${gain < 0 ? 'expense' : 'income'}`}>{gain >= 0 ? '+' : '−'}{fmt(Math.abs(gain))}</strong><small>{gainPct != null ? pct(gainPct) : '—'}</small></div>
        {loan && owed != null && (
          <>
            <div className="kpi"><span>{t('comptes.features.loan_remaining')}</span><strong className="num expense">{fmt(owed)}</strong><small><Link to={`/accounts/${loan.id}`}>{loan.name}</Link></small></div>
            <div className="kpi"><span>{t('comptes.features.net_equity')}</span><strong className="num">{fmt(value - owed)}</strong><small>{value > 0 ? t('comptes.features.owned_share', { pct: Math.round(((value - owed) / value) * 100) }) : ''}</small></div>
          </>
        )}
      </div>
      {!loan && account.type === 'real_estate' && <p className="acc-muted ad-note">{t('comptes.features.link_loan_hint')}</p>}
      {estimates.length > 0 && (
        <table className="ad-table">
          <thead><tr><th>{t('comptes.features.date')}</th><th className="num">{t('comptes.features.estimate')}</th></tr></thead>
          <tbody>
            {estimates.map((s) => <tr key={s.id}><td>{formatDateFr(s.date)}</td><td className="num">{fmt(s.balance)}</td></tr>)}
          </tbody>
        </table>
      )}
    </section>
  );
}
