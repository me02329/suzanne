import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface StatProps {
  icon: ReactNode;
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  // When set, the stat is colored automatically based on the raw numeric value:
  // > 0 -> positive, < 0 -> negative, 0/undefined -> neutral. Wins over the
  // explicit booleans so callers can simply forward summary.net_worth etc.
  signed?: number | null;
  // Optional secondary line under the value (e.g. month-over-month variation).
  delta?: ReactNode;
  // Page de détail de l'indicateur : la carte entière devient un lien.
  to?: string;
}

export function Stat({ icon, label, value, positive, negative, signed, delta, to }: StatProps) {
  let tone: 'income' | 'expense' | '' = positive ? 'income' : negative ? 'expense' : '';
  if (signed !== undefined && signed !== null) {
    tone = signed > 0 ? 'income' : signed < 0 ? 'expense' : '';
  }
  const content = (
    <>
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {delta != null && <small className="stat-delta">{delta}</small>}
    </>
  );
  if (to) return <Link className="stat stat-link" to={to}>{content}</Link>;
  return <div className="stat">{content}</div>;
}
