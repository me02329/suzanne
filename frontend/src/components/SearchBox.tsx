import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { SearchResult } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { tabForSearchResult, type Tab } from '../lib/nav';

// Topbar search: debounced query, click + keyboard-navigable results.
// Clicking a result navigates to the corresponding tab via `onNavigate`.
export function SearchBox({ userId, onNavigate }: { userId: number; onNavigate: (tab: Tab) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const handle = window.setTimeout(() => {
      api.search(userId, query)
        .then((rows) => {
          setResults(rows);
          setHighlight(0);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, userId]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const selectResult = (result: SearchResult) => {
    onNavigate(tabForSearchResult(result.type));
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
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
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="search-box" ref={boxRef}>
      <Search size={16} />
      <input
        placeholder="Rechercher une opération"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
      />
      {open && results.length > 0 && (
        <div className="search-results" role="listbox">
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
