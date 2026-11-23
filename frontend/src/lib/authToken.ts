// Gestion du token d'accès optionnel (cf. backend APP_TOKEN).
// Le token est stocké en localStorage et envoyé sur toutes les requêtes API.
// Si le backend n'exige pas de token, tout ça reste invisible.

import { nativeBridge } from '../local/nativeHttp';

// Dans l'app Android, la page est toujours https://suzanne.local : le jeton est
// rangé sous l'adresse du serveur, pour ne pas le servir à un autre serveur.
const STORAGE_KEY = (() => {
  const server = typeof window === 'undefined' ? '' : nativeBridge()?.serverUrl() ?? '';
  return server ? `suzanne_app_token:${server.replace(/\/+$/, '')}` : 'suzanne_app_token';
})();

let cached: string | null = readToken();
let unauthorizedHandler: (() => void) | null = null;

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAppToken(): string | null {
  return cached;
}

export function setAppToken(token: string | null): void {
  cached = token && token.trim() ? token.trim() : null;
  try {
    if (cached) window.localStorage.setItem(STORAGE_KEY, cached);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // privacy mode / quota : on garde au moins la valeur en mémoire.
  }
}

/** En-têtes d'auth à fusionner dans chaque requête (vide si pas de token). */
export function authHeaders(): Record<string, string> {
  return cached ? { Authorization: `Bearer ${cached}` } : {};
}

/** Enregistre le callback déclenché sur un 401 (ouvre le modal de saisie). */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
