import type { ReactNode } from 'react';

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
}

export function Stat({ icon, label, value, positive, negative, signed, delta }: StatProps) {
  let tone: 'income' | 'expense' | '' = positive ? 'income' : negative ? 'expense' : '';
  if (signed !== undefined && signed !== null) {
    tone = signed > 0 ? 'income' : signed < 0 ? 'expense' : '';
  }
  return (
    <div className="stat">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {delta != null && <small className="stat-delta">{delta}</small>}
    </div>
  );
}
