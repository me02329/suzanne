// Profil actif, mémorisé sur l'appareil (ADR 0012). Dans l'app Android, un
// profil vit soit sur le serveur, soit sur le téléphone : on retient les deux.
// Dans un navigateur, seul le côté « serveur » existe.

export type Backend = 'server' | 'phone';

export interface ActiveProfile {
  backend: Backend;
  userId: number | null;
}

const KEY = 'suzanne_active_profile';

export function readActiveProfile(): ActiveProfile | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveProfile>;
    if (parsed.backend !== 'server' && parsed.backend !== 'phone') return null;
    return { backend: parsed.backend, userId: typeof parsed.userId === 'number' ? parsed.userId : null };
  } catch {
    return null;
  }
}

export function writeActiveProfile(profile: ActiveProfile): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* stockage indisponible : la session continue */ }
}
