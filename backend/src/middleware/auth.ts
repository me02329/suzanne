import type { RequestHandler } from 'express';

/**
 * Auth applicative légère par secret partagé.
 *
 * - Si la variable d'env `APP_TOKEN` n'est pas définie → middleware désactivé
 *   (comportement historique : aucune auth, 100% rétrocompatible).
 * - Si elle est définie → toute requête `/api/*` doit présenter
 *   `Authorization: Bearer <APP_TOKEN>`, sinon 401.
 *
 * Ce n'est pas du vrai user management : juste un secret partagé pour éviter
 * qu'une app exposée par erreur ne laisse fuiter les données (et la clé IA).
 */
export function appTokenAuth(): RequestHandler {
  const expected = process.env.APP_TOKEN?.trim();

  if (!expected) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const provided = match?.[1]?.trim();

    if (provided && timingSafeEqual(provided, expected)) {
      return next();
    }

    res.status(401).json({ error: 'Token d’accès invalide ou manquant' });
  };
}

/** Comparaison à temps constant pour éviter de fuiter le token via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
