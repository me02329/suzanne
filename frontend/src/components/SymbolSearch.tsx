import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search } from 'lucide-react';
import { http } from '../lib/api';

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

export interface SymbolQuote {
  symbol: string;
  name: string | null;
  currency: string | null;
  price: number | null;
  exchange: string | null;
  type: string | null;
}

// Classe d'actif déduite du type Yahoo.
export function assetClassFromYahoo(type: string | null | undefined): 'etf' | 'equity' | 'fund' | 'crypto' | 'commodity' | 'other' {
  const t = (type ?? '').toUpperCase();
  if (t.includes('ETF')) return 'etf';
  if (t.includes('EQUITY') || t.includes('ACTION')) return 'equity';
  if (t.includes('FUND') || t.includes('FONDS')) return 'fund';
  if (t.includes('CRYPTO')) return 'crypto';
  if (t.includes('FUTURE') || t.includes('COMMOD')) return 'commodity';
  return 'other';
}

// Titres courants proposés avant toute saisie (PEA : ETF éligibles).
const POPULAR: Record<'pea' | 'other', SymbolHit[]> = {
  pea: [
    { symbol: 'CW8.PA', name: 'Amundi MSCI World Swap (PEA)', exchange: 'Paris', type: 'ETF' },
    { symbol: 'DCAM.PA', name: 'Amundi PEA Monde (MSCI World)', exchange: 'Paris', type: 'ETF' },
    { symbol: 'WPEA.PA', name: 'iShares MSCI World Swap PEA', exchange: 'Paris', type: 'ETF' },
    { symbol: 'PSP5.PA', name: 'Amundi PEA S&P 500', exchange: 'Paris', type: 'ETF' },
    { symbol: 'ESE.PA', name: 'BNP Paribas Easy S&P 500', exchange: 'Paris', type: 'ETF' },
    { symbol: 'PUST.PA', name: 'Amundi PEA Nasdaq-100', exchange: 'Paris', type: 'ETF' },
    { symbol: 'PAEEM.PA', name: 'Amundi PEA Émergent (MSCI Emerging)', exchange: 'Paris', type: 'ETF' },
  ],
  other: [
    { symbol: 'IWDA.AS', name: 'iShares Core MSCI World', exchange: 'Amsterdam', type: 'ETF' },
    { symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World Acc', exchange: 'XETRA', type: 'ETF' },
    { symbol: 'CSPX.L', name: 'iShares Core S&P 500 Acc', exchange: 'Londres', type: 'ETF' },
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'Action' },
    { symbol: 'BTC-EUR', name: 'Bitcoin (EUR)', exchange: 'CCC', type: 'Crypto' },
    { symbol: 'ETH-EUR', name: 'Ethereum (EUR)', exchange: 'CCC', type: 'Crypto' },
  ],
};

// Champ « symbole » avec autocomplétion Yahoo Finance : on tape un nom, un
// ticker ou un ISIN, les titres trouvés s'affichent au fil de la frappe ; le
// choix remplit nom, devise et classe (via `onPick`).
export function SymbolSearch({ value, onChange, onPick, pea = false }: {
  value: string;
  onChange: (symbol: string) => void;
  onPick: (hit: SymbolHit, quote: SymbolQuote | null) => void;
  pea?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const q = value.trim();
    if (!touched || q.length < 2) { setHits(POPULAR[pea ? 'pea' : 'other']); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      http<SymbolHit[]>(`/prices/search?q=${encodeURIComponent(q)}`)
        .then((rows) => { if (!cancelled) { setHits(rows); setError(null); setActive(0); } })
        .catch((e) => { if (!cancelled) { setHits([]); setError((e as Error).message); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value, open, touched, pea]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = async (hit: SymbolHit) => {
    setOpen(false);
    onChange(hit.symbol);
    let quote: SymbolQuote | null = null;
    try { quote = await http<SymbolQuote>(`/prices/${encodeURIComponent(hit.symbol)}/quote`); } catch { /* devise à saisir */ }
    onPick(hit, quote);
  };

  return (
    <div className="sym-search" ref={ref}>
      <div className="sym-input">
        <Search size={16} aria-hidden="true" />
        <input
          name="symbol"
          value={value}
          onChange={(e) => { onChange(e.target.value); setTouched(true); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || hits.length === 0) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
            if (e.key === 'Enter') { e.preventDefault(); void pick(hits[active]!); }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={t('patrimoine.symbol.placeholder')}
          required
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading && <Loader2 className="spin-icon" size={16} aria-hidden="true" />}
      </div>
      {open && (
        <div className="sym-pop" role="listbox">
          {(!touched || value.trim().length < 2) && <div className="sym-head">{pea ? t('patrimoine.symbol.popular_pea') : t('patrimoine.symbol.popular')}</div>}
          {error && <p className="sym-empty">{error}</p>}
          {!error && !loading && hits.length === 0 && <p className="sym-empty">{t('patrimoine.symbol.none_found')}</p>}
          {hits.map((h, i) => (
            <button
              key={h.symbol}
              type="button"
              role="option"
              aria-selected={i === active}
              className={i === active ? 'sym-hit on' : 'sym-hit'}
              onMouseEnter={() => setActive(i)}
              onClick={() => void pick(h)}
            >
              <strong>{h.symbol}</strong>
              <span>{h.name}</span>
              <small>{[h.type, h.exchange].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
