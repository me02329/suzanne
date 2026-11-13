import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ValuedHolding } from '@suzanne/shared';
import { seriesColor, useChartTheme } from '../../lib/chartTheme';
import { formatPct } from '../../lib/pea';
import '../../styles/pages/pea-insights.css';

// Poids de chaque ligne (et des espèces) dans l'enveloppe — njord CompositionChart.
export function CompositionChart({ positions, cash, fmt }: { positions: ValuedHolding[]; cash: number; fmt: (v: number) => string }) {
  const theme = useChartTheme();
  const slices = [
    ...positions.filter((p) => p.market_value > 0).map((p) => ({ key: p.symbol, label: p.name || p.symbol, value: p.market_value })),
    ...(cash > 0.005 ? [{ key: '__cash', label: 'Espèces', value: cash }] : []),
  ];
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (slices.length === 0 || total <= 0) return null;
  return (
    <div className="pi-compo">
      <div className="pi-compo-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="96%" paddingAngle={slices.length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>
              {slices.map((s, i) => <Cell key={s.key} fill={s.key === '__cash' ? theme.grid : seriesColor(theme, i)} />)}
            </Pie>
            <Tooltip {...theme.tooltip} formatter={(v) => fmt(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="pi-legend">
        {slices.map((s, i) => (
          <li key={s.key}>
            <i style={{ background: s.key === '__cash' ? theme.grid : seriesColor(theme, i) }} />
            <span className="pi-legend-label">{s.label}</span>
            <span className="num">{formatPct((s.value / total) * 100, false)}</span>
            <span className="num pi-muted">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
