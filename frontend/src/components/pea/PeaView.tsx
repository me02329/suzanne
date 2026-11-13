import { useMemo, useState } from 'react';
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
import { formatDateFr, formatPct, formatQuantity, parseDecimal, type EnvelopeFlow } from '../../lib/pea';
import type { AccountWithInvestment } from '../../lib/api-accounts';
import '../../styles/pages/pea.css';

export interface PeaData {
  positions: ValuedHolding[];
  /** Valorisation au prix de revient (cours indisponibles ou API hors ligne). */
  degraded: 'none' | 'partial' | 'offline';
  cash: number;
  flows: EnvelopeFlow[];
}

function ageLabel(fromIso: string, toIso: string): string {
  const months = monthsBetween(fromIso, toIso);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y > 0 ? `${y} an${y > 1 ? 's' : ''}` : '', m > 0 ? `${m} mois` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'moins d’un mois';
}

// Vue « enveloppe » d'un compte d'investissement : positions, espèces,
// versements, performance ; pour un PEA, plafond et fiscalité en plus.
export function PeaView({ account, data, asOf }: { account: AccountWithInvestment; data: PeaData; asOf: string }) {
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

  return (
    <div className="pea">
      <div className="kpis">
        <div className="kpi"><span>Titres</span><strong>{fmt(securities)}</strong><small>{positions.length} ligne{positions.length > 1 ? 's' : ''}</small></div>
        <div className="kpi"><span>Espèces</span><strong className={cash < 0 ? 'expense' : ''}>{fmt(cash)}</strong><small>non investies</small></div>
        <div className="kpi"><span>Versements nets</span><strong>{fmt(net)}</strong><small>{withdrawn > 0 ? `${fmt(gross)} versés − ${fmt(withdrawn)}` : `${deposits.length} versement${deposits.length > 1 ? 's' : ''}`}</small></div>
        {flows.length > 0 ? (
          <div className="kpi">
            <span>{perf.kind === 'xirr' ? 'Rendement annualisé' : 'Performance cumulée'}</span>
            <strong className={perf.rate == null ? '' : perf.rate >= 0 ? 'income' : 'expense'}>{formatPct(perf.rate)}</strong>
            <small className="num">{perf.gain >= 0 ? '+' : '−'}{fmt(Math.abs(perf.gain))}{perf.kind === 'cumulative' ? ' · moins d’un an' : ' · XIRR'}</small>
          </div>
        ) : (
          <div className="kpi">
            <span>Plus-value latente</span>
            <strong className={securities - costBasis >= 0 ? 'income' : 'expense'}>{formatPct(latentPct)}</strong>
            <small className="num">{securities - costBasis >= 0 ? '+' : '−'}{fmt(Math.abs(securities - costBasis))}</small>
          </div>
        )}
      </div>

      <section className="pg-section">
        <div className="pg-section-head"><h2>Positions</h2>{positions.length > 0 && <span className="acc-muted num">{fmt(securities)}</span>}</div>
        {data.degraded !== 'none' && (
          <p className="pea-note">
            {data.degraded === 'offline'
              ? 'Valorisation indisponible (hors ligne) : positions affichées au prix de revient.'
              : 'Certains cours sont indisponibles : ces lignes sont valorisées au prix de revient.'}
          </p>
        )}
        {positions.length === 0 ? (
          <p className="acc-muted">Aucune position. Ajoute tes titres et leurs ordres depuis Investissements.</p>
        ) : (
          <div className="pea-table-wrap">
            <table className="pea-table">
              <thead>
                <tr>
                  <th>Titre</th><th className="r">Quantité</th><th className="r">PRU</th><th className="r">Cours</th>
                  <th className="r">Valeur</th><th className="r">+/- latente</th><th className="r">Poids</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pnlPct = p.cost_basis > 0 ? (p.unrealized_pnl / p.cost_basis) * 100 : null;
                  return (
                    <tr key={p.id}>
                      <td className="pea-title"><strong>{p.name || p.symbol}</strong><span>{p.symbol}</span></td>
                      <td className="r num" data-label="Quantité">{formatQuantity(p.quantity)}</td>
                      <td className="r num" data-label="PRU">{money(p.avg_cost, p.currency)}</td>
                      <td className="r num" data-label="Cours">{p.price != null ? money(p.price, p.currency) : <span className="acc-muted">n/d</span>}</td>
                      <td className="r num pea-value" data-label="Valeur">{fmt(p.market_value)}</td>
                      <td className={`r num ${p.price == null ? '' : p.unrealized_pnl >= 0 ? 'income' : 'expense'}`} data-label="+/- latente">
                        {p.price == null ? '—' : <>{p.unrealized_pnl >= 0 ? '+' : '−'}{fmt(Math.abs(p.unrealized_pnl))} <small>{formatPct(pnlPct)}</small></>}
                      </td>
                      <td className="r num" data-label="Poids">
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

      {isPea && (
        <div className="pea-grid">
          <CeilingCard gross={gross} deposits={deposits} firstDeposit={firstDeposit} asOf={asOf} fmt={fmt} />
          <FiscalCard account={account} firstDeposit={firstDeposit} value={value} net={net} asOf={asOf} fmt={fmt} ccy={ccy} />
        </div>
      )}

      <section className="pg-section">
        <div className="pg-section-head">
          <h2>Versements</h2>
          {flows.length > 0 && <span className="acc-muted">brut <b className="num">{fmt(gross)}</b> · net <b className="num">{fmt(net)}</b></span>}
        </div>
        {flows.length === 0 ? (
          <p className="acc-muted">Aucun versement : un virement vers ce compte apparaîtra ici.</p>
        ) : (
          <>
            <ul className="pea-flows">
              {(showAllFlows ? flows : flows.slice(0, 8)).map((f) => (
                <li key={f.id}>
                  <span className="pea-flow-date">{formatDateFr(f.date)}</span>
                  <span className="pea-flow-label">{f.description || (f.amount > 0 ? 'Versement' : 'Retrait')}</span>
                  <span className={`num ${f.amount >= 0 ? 'income' : 'expense'}`}>{f.amount >= 0 ? '+' : '−'}{fmt(Math.abs(f.amount))}</span>
                </li>
              ))}
            </ul>
            {flows.length > 8 && (
              <button type="button" className="secondary pea-more" onClick={() => setShowAllFlows((v) => !v)}>
                {showAllFlows ? 'Réduire' : `Voir les ${flows.length} mouvements`}
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
  const pace = recentMonthlyAverage(deposits, asOf, 12, elapsed);
  const projection = projectCeilingDate(gross, pace, asOf);
  return (
    <section className="pea-card">
      <h2>Plafond</h2>
      <p className="pea-big num">{fmt(gross)} <span>/ {fmt(PEA_CEILING)}</span></p>
      <div className="pea-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Versements bruts sur le plafond">
        <i style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : ''} />
      </div>
      <dl className="pea-dl">
        <div><dt>Encore versable</dt><dd className="num">{fmt(Math.max(0, PEA_CEILING - gross))}</dd></div>
        <div><dt>Rythme (12 mois)</dt><dd className="num">{pace > 0 ? `${fmt(pace)}/mois` : '—'}</dd></div>
        <div>
          <dt>Plafond atteint</dt>
          <dd>{gross >= PEA_CEILING ? 'Atteint' : projection ? `${formatDateFr(projection.date, { month: 'long', year: 'numeric' })}` : 'Pas de versement récent'}</dd>
        </div>
      </dl>
      <p className="pea-foot">Le plafond porte sur les versements bruts : les gains et les retraits ne le modifient pas.</p>
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
  const [raw, setRaw] = useState('');
  const openDate = account.fiscal_start_date?.slice(0, 10) ?? firstDeposit ?? account.initial_balance_date.slice(0, 10);
  const status = peaFiscalStatus(openDate, asOf);
  const parsed = parseDecimal(raw);
  const withdrawal = raw.trim() === '' || !Number.isFinite(parsed) ? value : Math.min(parsed, value);
  const tax = estimateWithdrawalTax({ value, netDeposits: net, openDate, asOf, withdrawal });
  const psYear = tax.psRateFrom.slice(0, 4);
  const pctFmt = (r: number) => `${(r * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  return (
    <section className="pea-card">
      <h2>Fiscalité</h2>
      <p className="pea-big">{ageLabel(openDate, asOf)}</p>
      <p className="acc-muted">
        d'ancienneté depuis le {formatDateFr(openDate)}{account.fiscal_start_date ? '' : ' (premier versement)'}.{' '}
        {status.isEligible
          ? 'Plus de 5 ans : gains exonérés d’impôt sur le revenu.'
          : <>5 ans le <b>{formatDateFr(status.eligibilityDate)}</b>.</>}
      </p>
      <label className="pea-sim">
        <span>Si je retire aujourd'hui</span>
        <input inputMode="decimal" autoComplete="off" placeholder={`Tout (${fmt(value)})`} value={raw} onChange={(e) => setRaw(e.target.value)} aria-label={`Montant du retrait en ${ccy}`} />
      </label>
      <dl className="pea-dl">
        <div><dt>Part de gain</dt><dd className={`num ${tax.gain < 0 ? 'expense' : ''}`}>{tax.gain >= 0 ? '' : '−'}{fmt(Math.abs(tax.gain))}</dd></div>
        {!tax.isEligible && <div><dt>IR {pctFmt(tax.irRate)}</dt><dd className="num">{fmt(tax.ir)}</dd></div>}
        <div><dt>Prélèv. sociaux {pctFmt(tax.psRate)} <small>taux {psYear === '0000' ? 'historique' : psYear}</small></dt><dd className="num">{fmt(tax.ps)}</dd></div>
        <div className="pea-total"><dt>Impôt estimé</dt><dd className="num">{fmt(tax.total)}</dd></div>
        <div><dt>Net perçu</dt><dd className="num">{fmt(tax.net)}</dd></div>
      </dl>
      <p className="pea-foot">
        {tax.closesPlan
          ? 'Avant 5 ans, tout retrait clôture le plan (sauf cas d’exonération).'
          : 'Après 5 ans, un retrait partiel ne clôture pas le plan.'}{' '}
        Gain d'un retrait partiel = retrait × (valeur − versements nets) / valeur.
      </p>
    </section>
  );
}
