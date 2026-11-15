import { useTranslation } from 'react-i18next';
import { feeImpact, type Account } from '@suzanne/shared';
import { localeTag } from '../../i18n';

// Placement : ce que coûtent ses frais annuels (gestion du contrat + frais des
// fonds), cette année et sur 20 ans à 7 % brut, intérêts composés compris.
const HORIZON = 20;
const GROSS = 0.07;

export function FeesCard({ account, value, fmt, onEdit }: {
  account: Account;
  value: number;
  fmt: (v: number) => string;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const ratePct = account.annual_fee_rate;
  const pct = (v: number) => `${v.toLocaleString(localeTag(), { maximumFractionDigits: 2 })} %`;
  if (ratePct == null) {
    return (
      <section className="pg-section ad-fees">
        <div className="pg-section-head"><h2>{t('comptes.features.fees_title')}</h2></div>
        <p className="acc-muted">{t('comptes.features.fees_unknown')} <button type="button" className="link-button" onClick={onEdit}>{t('comptes.features.fees_set')}</button></p>
      </section>
    );
  }
  const impact = feeImpact(Math.max(0, value), ratePct / 100, { grossReturn: GROSS, years: HORIZON });
  const cheap = feeImpact(Math.max(0, value), 0.002, { grossReturn: GROSS, years: HORIZON });
  return (
    <section className="pg-section ad-fees">
      <div className="pg-section-head"><h2>{t('comptes.features.fees_title')}</h2></div>
      <div className="ad-kpis">
        <div className="kpi"><span>{t('comptes.features.fees_rate')}</span><strong className="num">{pct(ratePct)}</strong><small>{t('comptes.features.fees_net', { pct: pct(impact.netReturn * 100) })}</small></div>
        <div className="kpi"><span>{t('comptes.features.fees_year')}</span><strong className="num expense">{fmt(impact.annualCost)}</strong><small>{t('comptes.features.fees_year_hint')}</small></div>
        <div className="kpi"><span>{t('comptes.features.fees_horizon', { years: HORIZON })}</span><strong className="num expense">{fmt(impact.lost)}</strong><small>{t('comptes.features.fees_horizon_hint', { final: fmt(impact.finalWithFees), without: fmt(impact.finalWithoutFees) })}</small></div>
      </div>
      {ratePct > 0.5 && (
        <p className="acc-muted ad-note">{t('comptes.features.fees_compare', { saving: fmt(impact.finalWithFees > 0 ? cheap.finalWithFees - impact.finalWithFees : 0), years: HORIZON })}</p>
      )}
    </section>
  );
}
