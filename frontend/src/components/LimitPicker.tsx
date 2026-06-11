import { useState } from 'react';

// Limite d'affichage des tableaux qui grandissent sans borne (relevés,
// mouvements, versements…). `limit === 0` signifie « tout afficher » ;
// combiné au prop `scroll` de DataTable, le tableau reste contenu et
// défilable à la molette quelle que soit la limite choisie.
export function useListLimit(defaultLimit = 10) {
  const [limit, setLimit] = useState(defaultLimit);
  function clamp<T>(items: T[]): T[] {
    return limit > 0 ? items.slice(0, limit) : items;
  }
  return { limit, setLimit, clamp };
}

export function LimitPicker({ limit, onChange, options = [10, 25, 50], total, allLabel = 'Tout' }: {
  limit: number;
  onChange: (value: number) => void;
  options?: number[];
  // Taille réelle de la liste quand elle est connue côté client : masque le
  // sélecteur si tout tient déjà, et affiche un compteur « affichées/total ».
  total?: number;
  // null = pas d'option « Tout » (ex. la limite est appliquée côté serveur).
  allLabel?: string | null;
}) {
  if (total !== undefined && total <= (options[0] ?? 10)) return null;
  const visibleOptions = options.filter((option) => total === undefined || option < total || option === limit);
  return (
    <div className="limit-picker" role="group" aria-label="Nombre de lignes affichées">
      {visibleOptions.map((option) => (
        <button
          key={option}
          type="button"
          className={limit === option ? 'active' : ''}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
      {allLabel !== null && (
        <button type="button" className={limit === 0 ? 'active' : ''} onClick={() => onChange(0)}>{allLabel}</button>
      )}
      {total !== undefined && (
        <span className="limit-count">{limit > 0 ? Math.min(limit, total) : total}/{total}</span>
      )}
    </div>
  );
}
