// Point d'entrée de l'app embarquée (ADR 0011, 0012). Build normal (serveur,
// navigateur) : un seul côté, le serveur qui sert la page. Build « app »
// (vite.local.config.ts) : ce module est remplacé par ./bootstrap.ts, qui sait
// parler au serveur (pont natif) et au serveur embarqué du téléphone.
import { authHeaders } from '../lib/authToken';
import { writeActiveProfile, type Backend } from '../lib/activeProfile';

/** Interface embarquée dans l'app Android ? (constante de build) */
export const IS_APP = false;

export async function startLocal(): Promise<void> {
  /* navigateur : l'API est sur le réseau */
}

/** Côté du profil actif. */
export function activeBackend(): Backend {
  return 'server';
}

/** Côtés disponibles sur cet appareil. */
export function availableBackends(): Backend[] {
  return ['server'];
}

/** Appel à l'API d'un côté donné, quel que soit le côté actif. */
export function fetchFrom(_backend: Backend, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) } });
}

/** Ouvre un profil ; changer de côté recharge l'app. */
export function switchProfile(backend: Backend, userId: number): void {
  writeActiveProfile({ backend, userId });
  if (backend !== activeBackend()) window.location.reload();
}

export function serverConfigured(): boolean {
  return true;
}
