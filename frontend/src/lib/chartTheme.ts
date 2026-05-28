import { useEffect, useState } from 'react';

export interface ChartTheme {
  grid: string;
  axis: string;
  total: string;
  income: string;
  expense: string;
  net: string;
  netFill: string;
}

const LIGHT: ChartTheme = {
  grid: '#e8edf5',
  axis: '#657184',
  total: '#111827',
  income: '#15803d',
  expense: '#dc2626',
  net: '#2563eb',
  netFill: '#dbeafe',
};

const DARK: ChartTheme = {
  grid: 'rgba(255, 255, 255, 0.08)',
  axis: '#8893a8',
  total: '#e5e9f2',
  income: '#4ade80',
  expense: '#f87171',
  net: '#60a5fa',
  netFill: 'rgba(96, 165, 250, 0.22)',
};

const CREAM: ChartTheme = {
  grid: 'rgba(120, 111, 91, 0.18)',
  axis: '#786f5b',
  total: '#2c2a24',
  income: '#4f7a3c',
  expense: '#b94a3d',
  net: '#c87f4a',
  netFill: 'rgba(200, 127, 74, 0.22)',
};

function read(): ChartTheme {
  if (typeof document === 'undefined') return LIGHT;
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return DARK;
  if (theme === 'cream') return CREAM;
  return LIGHT;
}

// Re-reads palette whenever the [data-theme] attribute on <html> changes.
export function useChartTheme(): ChartTheme {
  const [palette, setPalette] = useState<ChartTheme>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return palette;
}
