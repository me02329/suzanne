import { useSyncExternalStore } from 'react';
import { navSections } from './nav';

// Barre du bas (téléphone) : quelles grandes pages y figurent, et dans quel
// ordre — les autres sont dans « Plus ». Réglage propre à l'appareil
// (localStorage), appliqué partout sans recharger (abonnés). Le glissement en
// bas de l'écran suit le même ordre, puis ouvre « Plus ».
const KEY = 'suzanne_tabbar';
export const TABBAR_MIN = 2;
export const TABBAR_MAX = 4;
export const TABBAR_DEFAULT: readonly string[] = ['home', 'ops', 'accounts'];

const known = new Set(navSections.map((s) => s.id));
const listeners = new Set<() => void>();

/** Réglage valide : pages connues, sans doublon, entre 2 et 4 — sinon la barre par défaut. */
export function sanitizeTabbar(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [...TABBAR_DEFAULT];
  const clean = ids.filter((id, i): id is string => typeof id === 'string' && known.has(id) && ids.indexOf(id) === i);
  return clean.length >= TABBAR_MIN && clean.length <= TABBAR_MAX ? clean : [...TABBAR_DEFAULT];
}

let cache: { raw: string | null; value: string[] } = { raw: '\u0000', value: [...TABBAR_DEFAULT] };
function read(): string[] {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(KEY); } catch { /* stockage indisponible */ }
  // useSyncExternalStore exige une valeur stable tant que rien ne change.
  if (raw !== cache.raw) {
    let parsed: unknown = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { /* valeur illisible : défaut */ }
    cache = { raw, value: raw ? sanitizeTabbar(parsed) : [...TABBAR_DEFAULT] };
  }
  return cache.value;
}

export function setTabbar(ids: string[] | null) {
  try {
    if (ids === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(sanitizeTabbar(ids)));
  } catch { /* stockage indisponible */ }
  listeners.forEach((l) => l());
}

export function useTabbar(): string[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read,
    () => [...TABBAR_DEFAULT],
  );
}

/** Position du bouton « + » : au milieu des éléments (pages + « Plus »). */
export function addButtonIndex(barLength: number): number {
  return Math.ceil((barLength + 1) / 2);
}
