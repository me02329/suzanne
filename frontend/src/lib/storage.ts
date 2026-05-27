import { useEffect, useState } from 'react';

const PREFIX = 'suzanne_';

// Persists a piece of state to localStorage under a namespaced key. JSON-safe
// values only; serialization failures fall back to the default silently.
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
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
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Quota full / privacy mode: silently ignore.
    }
  }, [storageKey, value]);

  return [value, setValue];
}
