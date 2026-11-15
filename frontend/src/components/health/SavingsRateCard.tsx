import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Lightbulb } from 'lucide-react';
import {
  accountFeatures, FRENCH_AVERAGE_SAVINGS_RATE, monthlySavingsRates, payYourselfFirst,
  type Account, type DashboardSummary, type Transaction,
} from '@suzanne/shared';
import { http } from '../../lib/api';
import { formatMonth, money as moneyFmt } from '../../lib/format';
import { localeTag } from '../../i18n';
import { useChartTheme } from '../../lib/chartTheme';
import '../../styles/components/savings-rate.css';

// Santé : taux d'épargne mois par mois (repère : moyenne française ≈ 14 %) et
// « se payer en premier » — un versement vers l'épargne juste après la paie.
export function SavingsRateCard({ userId, summary, accounts, currency }: {
  userId: number;
  summary: DashboardSummary | null;
  accounts: Account[];
  currency: string;
}) {
  const { t } = useTranslation();
  const chartTheme = useChartTheme();
  const money = (v: number) => moneyFmt(v, currency);
  const [pyf, setPyf] = useState<ReturnType<typeof payYourselfFirst> | null>(null);

  const rates = useMemo(() => monthlySavingsRates(summary?.monthly_cashflow ?? []).map((m) => ({
    ...m,
    pct: m.rate == null ? null : Math.round(m.rate * 1000) / 10,
    // Barre plafonnée à ±100 % : un mois sans revenu ou presque écraserait le graphique.
    bar: m.rate == null ? null : Math.max(-100, Math.min(100, Math.round(m.rate * 1000) / 10)),
    label: formatMonth(m.month),
  })), [summary]);
  // Taux sur l'ensemble des 12 mois (cumul), plus parlant qu'une moyenne de pourcentages.
  const average = useMemo(() => {
    const rows = summary?.monthly_cashflow ?? [];
    const income = rows.reduce((s, m) => s + m.income, 0);
    const expenses = rows.reduce((s, m) => s + m.expenses, 0);
    return income > 0 ? ((income - expenses) / income) * 100 : null;
  }, [summary]);
  const avgIncome = useMemo(() => {
    const rows = (summary?.monthly_cashflow ?? []).filter((m) => m.income > 0);
    return rows.length > 0 ? rows.reduce((s, m) => s + m.income, 0) / rows.length : 0;
  }, [summary]);

  // Les 3 derniers mois complets : virements vers l'épargne et revenus.
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const months = [3, 2, 1].map((k) => new Date(Date.UTC(now.getFullYear(), now.getMonth() - k, 1)).toISOString().slice(0, 7));
    const from = `${months[0]}-01`;
    const to = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0)).toISOString().slice(0, 10);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const saving = (id: number | null | undefined) => {
      const a = id != null ? byId.get(id) : undefined;
      if (!a || a.professional) return false;
      const f = accountFeatures(a.type);
      return f.interest || f.holdings;
    };
    Promise.all([
      http<Transaction[]>(`/users/${userId}/transactions?type=transfer&from=${from}&to=${to}`),
      http<Transaction[]>(`/users/${userId}/transactions?type=income&from=${from}&to=${to}`),
    ]).then(([transfers, incomes]) => {
      if (cancelled) return;
      setPyf(payYourselfFirst(
        months,
        transfers.filter((tx) => saving(tx.to_account_id) && !saving(tx.account_id)).map((tx) => ({ date: tx.date.slice(0, 10), amount: tx.amount, to: byId.get(tx.to_account_id!)?.name ?? '' })),
        incomes.filter((tx) => !byId.get(tx.account_id ?? -1)?.professional).map((tx) => ({ date: tx.date.slice(0, 10), amount: tx.amount })),
      ));
    }).catch(() => { if (!cancelled) setPyf(null); });
    return () => { cancelled = true; };
  }, [userId, accounts, summary]);

  return (
    <div className="pg-card sr">
      <div className="pg-card-head">
        <h2>{t('analyses.savings.title')}</h2>
        {average != null && <span className="acc-muted">{t('analyses.savings.average', { pct: average.toLocaleString(localeTag(), { maximumFractionDigits: 1 }), ref: Math.round(FRENCH_AVERAGE_SAVINGS_RATE * 100) })}</span>}
      </div>
      <div className="sr-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rates} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fill: chartTheme.axis, fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={[-100, 100]} tickFormatter={(v: number) => `${v} %`} tick={{ fill: chartTheme.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              formatter={(_v, _n, item) => [`${(item.payload as { pct: number | null }).pct ?? '—'} %`, t('analyses.savings.rate')]}
              contentStyle={chartTheme.tooltip.contentStyle}
              labelStyle={chartTheme.tooltip.labelStyle}
              itemStyle={chartTheme.tooltip.itemStyle}
              cursor={{ fill: 'transparent' }}
            />
            <ReferenceLine y={FRENCH_AVERAGE_SAVINGS_RATE * 100} stroke={chartTheme.axis} strokeDasharray="4 4" label={{ value: t('analyses.savings.french_average'), position: 'insideTopRight', fill: chartTheme.axis, fontSize: 11 }} />
            <ReferenceLine y={0} stroke={chartTheme.axis} />
            <Bar dataKey="bar" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rates.map((r) => <Cell key={r.month} fill={(r.pct ?? 0) >= FRENCH_AVERAGE_SAVINGS_RATE * 100 ? chartTheme.income : (r.pct ?? 0) >= 0 ? chartTheme.total : chartTheme.expense} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {pyf && (pyf.count >= 2 ? (
        <p className="sr-pyf ok">
          <CheckCircle2 size={17} />
          <span>{t('analyses.savings.pyf_yes', { count: pyf.count, amount: money(pyf.typicalAmount ?? 0), to: pyf.destination ?? '' })}</span>
        </p>
      ) : (
        <p className="sr-pyf">
          <Lightbulb size={17} />
          <span>
            {t('analyses.savings.pyf_no', { count: pyf.count, amount: money(Math.round(avgIncome * 0.1 / 10) * 10) })}{' '}
            <Link to="/recurring">{t('analyses.savings.pyf_action')}</Link>
          </span>
        </p>
      ))}
    </div>
  );
}
