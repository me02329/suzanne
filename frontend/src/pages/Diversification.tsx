import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import {
  buildPyramid,
  type Account,
  type AssetBucket,
  type Diagnostic,
  type DashboardSummary,
  type HoldingsValuation,
  type Institution,
  type PyramidLayer,
} from '@suzanne/shared';
import { api } from '../lib/api';
import { money as moneyFmt } from '../lib/format';
import '../styles/pages/diversification.css';

// Analyse → Diversification : la pyramide de l'épargne (précaution, sécurisé,
// croissance long terme, spéculatif), la répartition par classe d'actifs et un
// diagnostic (mois de dépenses en précaution, part spéculative, concentration,
// garanties par établissement, enveloppes à ouvrir tôt).

// Clés écrites en toutes lettres (vérifiées par i18n:check).
const LAYER_TEXT: Record<PyramidLayer, { title: string; hint: string }> = {
  speculative: { title: 'analyses.diversification.layer_speculative', hint: 'analyses.diversification.layer_speculative_hint' },
  growth: { title: 'analyses.diversification.layer_growth', hint: 'analyses.diversification.layer_growth_hint' },
  secure: { title: 'analyses.diversification.layer_secure', hint: 'analyses.diversification.layer_secure_hint' },
  safety: { title: 'analyses.diversification.layer_safety', hint: 'analyses.diversification.layer_safety_hint' },
};
const BUCKET_TEXT: Record<AssetBucket, string> = {
  cash: 'analyses.diversification.bucket_cash',
  bonds: 'analyses.diversification.bucket_bonds',
  equities: 'analyses.diversification.bucket_equities',
  real_estate: 'analyses.diversification.bucket_real_estate',
  alternative: 'analyses.diversification.bucket_alternative',
};
const DIAG_TEXT: Record<Diagnostic['id'], string> = {
  emergency_missing: 'analyses.diversification.diag_emergency_missing',
  emergency_low: 'analyses.diversification.diag_emergency_low',
  emergency_ok: 'analyses.diversification.diag_emergency_ok',
  emergency_high: 'analyses.diversification.diag_emergency_high',
  speculative_high: 'analyses.diversification.diag_speculative_high',
  speculative_ok: 'analyses.diversification.diag_speculative_ok',
  growth_low: 'analyses.diversification.diag_growth_low',
  concentration: 'analyses.diversification.diag_concentration',
  guarantee_deposits: 'analyses.diversification.diag_guarantee_deposits',
  guarantee_insurer: 'analyses.diversification.diag_guarantee_insurer',
  open_life_insurance: 'analyses.diversification.diag_open_life_insurance',
  open_pea: 'analyses.diversification.diag_open_pea',
};
const MONEY_PARAMS = new Set(['target', 'surplus', 'amount']);

export function Diversification({ userId, accounts, institutions, summary, reportCurrency }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  summary: DashboardSummary | null;
  reportCurrency: string;
}) {
  const { t } = useTranslation();
  const [valuation, setValuation] = useState<HoldingsValuation | null>(null);
  const [open, setOpen] = useState<PyramidLayer | null>(null);
  const currency = summary?.currency ?? reportCurrency;
  const money = (v: number) => moneyFmt(v, currency);

  useEffect(() => {
    let cancelled = false;
    api.holdingsValuation(userId, currency)
      .then((v) => { if (!cancelled) setValuation(v); })
      .catch(() => { if (!cancelled) setValuation({ currency, market_value: 0, cost_basis: 0, unrealized_pnl: 0, unrealized_pnl_pct: 0, holdings: [], allocation: [] }); });
    return () => { cancelled = true; };
  }, [userId, currency, summary]);

  // Dépenses mensuelles moyennes : les mois passés de la courbe sur 12 mois.
  const monthlyExpenses = useMemo(() => {
    const current = new Date().toISOString().slice(0, 7);
    const months = (summary?.monthly_cashflow ?? []).filter((m) => m.month < current && m.expenses > 0);
    return months.length > 0 ? months.reduce((s, m) => s + m.expenses, 0) / months.length : null;
  }, [summary]);

  const result = useMemo(() => {
    if (!summary || !valuation) return null;
    const institutionName = new Map(institutions.map((i) => [i.id, i.name]));
    const balanceOf = new Map(summary.account_balances.map((b) => [b.account_id, b.signed_balance]));
    return buildPyramid(
      accounts.filter((a) => !a.archived).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        professional: a.professional,
        institution: a.institution_id != null ? institutionName.get(a.institution_id) ?? null : null,
        balance: balanceOf.get(a.id) ?? 0,
        positions: valuation.holdings
          .filter((h) => h.account_id === a.id && h.quantity > 0)
          .map((h) => ({ symbol: h.symbol, name: h.name, asset_class: h.asset_class, value: h.market_value })),
      })),
      monthlyExpenses,
    );
  }, [accounts, institutions, summary, valuation, monthlyExpenses]);

  if (!result) return <section className="dv-page"><p className="acc-muted">{t('analyses.diversification.loading')}</p></section>;
  const pctFmt = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)} %`;
  const diagParams = (d: Diagnostic) => Object.fromEntries(Object.entries(d.params ?? {}).map(([k, v]) => [k, MONEY_PARAMS.has(k) && typeof v === 'number' ? money(v) : v]));

  return (
    <section className="dv-page">
      <header className="dv-head">
        <div>
          <span className="acc-kicker">{t('analyses.diversification.kicker')}</span>
          <strong className="dv-total num">{money(result.total)}</strong>
          <p className="acc-muted">
            {t('analyses.diversification.total_hint')}
            {result.excluded.business > 0 && ` ${t('analyses.diversification.excluded_business', { amount: money(result.excluded.business) })}`}
            {result.excluded.debts > 0 && ` ${t('analyses.diversification.excluded_debts', { amount: money(result.excluded.debts) })}`}
          </p>
        </div>
        {monthlyExpenses != null && <p className="dv-expenses acc-muted">{t('analyses.diversification.monthly_expenses', { amount: money(monthlyExpenses) })}</p>}
      </header>

      <div className="dv-grid">
        <section className="dv-card">
          <h2>{t('analyses.diversification.pyramid')}</h2>
          <ol className="dv-pyramid">
            {result.layers.map((l, i) => (
              <li key={l.layer} className={`dv-layer ${l.layer}${open === l.layer ? ' open' : ''}`} style={{ ['--w' as string]: `${46 + i * 18}%` }}>
                <button type="button" onClick={() => setOpen(open === l.layer ? null : l.layer)} aria-expanded={open === l.layer}>
                  <span className="dv-layer-name">{t(LAYER_TEXT[l.layer].title)}</span>
                  <span className="dv-layer-amount num">{money(l.amount)}</span>
                  <span className="dv-layer-share num">{pctFmt(l.share)}{l.layer === 'safety' && result.emergencyMonths != null ? ` · ${t('analyses.diversification.months', { count: Math.round(result.emergencyMonths * 10) / 10 })}` : ''}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="acc-muted dv-note">{t('analyses.diversification.click_layer')}</p>
        </section>

        <section className="dv-card">
          {open ? (
            <>
              <h2>{t(LAYER_TEXT[open].title)}</h2>
              <p className="acc-muted">{t(LAYER_TEXT[open].hint)}</p>
              <ul className="dv-items">
                {result.layers.find((l) => l.layer === open)!.items.map((it, i) => (
                  <li key={`${it.account_id}-${i}`}>
                    <Link to={`/accounts/${it.account_id}`}>{it.label}</Link>
                    <span className="acc-muted">{t(BUCKET_TEXT[it.bucket])}</span>
                    <span className="num">{money(it.amount)}</span>
                  </li>
                ))}
                {result.layers.find((l) => l.layer === open)!.items.length === 0 && <li className="acc-muted">{t('analyses.diversification.empty_layer')}</li>}
              </ul>
            </>
          ) : (
            <>
              <h2>{t('analyses.diversification.how_to_read')}</h2>
              <dl className="dv-legend">
                {result.layers.map((l) => (
                  <div key={l.layer}><dt><i className={`dv-dot ${l.layer}`} />{t(LAYER_TEXT[l.layer].title)}</dt><dd>{t(LAYER_TEXT[l.layer].hint)}</dd></div>
                ))}
              </dl>
            </>
          )}
        </section>
      </div>

      <section className="dv-card">
        <h2>{t('analyses.diversification.asset_classes')}</h2>
        <div className="dv-bar" role="img" aria-label={t('analyses.diversification.asset_classes')}>
          {result.buckets.filter((b) => b.amount > 0).map((b) => <span key={b.bucket} className={`dv-seg ${b.bucket}`} style={{ width: `${b.share * 100}%` }} title={`${t(BUCKET_TEXT[b.bucket])} · ${pctFmt(b.share)}`} />)}
        </div>
        <ul className="dv-bucket-legend">
          {result.buckets.map((b) => (
            <li key={b.bucket}><i className={`dv-seg ${b.bucket}`} />{t(BUCKET_TEXT[b.bucket])}<span className="num">{money(b.amount)}</span><span className="num acc-muted">{pctFmt(b.share)}</span></li>
          ))}
        </ul>
      </section>

      <section className="dv-card">
        <h2>{t('analyses.diversification.checkup')}</h2>
        <ul className="dv-diags">
          {result.diagnostics.map((d, i) => (
            <li key={`${d.id}-${i}`} className={d.level}>
              {d.level === 'warn' ? <AlertTriangle size={17} /> : d.level === 'ok' ? <CheckCircle2 size={17} /> : <Info size={17} />}
              <span>{t(DIAG_TEXT[d.id], diagParams(d))}</span>
            </li>
          ))}
        </ul>
        <p className="acc-muted dv-note">{t('analyses.diversification.disclaimer')}</p>
      </section>
    </section>
  );
}
