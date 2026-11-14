import { useSyncExternalStore } from 'react';

// Préférences d'affichage partagées entre composants (localStorage + abonnés :
// un changement dans Réglages s'applique partout sans recharger).
const KEY = 'suzanne_hint_delay';
// Délai d'apparition des infobulles de catégorie, en millisecondes ; -1 = jamais.
const DEFAULT_DELAY = 2000;

const listeners = new Set<() => void>();

function read(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_DELAY;
    const value = Number(raw);
    return Number.isFinite(value) ? value : DEFAULT_DELAY;
  } catch {
    return DEFAULT_DELAY;
  }
}

export function setHintDelay(ms: number) {
  try { window.localStorage.setItem(KEY, String(ms)); } catch { /* stockage indisponible */ }
  listeners.forEach((l) => l());
}

export function useHintDelay(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read,
    () => DEFAULT_DELAY,
  );
}

export const HINT_DELAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: -1, label: 'Jamais' },
  { value: 300, label: 'Immédiat' },
  { value: 1000, label: '1 seconde' },
  { value: 2000, label: '2 secondes' },
  { value: 3000, label: '3 secondes' },
];
