import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AiProviderError } from '../ai/client.js';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Erreur métier avec status HTTP explicite (message en français, sûr à montrer).
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof AiProviderError) {
    res.status(err.status).json({ error: err.message, ai: { kind: err.kind, detail: err.detail } });
    return;
  }
  // Prisma errors carry the raw query/SQL in their message — never forward that
  // to the client. Map the common ones to friendly messages, log the rest.
  const prisma = asPrismaKnownError(err);
  if (prisma) {
    console.error('[api]', err);
    if (prisma.code === 'P2002') { res.status(409).json({ error: 'Cette entrée existe déjà.' }); return; }
    if (prisma.code === 'P2025') { res.status(404).json({ error: 'Ressource introuvable.' }); return; }
    res.status(500).json({ error: 'Erreur de base de données.' });
    return;
  }
  // Routes throw plain Errors with safe, user-facing French messages
  // (e.g. "Transaction introuvable"); those are fine to surface.
  console.error('[api]', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur interne du serveur' });
}

// Duck-typed so we don't couple to a specific @prisma/client import path/version.
function asPrismaKnownError(err: unknown): { code: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string'
    ? { code: e.code }
    : null;
}
