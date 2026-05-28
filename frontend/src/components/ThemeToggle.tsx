import { useEffect } from 'react';
import { Moon, Palette, Sun } from 'lucide-react';
import { usePersistedState } from '../lib/storage';

export type Theme = 'light' | 'dark' | 'cream';

const ORDER: Theme[] = ['light', 'dark', 'cream'];

function detectInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = usePersistedState<Theme>('theme', detectInitial());
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, setTheme] as const;
}

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const cycle = () => {
    const idx = ORDER.indexOf(theme);
    onChange(ORDER[(idx + 1) % ORDER.length]!);
  };
  const Icon = theme === 'dark' ? Moon : theme === 'cream' ? Palette : Sun;
  const labels: Record<Theme, string> = { light: 'Clair', dark: 'Sombre', cream: 'Crème' };
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Thème : ${labels[theme]} (cliquer pour changer)`}
      title={`Thème : ${labels[theme]}`}
    >
      <Icon size={16} />
      <span className="theme-toggle-label">{labels[theme]}</span>
    </button>
  );
}
