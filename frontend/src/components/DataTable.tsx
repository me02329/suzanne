import type { ReactNode } from 'react';

// `scroll` borne la hauteur du tableau (en-tête collant, défilement à la
// molette) — à utiliser pour les listes qui peuvent devenir très longues.
export function DataTable({ children, empty, scroll = false }: {
  children: ReactNode;
  empty: string | null;
  scroll?: boolean;
}) {
  if (empty) return <p className="empty">{empty}</p>;
  return (
    <div className={scroll ? 'table-wrap table-scroll' : 'table-wrap'}>
      <table className="tx-table">{children}</table>
    </div>
  );
}
