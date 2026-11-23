import { nativeBridge } from '../local/nativeHttp';

/**
 * Origine publique du serveur Suzanne (pour les adresses à donner à l'extérieur,
 * ex. le retour de la banque). Dans un navigateur : l'origine de la page. Dans
 * l'app Android, la page est servie par l'app (https://suzanne.local) : c'est
 * l'adresse du serveur configuré qui compte.
 */
export function serverOrigin(): string {
  const server = nativeBridge()?.serverUrl();
  if (server) {
    try { return new URL(server).origin; } catch { /* adresse invalide : repli */ }
  }
  return window.location.origin;
}
