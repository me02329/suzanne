import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface StatProps {
  icon?: ReactNode;
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
  // « hero » : le chiffre principal de la page (grand, mono 32–44px) ;
  // « secondary » : chiffre d'appoint, compact, sans icône mise en avant.
  variant?: 'default' | 'hero' | 'secondary';
  className?: string;
}

export function Stat({ icon, label, value, positive, negative, signed, delta, to, variant = 'default', className }: StatProps) {
  let tone: 'income' | 'expense' | '' = positive ? 'income' : negative ? 'expense' : '';
  if (signed !== undefined && signed !== null) {
    tone = signed > 0 ? 'income' : signed < 0 ? 'expense' : '';
  }
  const classes = ['stat', variant !== 'default' ? `stat-${variant}` : '', to ? 'stat-link' : '', className ?? ''].filter(Boolean).join(' ');
  const content = (
    <>
      {icon && <div className="stat-icon" aria-hidden="true">{icon}</div>}
      <span className="stat-label">{label}</span>
      <strong className={tone ? `stat-value ${tone}` : 'stat-value'}>{value}</strong>
      {delta != null && <small className="stat-delta">{delta}</small>}
    </>
  );
  if (to) return <Link className={classes} to={to}>{content}</Link>;
  return <div className={classes}>{content}</div>;
}
