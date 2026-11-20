import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import type { SearchResult } from '@suzanne/shared';
import { searchAnnulable } from '../lib/searchApi';
import { tabForSearchResult, type Tab } from '../lib/nav';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '../lib/useDismiss';

// Recherche de la barre du haut : saisie temporisée, résultats navigables au
// clavier. Chaque nouvelle frappe annule la requête précédente (une réponse
// lente ne peut plus écraser une plus récente) et un champ vidé ne rouvre
// jamais la liste. Une opération ouvre /transactions?tx=<id> ; les autres
// types passent par `onNavigate(tab)`.
export function SearchBox({ userId, onNavigate }: { userId: number; onNavigate: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      searchAnnulable(userId, q, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          setResults(rows);
          setHighlight(0);
          setOpen(true);
        })
        .catch(() => { if (!controller.signal.aborted) setResults([]); });
    }, 250);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [query, userId]);

  // Résultats sous le champ (ils défilent avec lui) : fermeture au clic /
  // toucher ailleurs ou à l'ouverture d'un autre menu ; Échap géré au clavier.
  useDismiss(open, () => setOpen(false), [boxRef], { closeOnScroll: false, escape: false });

  const clear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const selectResult = (result: SearchResult) => {
    clear();
    if (result.type === 'transaction') {
      // onNavigate ferme le panneau de recherche mobile côté App (et pousse
      // /transactions) ; on remplace aussitôt cette entrée par l'URL ciblée.
      onNavigate('transactions');
      navigate(`/transactions?tx=${result.id}`, { replace: true });
    } else {
      onNavigate(tabForSearchResult(result.type));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) setOpen(false);
      else if (query) clear();
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[highlight];
      if (target) selectResult(target);
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div className="search-box" ref={boxRef}>
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        enterKeyHint="search"
        placeholder={t('ui.search_box.search')}
        aria-label={t('ui.search_box.search_transaction_category_account')}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          if (next.trim().length < 2) { setResults([]); setOpen(false); }
        }}
        onKeyDown={onKeyDown}
        onFocus={() => { if (results.length > 0 && query.trim().length >= 2) setOpen(true); }}
      />
      {query && (
        <button type="button" className="search-clear" aria-label={t('ui.search_box.clear_search')} onClick={clear}>
          <X size={14} />
        </button>
      )}
      {showList && (
        <div className="search-results" role="listbox" id={listId}>
          {results.length === 0 && <p className="search-empty">{t('ui.search_box.no_results')}</p>}
          {results.map((r, idx) => (
            <button
              type="button"
              role="option"
              aria-selected={idx === highlight}
              className={idx === highlight ? 'search-result active' : 'search-result'}
              key={`${r.type}-${r.id}`}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => selectResult(r)}
            >
              <strong>{r.title}</strong>
              <span>{r.subtitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
