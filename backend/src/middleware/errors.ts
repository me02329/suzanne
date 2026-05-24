import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: err.issues });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[api]', err);
  res.status(500).json({ error: message });
}
