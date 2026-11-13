import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Transaction } from '@suzanne/shared';
import { isReadOnly } from './txUtils';

// Sélection multiple du journal. Remise à zéro dès que `resetKey` change
// (mois, filtres, recherche) : on n'agit jamais sur des lignes invisibles.
export function useSelection(source: Transaction[], resetKey: string) {
  const [ids, setIds] = useState<Set<number>>(() => new Set());

  useEffect(() => { setIds(new Set()); }, [resetKey]);

  const selected = useMemo(() => source.filter((t) => ids.has(t.id) && !isReadOnly(t)), [source, ids]);

  const toggle = useCallback((id: number, on: boolean) => {
    setIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const setMany = useCallback((rows: Transaction[], on: boolean) => {
    setIds((current) => {
      const next = new Set(current);
      for (const t of rows) {
        if (isReadOnly(t)) continue;
        if (on) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setIds(new Set()), []);

  return { ids, selected, count: selected.length, toggle, setMany, clear };
}

export type SelectionState = ReturnType<typeof useSelection>;
