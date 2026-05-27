import type { ReactNode } from 'react';

// Bold visual divider that introduces a logical block on the dashboard,
// so users immediately see whether the figures below them are "always
// current" (global) or scoped to the selected month.
export function DashboardSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="dashboard-section">
      <header className="dashboard-section-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </header>
      {children}
    </div>
  );
}
