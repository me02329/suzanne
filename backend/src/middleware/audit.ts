import type { NextFunction, Request, Response } from 'express';
import { prismaBase } from '../prisma.js';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// Endpoints d'écriture qui ne sont pas des mutations métier à tracer.
const SKIP_ENTITIES = new Set(['audit-log', 'export', 'import-mappings']);

// Extrait { user_id, entity, entity_id } d'un chemin /api/users/:uid/:entity[/:id…].
function parsePath(pathname: string): { user_id: number | null; entity: string; entity_id: number | null } | null {
  const parts = pathname.replace(/^\/+/, '').split('/'); // ['api','users','3','transactions','5',...]
  if (parts[0] !== 'api') return null;
  let user_id: number | null = null;
  let rest = parts.slice(1);
  if (rest[0] === 'users' && rest[1]) {
    user_id = Number(rest[1]) || null;
    rest = rest.slice(2);
  }
  const entity = rest[0];
  if (!entity) return null;
  // Premier segment numérique après l'entité = identifiant ciblé.
  const idSeg = rest.slice(1).find((s) => /^\d+$/.test(s));
  return { user_id, entity, entity_id: idSeg ? Number(idSeg) : null };
}

// Journalise les mutations réussies, après la réponse, sans bloquer la requête.
export function auditLog() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING.has(req.method)) return next();
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      // originalUrl conserve le préfixe /api (req.path est relatif au montage).
      const parsed = parsePath(req.originalUrl.split('?')[0] ?? '');
      if (!parsed || SKIP_ENTITIES.has(parsed.entity)) return;
      prismaBase.auditLog.create({
        data: {
          user_id: parsed.user_id,
          action: req.method,
          entity: parsed.entity,
          entity_id: parsed.entity_id,
          status: res.statusCode,
        },
      }).catch(() => { /* le journal ne doit jamais casser une requête */ });
    });
    next();
  };
}
