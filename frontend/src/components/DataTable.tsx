import type { ReactNode } from 'react';

// Tableau de base. ≤ 640px chaque ligne devient une carte : chaque cellule
// affiche son en-tête via `data-label` (à renseigner sur les <td>). Cellules
// spéciales : `.cell-primary` (titre de la carte, pleine largeur),
// `.amount-cell` (montant mis en avant), `.actions-cell` (actions en pied).
// `scroll` borne la hauteur (en-tête collant) pour les listes très longues.
// `cards={false}` garde le tableau (défilement horizontal) même sur mobile.
export function DataTable({ children, empty, scroll = false, cards = true, className }: {
  children: ReactNode;
  empty: string | null;
  scroll?: boolean;
  cards?: boolean;
  className?: string;
}) {
  if (empty) return <p className="empty">{empty}</p>;
  const wrap = ['table-wrap', scroll ? 'table-scroll' : '', cards ? '' : 'table-nocards'].filter(Boolean).join(' ');
  return (
    <div className={wrap}>
      <table className={className ? `tx-table ${className}` : 'tx-table'}>{children}</table>
    </div>
  );
}
