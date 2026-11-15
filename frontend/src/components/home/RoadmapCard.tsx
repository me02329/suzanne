import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, ChevronDown, Circle, CircleDashed, CircleDot } from 'lucide-react';
import { accountFeatures, buildRoadmap, type Account, type DashboardSummary, type RoadmapStepId, type Transaction } from '@suzanne/shared';
import { http } from '../../lib/api';
import { usePersistedState } from '../../lib/storage';
import { usePyramid } from '../../lib/usePyramid';
import { localeTag } from '../../i18n';
import '../../styles/components/roadmap.css';

// Accueil : feuille de route de l'épargnant, chaque étape cochée d'après les
// données (épargne de précaution, enveloppes ouvertes, versements réguliers…).

// Clés écrites en toutes lettres (vérifiées par i18n:check).
const STEP_TEXT: Record<RoadmapStepId, { title: string; hint: string; action: string }> = {
  budget: { title: 'accueil.roadmap.budget', hint: 'accueil.roadmap.budget_hint', action: 'accueil.roadmap.budget_action' },
  emergency: { title: 'accueil.roadmap.emergency', hint: 'accueil.roadmap.emergency_hint', action: 'accueil.roadmap.emergency_action' },
  life_insurance: { title: 'accueil.roadmap.life_insurance', hint: 'accueil.roadmap.life_insurance_hint', action: 'accueil.roadmap.life_insurance_action' },
  pea_etf: { title: 'accueil.roadmap.pea_etf', hint: 'accueil.roadmap.pea_etf_hint', action: 'accueil.roadmap.pea_etf_action' },
  regular: { title: 'accueil.roadmap.regular', hint: 'accueil.roadmap.regular_hint', action: 'accueil.roadmap.regular_action' },
  property: { title: 'accueil.roadmap.property', hint: 'accueil.roadmap.property_hint', action: 'accueil.roadmap.property_action' },
  tax: { title: 'accueil.roadmap.tax', hint: 'accueil.roadmap.tax_hint', action: 'accueil.roadmap.tax_action' },
};

export function RoadmapCard({ userId, accounts, summary, reportCurrency }: {
  userId: number;
  accounts: Account[];
  summary: DashboardSummary | null;
  reportCurrency: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = usePersistedState<boolean>('home_roadmap_open', true);
  const { pyramid, valuation } = usePyramid(userId, accounts, [], summary, reportCurrency);
  const [investingMonths, setInvestingMonths] = useState(0);

  // Versements vers un placement (virement d'un compte non placé vers un compte
  // de placement ou une assurance-vie) sur les 3 derniers mois.
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const from = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 1)).toISOString().slice(0, 10);
    const invest = new Set(accounts.filter((a) => !a.professional && accountFeatures(a.type).holdings).map((a) => a.id));
    http<Transaction[]>(`/users/${userId}/transactions?type=transfer&from=${from}`)
      .then((txs) => {
        if (cancelled) return;
        const months = new Set(txs
          .filter((tx) => tx.to_account_id != null && invest.has(tx.to_account_id) && !invest.has(tx.account_id ?? -1))
          .map((tx) => tx.date.slice(0, 7)));
        setInvestingMonths(months.size);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId, accounts, summary]);

  const roadmap = useMemo(() => {
    if (!pyramid || !valuation) return null;
    const uncategorized = (summary?.expenses_by_category ?? []).find((c) => c.category_id == null)?.amount ?? 0;
    const expenses = summary?.expenses ?? 0;
    return buildRoadmap({
      accounts: accounts.map((a) => ({
        type: a.type,
        professional: a.professional,
        archived: a.archived,
        positions: valuation.holdings.filter((h) => h.account_id === a.id && h.quantity > 0).map((h) => ({ name: h.name, asset_class: h.asset_class })),
      })),
      emergencyMonths: pyramid.emergencyMonths,
      uncategorizedShare: expenses > 0 ? uncategorized / expenses : null,
      investingMonths,
    });
  }, [accounts, pyramid, valuation, summary, investingMonths]);

  const fmtParams = (p?: Record<string, string | number>) => Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, typeof v === 'number' ? v.toLocaleString(localeTag()) : v]));
  if (!roadmap) return null;
  const next = roadmap.steps.find((s) => s.id === roadmap.next);
  const pct = roadmap.total > 0 ? Math.round((roadmap.done / roadmap.total) * 100) : 0;

  return (
    <section className="pg-card rm">
      <button type="button" className="rm-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div>
          <h2>{t('accueil.roadmap.title')}</h2>
          <span className="acc-muted">{t('accueil.roadmap.progress', { done: roadmap.done, total: roadmap.total })}</span>
        </div>
        <div className="rm-bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
        <ChevronDown size={18} className={open ? 'rm-chevron open' : 'rm-chevron'} aria-hidden />
      </button>
      {next && (
        <div className="rm-next">
          <span className="rm-next-label">{t('accueil.roadmap.next_step')}</span>
          <strong>{t(STEP_TEXT[next.id].title)}</strong>
          <p className="acc-muted">{t(STEP_TEXT[next.id].hint, fmtParams(next.params))}</p>
          <Link className="rm-next-link" to={next.link}>{t(STEP_TEXT[next.id].action)} <ArrowRight size={14} /></Link>
        </div>
      )}
      {!next && <p className="rm-all-done">{t('accueil.roadmap.all_done')}</p>}
      {open && (
        <ol className="rm-steps">
          {roadmap.steps.map((s) => (
            <li key={s.id} className={`rm-step ${s.status}${s.id === roadmap.next ? ' current' : ''}`}>
              {s.status === 'done' ? <Check size={16} /> : s.status === 'partial' ? <CircleDot size={16} /> : s.status === 'optional' ? <CircleDashed size={16} /> : <Circle size={16} />}
              <div>
                <Link to={s.link}>{t(STEP_TEXT[s.id].title)}</Link>
                {s.status === 'optional' && <small className="acc-muted"> · {t('accueil.roadmap.optional')}</small>}
                <p className="acc-muted">{t(STEP_TEXT[s.id].hint, fmtParams(s.params))}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
