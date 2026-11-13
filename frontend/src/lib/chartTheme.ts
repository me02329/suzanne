import { useEffect, useState, type CSSProperties } from 'react';

// Palette des graphiques, dérivée des tokens CSS du thème « carnet de comptes »
// (theme.css) : les graphiques suivent automatiquement papier/encre et le mode
// sombre. Le surligneur (--accent-fill) n'est jamais utilisé ici : il reste
// réservé à l'élément actif et à l'action principale.
export interface ChartTheme {
  grid: string;
  axis: string;
  total: string;
  income: string;
  expense: string;
  net: string;
  netFill: string;
  /** Palette catégorielle : encre, olive, terre cuite, bleu ardoise, ocre, prune… */
  series: string[];
  /** Styles du tooltip Recharts, alignés sur les surfaces flottantes. */
  tooltip: {
    contentStyle: CSSProperties;
    labelStyle: CSSProperties;
    itemStyle: CSSProperties;
    cursor: { fill: string };
  };
  /** Police des graduations (mono tabulaire). */
  tick: { fill: string; fontSize: number; fontFamily: string };
}

const SERIES_LIGHT = ['#2f2c25', '#6b7a2e', '#b5603a', '#4f6d8f', '#c0922a', '#7d4e6e', '#8c9a7e', '#a8987a'];
const SERIES_DARK = ['#e3ddcd', '#aab86c', '#e08d66', '#8eaacb', '#e2b955', '#bb8bab', '#a5b39a', '#c2b597'];

const FALLBACK_LIGHT = {
  border: '#e0d9c8', muted: '#6d6758', text: '#17150f', income: '#1d7a4c', expense: '#c0422c',
  surface: '#fbfaf5', borderStrong: '#cbc2ad', num: 'ui-monospace, monospace', muted2: '#f0ece1',
};

function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.dataset.theme;
  if (attr === 'dark') return true;
  if (attr === 'light' || attr === 'cream') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

function read(): ChartTheme {
  const dark = isDark();
  let v = (_name: string, fallback: string) => fallback;
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const styles = getComputedStyle(document.documentElement);
    v = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  }
  const f = FALLBACK_LIGHT;
  const text = v('--text', f.text);
  const muted = v('--muted', f.muted);
  const net = dark ? SERIES_DARK[3]! : SERIES_LIGHT[3]!;
  const surface = v('--surface-raised', f.surface);
  return {
    grid: v('--border', f.border),
    axis: muted,
    total: text,
    income: v('--income', f.income),
    expense: v('--expense', f.expense),
    net,
    netFill: dark ? 'rgba(142, 170, 203, 0.2)' : 'rgba(79, 109, 143, 0.16)',
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    tooltip: {
      contentStyle: {
        background: surface,
        border: `1px solid ${v('--border-strong', f.borderStrong)}`,
        borderRadius: 10,
        boxShadow: '0 10px 24px -14px rgba(40, 32, 12, 0.4)',
        fontSize: 12.5,
        color: text,
        padding: '8px 10px',
      },
      labelStyle: { color: muted, fontWeight: 650, marginBottom: 2 },
      itemStyle: { color: text, fontFamily: v('--num-font', f.num), padding: 0 },
      cursor: { fill: v('--surface-muted', f.muted2) },
    },
    tick: { fill: muted, fontSize: 11.5, fontFamily: v('--num-font', f.num) },
  };
}

/** Couleur de la i-ème série catégorielle (cyclique). */
export function seriesColor(theme: ChartTheme, index: number): string {
  return theme.series[index % theme.series.length]!;
}

// Relit la palette quand [data-theme] change ou que le thème système bascule.
export function useChartTheme(): ChartTheme {
  const [palette, setPalette] = useState<ChartTheme>(read);
  useEffect(() => {
    const update = () => setPalette(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update);
    // Les feuilles de style peuvent finir de charger après le premier rendu.
    const raf = window.requestAnimationFrame(update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
      window.cancelAnimationFrame(raf);
    };
  }, []);
  return palette;
}

/** Vrai sous le point de rupture mobile (≤ 640px) ; suit le redimensionnement. */
export function useIsNarrow(query = '(max-width: 640px)'): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return narrow;
}
