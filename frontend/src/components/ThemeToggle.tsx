import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { usePersistedState } from '../lib/storage';

// Deux thèmes : clair (papier) et sombre (encre). L'ancien thème « crème »
// encore stocké chez certains est lu comme « clair ». index.html applique le
// thème stocké avant le premier rendu pour éviter un flash.
export type Theme = 'light' | 'dark';

function detectInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [stored, setTheme] = usePersistedState<Theme>('theme', detectInitial());
  const theme: Theme = stored === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    if (stored !== theme) setTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [stored, theme, setTheme]);
  return [theme, setTheme] as const;
}

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Moon : Sun;
  const labels: Record<Theme, string> = { light: 'Clair', dark: 'Sombre' };
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label={`Thème : ${labels[theme]} (passer en ${labels[next].toLowerCase()})`}
      title={`Thème : ${labels[theme]}`}
    >
      <Icon size={16} />
      <span className="theme-toggle-label">{labels[theme]}</span>
    </button>
  );
}
