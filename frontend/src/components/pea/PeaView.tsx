import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  PEA_CEILING,
  envelopePerformance,
  estimateWithdrawalTax,
  monthsBetween,
  peaFiscalStatus,
  projectCeilingDate,
  recentMonthlyAverage,
  type ValuedHolding,
} from '@suzanne/shared';
import { money } from '../../lib/format';
import { localeTag } from '../../i18n';
import { formatDateFr, formatPct, formatQuantity, parseDecimal, type EnvelopeFlow } from '../../lib/pea';
import type { AccountWithInvestment } from '../../lib/api-accounts';
import { CompositionChart } from './CompositionChart';
import { PeaGrowth } from './PeaGrowth';
import type { EnvelopeHistory } from './useEnvelopeHistory';
import { WrapperCard } from './WrapperCard';
import '../../styles/pages/pea.css';

export interface PeaData {
  positions: ValuedHolding[];
  /** Valorisation au prix de revient (cours indisponibles ou API hors ligne). */
  degraded: 'none' | 'partial' | 'offline';
  cash: number;
  flows: EnvelopeFlow[];
  /** Revenus encaissés (dividendes, coupons…). */
  incomes?: EnvelopeFlow[];
}

function ageLabel(fromIso: string, toIso: string, t: TFunction): string {
  const months = monthsBetween(fromIso, toIso);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y > 0 ? t('patrimoine.pea.years', { count: y }) : '', m > 0 ? t('patrimoine.pea.months', { count: m }) : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : t('patrimoine.pea.less_than_a_month');
}

// Vue « enveloppe » d'un compte d'investissement : positions, espèces,
// versements, performance ; pour un PEA, plafond et fiscalité en plus.
export function PeaView({ account, data, asOf, history }: { account: AccountWithInvestment; data: PeaData; asOf: string; history?: EnvelopeHistory }) {
  const { t } = useTranslation();
  const ccy = account.currency;
  const fmt = (v: number) => money(v, ccy);
  const isPea = account.type === 'pea';
  const { positions, cash, flows } = data;
  const [showAllFlows, setShowAllFlows] = useState(false);

  const securities = positions.reduce((s, p) => s + p.market_value, 0);
  const costBasis = positions.reduce((s, p) => s + p.cost_basis, 0);
  const value = securities + cash;
  const deposits = flows.filter((f) => f.amount > 0);
  const withdrawals = flows.filter((f) => f.amount < 0);
  const gross = deposits.reduce((s, f) => s + f.amount, 0);
  const withdrawn = -withdrawals.reduce((s, f) => s + f.amount, 0);
  const net = gross - withdrawn;
  const firstDeposit = deposits.length > 0 ? deposits[deposits.length - 1]!.date : null;

  const perf = useMemo(() => envelopePerformance(flows, value, asOf), [flows, value, asOf]);
  const latentPct = costBasis > 0 ? ((securities - costBasis) / costBasis) * 100 : null;
  const firstDate = firstDeposit ?? asOf;
  const elapsedMonths = monthsBetween(firstDate, asOf) + 1;
  const recentPace = recentMonthlyAverage(deposits, asOf, 12, elapsedMonths);
  // Rythme récent, ou moyenne depuis l'ouverture si presque rien versé sur 12 mois.
  const pace12 = recentPace >= 10 ? recentPace : Math.max(recentPace, gross / elapsedMonths);

  return (
    <div className="pea">
      <div className="kpis">
        <div className="kpi"><span>{t('patrimoine.pea.securities')}</span><strong>{fmt(securities)}</strong><small>{t('patrimoine.pea.lines', { count: positions.length })}</small></div>
        <div className="kpi"><span>{t('patrimoine.pea.cash')}</span><strong className={cash < 0 ? 'expense' : ''}>{fmt(cash)}</strong><small>{t('patrimoine.pea.not_invested')}</small></div>
        <div className="kpi"><span>{t('patrimoine.pea.net_deposits')}</span><strong>{fmt(net)}</strong><small>{withdrawn > 0 ? t('patrimoine.pea.gross_minus_withdrawn', { gross: fmt(gross), withdrawn: fmt(withdrawn) }) : t('patrimoine.pea.deposit_count', { count: deposits.length })}</small></div>
        {flows.length > 0 ? (
          <div className="kpi">
            <span>{perf.kind === 'xirr' ? t('patrimoine.pea.annualized_return') : t('patrimoine.pea.cumulative_performance')}</span>
            <strong className={perf.rate == null ? '' : perf.rate >= 0 ? 'income' : 'expense'}>{formatPct(perf.rate)}</strong>
            <small className="num">{perf.gain >= 0 ? '+' : '−'}{fmt(Math.abs(perf.gain))}{perf.kind === 'cumulative' ? ` · ${t('patrimoine.pea.less_than_a_year')}` : ' · XIRR'}</small>
          </div>
        ) : (
          <div className="kpi">
            <span>{t('patrimoine.pea.unrealized_gain')}</span>
            <strong className={securities - costBasis >= 0 ? 'income' : 'expense'}>{formatPct(latentPct)}</strong>
            <small className="num">{securities - costBasis >= 0 ? '+' : '−'}{fmt(Math.abs(securities - costBasis))}</small>
          </div>
        )}
      </div>

      <section className="pg-section">
        <div className="pg-section-head"><h2>{t('patrimoine.pea.positions')}</h2>{positions.length > 0 && <span className="acc-muted num">{fmt(securities)}</span>}</div>
        {data.degraded !== 'none' && (
          <p className="pea-note">
            {data.degraded === 'offline'
              ? t('patrimoine.pea.valuation_offline')
              : t('patrimoine.pea.some_prices_missing')}
          </p>
        )}
        {positions.length === 0 ? (
          <p className="acc-muted">{t('patrimoine.pea.no_position')}</p>
        ) : (
          <div className="pea-table-wrap">
            <table className="pea-table">
              <thead>
                <tr>
                  <th>{t('patrimoine.pea.col_security')}</th><th className="r">{t('patrimoine.pea.col_quantity')}</th><th className="r">{t('patrimoine.pea.col_avg_cost')}</th><th className="r">{t('patrimoine.pea.col_price')}</th>
                  <th className="r">{t('patrimoine.pea.col_value')}</th><th className="r">{t('patrimoine.pea.col_unrealized')}</th><th className="r">{t('patrimoine.pea.col_weight')}</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pnlPct = p.cost_basis > 0 ? (p.unrealized_pnl / p.cost_basis) * 100 : null;
                  return (
                    <tr key={p.id}>
                      <td className="pea-title"><strong>{p.name || p.symbol}</strong><span>{p.symbol}</span></td>
                      <td className="r num" data-label={t('patrimoine.pea.col_quantity')}>{formatQuantity(p.quantity)}</td>
                      <td className="r num" data-label={t('patrimoine.pea.col_avg_cost')}>{money(p.avg_cost, p.currency)}</td>
                      <td className="r num" data-label={t('patrimoine.pea.col_price')}>{p.price != null ? money(p.price, p.currency) : <span className="acc-muted">{t('patrimoine.pea.not_available')}</span>}</td>
                      <td className="r num pea-value" data-label={t('patrimoine.pea.col_value')}>{fmt(p.market_value)}</td>
                      <td className={`r num ${p.price == null ? '' : p.unrealized_pnl >= 0 ? 'income' : 'expense'}`} data-label={t('patrimoine.pea.col_unrealized')}>
                        {p.price == null ? '—' : <>{p.unrealized_pnl >= 0 ? '+' : '−'}{fmt(Math.abs(p.unrealized_pnl))} <small>{formatPct(pnlPct)}</small></>}
                      </td>
                      <td className="r num" data-label={t('patrimoine.pea.col_weight')}>
                        <span className="pea-weight"><i style={{ width: `${Math.min(100, p.weight)}%` }} /></span>
                        {formatPct(p.weight, false)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {positions.length > 0 && (
        <section className="pg-section">
          <div className="pg-section-head"><h2>{t('patrimoine.pea.composition')}</h2></div>
          <CompositionChart positions={positions} cash={cash} fmt={fmt} />
        </section>
      )}

      {history && flows.length > 0 && (
        <PeaGrowth
          history={history}
          flows={flows}
          value={value}
          asOf={asOf}
          rate={perf.kind === 'xirr' && perf.rate != null ? perf.rate / 100 : null}
          pace={pace12}
          ccy={ccy}
          fmt={fmt}
        />
      )}

      {(account.type === 'life_insurance' || account.type === 'retirement') && (
        <div className="pea-grid">
          <WrapperCard
            account={account}
            firstDeposit={firstDeposit}
            value={value}
            net={net}
            yearDeposits={deposits.filter((d) => d.date.startsWith(asOf.slice(0, 4))).reduce((s, d) => s + d.amount, 0)}
            asOf={asOf}
            fmt={fmt}
          />
        </div>
      )}

      {isPea && (
        <div className="pea-grid">
          <CeilingCard gross={gross} deposits={deposits} firstDeposit={firstDeposit} asOf={asOf} fmt={fmt} />
          <FiscalCard account={account} firstDeposit={firstDeposit} value={value} net={net} asOf={asOf} fmt={fmt} ccy={ccy} />
        </div>
      )}

      <section className="pg-section">
        <div className="pg-section-head">
          <h2>{t('patrimoine.pea.deposits')}</h2>
          {flows.length > 0 && <span className="acc-muted">{t('patrimoine.pea.gross')} <b className="num">{fmt(gross)}</b> · {t('patrimoine.pea.net')} <b className="num">{fmt(net)}</b></span>}
        </div>
        {flows.length === 0 ? (
          <p className="acc-muted">{t('patrimoine.pea.no_deposit')}</p>
        ) : (
          <>
            <ul className="pea-flows">
              {(showAllFlows ? flows : flows.slice(0, 8)).map((f) => (
                <li key={f.id}>
                  <span className="pea-flow-date">{formatDateFr(f.date)}</span>
                  <span className="pea-flow-label">{f.description || (f.amount > 0 ? t('patrimoine.pea.deposit') : t('patrimoine.pea.withdrawal'))}</span>
                  <span className={`num ${f.amount >= 0 ? 'income' : 'expense'}`}>{f.amount >= 0 ? '+' : '−'}{fmt(Math.abs(f.amount))}</span>
                </li>
              ))}
            </ul>
            {flows.length > 8 && (
              <button type="button" className="secondary pea-more" onClick={() => setShowAllFlows((v) => !v)}>
                {showAllFlows ? t('patrimoine.pea.collapse') : t('patrimoine.pea.show_all_moves', { n: flows.length })}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CeilingCard({ gross, deposits, firstDeposit, asOf, fmt }: {
  gross: number;
  deposits: EnvelopeFlow[];
  firstDeposit: string | null;
  asOf: string;
  fmt: (v: number) => string;
}) {
  const pct = Math.min(100, (gross / PEA_CEILING) * 100);
  const elapsed = firstDeposit ? monthsBetween(firstDeposit, asOf) + 1 : undefined;
  const recent = recentMonthlyAverage(deposits, asOf, 12, elapsed);
  // Moyenne depuis le premier versement : repli quand rien n'a été versé
  // récemment, et repère utile à côté du rythme récent.
  const overall = elapsed ? gross / elapsed : 0;
  const pace = recent > 0 ? recent : overall;
  const projection = projectCeilingDate(gross, pace, asOf);
  const tooFar = projection != null && projection.monthsNeeded > 80 * 12;
  const { t } = useTranslation();
  return (
    <section className="pea-card">
      <h2>{t('patrimoine.pea.ceiling')}</h2>
      <p className="pea-big num">{fmt(gross)} <span>/ {fmt(PEA_CEILING)}</span></p>
      <p className="acc-muted num">{t('patrimoine.pea.pct_of_ceiling', { pct: pct.toLocaleString(localeTag(), { maximumFractionDigits: 2 }) })}</p>
      <div className="pea-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={t('patrimoine.pea.ceiling_progress')}>
        <i style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : ''} />
      </div>
      <dl className="pea-dl">
        <div><dt>{t('patrimoine.pea.still_payable')}</dt><dd className="num">{fmt(Math.max(0, PEA_CEILING - gross))}</dd></div>
        <div><dt>{t('patrimoine.pea.pace_12_months')}</dt><dd className="num">{recent > 0 ? t('patrimoine.pea.per_month', { amount: fmt(recent) }) : '—'}</dd></div>
        <div><dt>{t('patrimoine.pea.average_since_opening')}</dt><dd className="num">{overall > 0 ? t('patrimoine.pea.per_month', { amount: fmt(overall) }) : '—'}</dd></div>
        <div>
          <dt>{t('patrimoine.pea.ceiling_reached')}</dt>
          <dd>
            {gross >= PEA_CEILING
              ? t('patrimoine.pea.reached')
              : !projection
                ? t('patrimoine.pea.no_deposit_short')
                : tooFar
                  ? t('patrimoine.pea.out_of_reach')
                  : t('patrimoine.pea.reached_on', { date: formatDateFr(projection.date, { month: 'long', year: 'numeric' }), years: Math.max(1, Math.round(projection.monthsNeeded / 12)) })}
          </dd>
        </div>
      </dl>
      <p className="pea-foot">{t('patrimoine.pea.ceiling_note')}</p>
    </section>
  );
}

function FiscalCard({ account, firstDeposit, value, net, asOf, fmt, ccy }: {
  account: AccountWithInvestment;
  firstDeposit: string | null;
  value: number;
  net: number;
  asOf: string;
  fmt: (v: number) => string;
  ccy: string;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const openDate = account.fiscal_start_date?.slice(0, 10) ?? firstDeposit ?? account.initial_balance_date.slice(0, 10);
  const status = peaFiscalStatus(openDate, asOf);
  const parsed = parseDecimal(raw);
  const withdrawal = raw.trim() === '' || !Number.isFinite(parsed) ? value : Math.min(parsed, value);
  const tax = estimateWithdrawalTax({ value, netDeposits: net, openDate, asOf, withdrawal });
  const psYear = tax.psRateFrom.slice(0, 4);
  const pctFmt = (r: number) => `${(r * 100).toLocaleString(localeTag(), { maximumFractionDigits: 1 })} %`;
  return (
    <section className="pea-card">
      <h2>{t('patrimoine.pea.tax')}</h2>
      <p className="pea-big">{ageLabel(openDate, asOf, t)}</p>
      <p className="acc-muted">
        {account.fiscal_start_date
          ? t('patrimoine.pea.seniority_since', { date: formatDateFr(openDate) })
          : t('patrimoine.pea.seniority_since_first', { date: formatDateFr(openDate) })}{' '}
        {status.isEligible
          ? t('patrimoine.pea.over_5_years')
          : <>{t('patrimoine.pea.five_years_on')} <b>{formatDateFr(status.eligibilityDate)}</b>.</>}
      </p>
      <label className="pea-sim">
        <span>{t('patrimoine.pea.if_withdraw_today')}</span>
        <input inputMode="decimal" autoComplete="off" placeholder={t('patrimoine.pea.all_amount', { amount: fmt(value) })} value={raw} onChange={(e) => setRaw(e.target.value)} aria-label={t('patrimoine.pea.withdrawal_amount', { ccy })} />
      </label>
      <dl className="pea-dl">
        <div><dt>{t('patrimoine.pea.gain_share')}</dt><dd className={`num ${tax.gain < 0 ? 'expense' : ''}`}>{tax.gain >= 0 ? '' : '−'}{fmt(Math.abs(tax.gain))}</dd></div>
        {!tax.isEligible && <div><dt>{t('patrimoine.pea.income_tax', { rate: pctFmt(tax.irRate) })}</dt><dd className="num">{fmt(tax.ir)}</dd></div>}
        <div><dt>{t('patrimoine.pea.social_charges', { rate: pctFmt(tax.psRate) })} <small>{psYear === '0000' ? t('patrimoine.pea.historical_rate') : t('patrimoine.pea.rate_year', { year: psYear })}</small></dt><dd className="num">{fmt(tax.ps)}</dd></div>
        <div className="pea-total"><dt>{t('patrimoine.pea.estimated_tax')}</dt><dd className="num">{fmt(tax.total)}</dd></div>
        <div><dt>{t('patrimoine.pea.net_received')}</dt><dd className="num">{fmt(tax.net)}</dd></div>
      </dl>
      <p className="pea-foot">
        {tax.closesPlan
          ? t('patrimoine.pea.before_5_closes')
          : t('patrimoine.pea.after_5_partial')}{' '}
        {t('patrimoine.pea.partial_gain_formula')}
      </p>
    </section>
  );
}
