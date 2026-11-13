import type { SearchResult } from '@suzanne/shared';
import { http } from './api';

// Recherche globale annulable : la SearchBox passe un AbortSignal pour
// abandonner la requête précédente dès que la saisie change.
export function searchAnnulable(userId: number, q: string, signal: AbortSignal): Promise<SearchResult[]> {
  return http<SearchResult[]>(`/users/${userId}/search?q=${encodeURIComponent(q)}`, { signal });
}
