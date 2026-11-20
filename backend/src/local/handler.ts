import { LocalRequest, LocalResponse, Router, type LocalResult } from './expressShim.js';
import { apiRouter } from '../routes/index.js';
import { auditLog } from '../middleware/audit.js';
import { errorHandler } from '../middleware/errors.js';

// Mode local (ADR 0011) : le serveur Suzanne sans HTTP. Même chaîne que
// app.ts pour /api — journal d'audit, routes, 404, gestionnaire d'erreurs —
// sans ce qui n'a pas de sens sur l'appareil (compression, CORS, jeton d'accès,
// fichiers statiques). Appelé par l'interception de fetch (navigateur) ou par
// les tests (Node).
const app = Router();
app.use('/api', auditLog());
app.use('/api', apiRouter);
app.use('/api', (_req: unknown, res: LocalResponse) => res.status(404).json({ error: 'Not found' }));

export type { LocalResult };

/**
 * Traite une requête /api/… et renvoie la réponse dès que ses en-têtes sont
 * fixés (corps complet, ou flux pour une réponse écrite par morceaux).
 * `body` est déjà décodé (JSON) — comme après `express.json()`.
 */
export function handleLocal(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<LocalResult> {
  const req = new LocalRequest(method, url, body, headers);
  const res = new LocalResponse();
  app(req, res, (err?: unknown) => {
    if (res.writableEnded) return;
    if (err !== undefined) errorHandler(err as Error, req as never, res as never, () => {});
    else res.status(404).json({ error: 'Not found' });
  });
  return res.result;
}
