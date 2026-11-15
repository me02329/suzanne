import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addYearsIso, socialTaxRateAt } from '@suzanne/shared';
import { localeTag } from '../../i18n';
import { formatDateFr, parseDecimal } from '../../lib/pea';
import type { AccountWithInvestment } from '../../lib/api-accounts';

// Fiscalité des enveloppes autres que le PEA (règles françaises, estimation
// indicative). Assurance-vie : ancienneté de 8 ans, puis abattement annuel sur
// les gains et taux réduit. PER : sommes bloquées jusqu'à la retraite,
// versements déductibles du revenu imposable.
const LIFE_INSURANCE_ALLOWANCE = { single: 4600, couple: 9200 };
const TMI_RATES = [0, 0.11, 0.3, 0.41, 0.45];

export function WrapperCard({ account, firstDeposit, value, net, yearDeposits, asOf, fmt }: {
  account: AccountWithInvestment;
  firstDeposit: string | null;
  value: number;
  net: number;
  /** Versements de l'année en cours (PER : base de la déduction). */
  yearDeposits: number;
  asOf: string;
  fmt: (v: number) => string;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [couple, setCouple] = useState(false);
  const [tmi, setTmi] = useState(0.3);
  const pctFmt = (r: number) => `${(r * 100).toLocaleString(localeTag(), { maximumFractionDigits: 1 })} %`;
  const openDate = account.fiscal_start_date?.slice(0, 10) ?? firstDeposit ?? account.initial_balance_date.slice(0, 10);

  if (account.type === 'retirement') {
    return (
      <section className="pea-card">
        <h2>{t('patrimoine.wrapper.per_title')}</h2>
        <p className="pea-big">{t('patrimoine.wrapper.per_locked')}</p>
        <p className="acc-muted">{t('patrimoine.wrapper.per_locked_hint')}</p>
        <label className="pea-sim">
          <span>{t('patrimoine.wrapper.tmi')}</span>
          <select value={tmi} onChange={(e) => setTmi(Number(e.target.value))}>
            {TMI_RATES.map((r) => <option key={r} value={r}>{pctFmt(r)}</option>)}
          </select>
        </label>
        <dl className="pea-dl">
          <div><dt>{t('patrimoine.wrapper.per_year_deposits')}</dt><dd className="num">{fmt(yearDeposits)}</dd></div>
          <div className="pea-total"><dt>{t('patrimoine.wrapper.per_tax_saving')}</dt><dd className="num income">{fmt(yearDeposits * tmi)}</dd></div>
          <div><dt>{t('patrimoine.wrapper.net_deposits')}</dt><dd className="num">{fmt(net)}</dd></div>
        </dl>
        <p className="acc-muted">{t('patrimoine.wrapper.per_note')}</p>
      </section>
    );
  }

  // Assurance-vie : part de gains d'un rachat, taxée selon l'ancienneté.
  const eightYears = addYearsIso(openDate, 8);
  const mature = asOf >= eightYears;
  const parsed = parseDecimal(raw);
  const withdrawal = raw.trim() === '' || !Number.isFinite(parsed) ? value : Math.min(parsed, value);
  const gainShare = value > 0 ? Math.max(0, withdrawal * (value - net) / value) : 0;
  const allowance = couple ? LIFE_INSURANCE_ALLOWANCE.couple : LIFE_INSURANCE_ALLOWANCE.single;
  const irRate = mature ? 0.075 : 0.128;
  const irBase = mature ? Math.max(0, gainShare - allowance) : gainShare;
  const ir = irBase * irRate;
  const { rate: psRate } = socialTaxRateAt(asOf);
  const ps = gainShare * psRate;
  return (
    <section className="pea-card">
      <h2>{t('patrimoine.wrapper.life_title')}</h2>
      <p className="pea-big">{mature ? t('patrimoine.wrapper.life_mature') : t('patrimoine.wrapper.life_until', { date: formatDateFr(eightYears) })}</p>
      <p className="acc-muted">{t('patrimoine.wrapper.since', { date: formatDateFr(openDate) })}</p>
      <label className="pea-sim">
        <span>{t('patrimoine.wrapper.if_withdraw_today')}</span>
        <input inputMode="decimal" autoComplete="off" placeholder={fmt(value)} value={raw} onChange={(e) => setRaw(e.target.value)} />
      </label>
      {mature && (
        <label className="pea-check">
          <input type="checkbox" checked={couple} onChange={(e) => setCouple(e.target.checked)} />
          <span>{t('patrimoine.wrapper.couple', { amount: fmt(LIFE_INSURANCE_ALLOWANCE.couple) })}</span>
        </label>
      )}
      <dl className="pea-dl">
        <div><dt>{t('patrimoine.wrapper.gain_share')}</dt><dd className="num">{fmt(gainShare)}</dd></div>
        {mature && <div><dt>{t('patrimoine.wrapper.allowance')}</dt><dd className="num">−{fmt(Math.min(allowance, gainShare))}</dd></div>}
        <div><dt>{t('patrimoine.wrapper.income_tax', { rate: pctFmt(irRate) })}</dt><dd className="num">{fmt(ir)}</dd></div>
        <div><dt>{t('patrimoine.wrapper.social', { rate: pctFmt(psRate) })}</dt><dd className="num">{fmt(ps)}</dd></div>
        <div className="pea-total"><dt>{t('patrimoine.wrapper.estimated_tax')}</dt><dd className="num">{fmt(ir + ps)}</dd></div>
        <div><dt>{t('patrimoine.wrapper.net_received')}</dt><dd className="num">{fmt(withdrawal - ir - ps)}</dd></div>
      </dl>
      <p className="acc-muted">{t('patrimoine.wrapper.life_note')}</p>
    </section>
  );
}
