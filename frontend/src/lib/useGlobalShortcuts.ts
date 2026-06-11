import { useEffect, useRef } from 'react';
import type { Tab } from './nav';

export interface ShortcutHandlers {
  goto: (tab: Tab) => void;
  prevMonth: () => void;
  nextMonth: () => void;
  focusSearch: () => void;
  showHelp: () => void;
}

// Chords "g <lettre>" façon Gmail pour naviguer entre les pages.
const GOTO_KEYS: Partial<Record<string, Tab>> = {
  d: 'dashboard',
  w: 'wealth',
  t: 'transactions',
  s: 'statistics',
  a: 'accounts',
  b: 'budgets',
  c: 'categories',
  g: 'goals',
};

// Raccourcis clavier globaux. Ignorés quand le focus est dans un champ de
// saisie pour ne pas casser la frappe ni les raccourcis natifs des inputs.
export function useGlobalShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let pendingG = false;
    let timer: number | undefined;
    const clearG = () => {
      pendingG = false;
      if (timer) { window.clearTimeout(timer); timer = undefined; }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      const h = ref.current;
      if (pendingG) {
        const tab = GOTO_KEYS[event.key.toLowerCase()];
        clearG();
        if (tab) { event.preventDefault(); h.goto(tab); }
        return;
      }

      switch (event.key) {
        case 'g':
          pendingG = true;
          timer = window.setTimeout(clearG, 1200);
          break;
        case '/':
          event.preventDefault();
          h.focusSearch();
          break;
        case '[':
          h.prevMonth();
          break;
        case ']':
          h.nextMonth();
          break;
        case '?':
          event.preventDefault();
          h.showHelp();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearG(); };
  }, []);
}
