import type { ReactNode } from 'react';

export function DataTable({ children, empty }: { children: ReactNode; empty: string | null }) {
  if (empty) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="tx-table">{children}</table>
    </div>
  );
}
