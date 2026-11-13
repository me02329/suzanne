import { useEffect, useState } from 'react';

const PREFIX = 'suzanne_';

// Persists a piece of state to localStorage under a namespaced key. JSON-safe
// values only; serialization failures fall back to the default silently.
// `options.pause` : n'écrit pas tant qu'il est vrai (ex. pendant le streaming de
// l'assistant, pour ne pas sérialiser la conversation à chaque mot) ; l'écriture
// a lieu dès qu'il repasse à faux.
export function usePersistedState<T>(key: string, defaultValue: T, options?: { pause?: boolean }): [T, (value: T | ((prev: T) => T)) => void] {
  const paused = options?.pause ?? false;
  const storageKey = `${PREFIX}${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (paused) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Quota full / privacy mode: silently ignore.
    }
  }, [storageKey, value, paused]);

  return [value, setValue];
}
