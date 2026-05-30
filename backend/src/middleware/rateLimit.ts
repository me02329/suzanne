import type { Request, RequestHandler } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
}

// Minimal in-memory fixed-window rate limiter. Suited to the single-instance
// deployment of this app; keeps no state across restarts and needs no
// dependency. Used to cap calls to the paid AI endpoints (see issue #3/#2):
// a runaway client loop can't rack up the OpenAI bill.
export function rateLimit({ windowMs, max, key }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    const entry = hits.get(k);

    if (!entry || entry.resetAt <= now) {
      hits.set(k, { count: 1, resetAt: now + windowMs });
      // Opportunistic cleanup so the map can't grow unbounded over time.
      if (hits.size > 1000) {
        for (const [mapKey, value] of hits) if (value.resetAt <= now) hits.delete(mapKey);
      }
      next();
      return;
    }

    if (entry.count >= max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({ error: `Trop de requêtes IA, réessaie dans ${retry}s.` });
      return;
    }

    entry.count += 1;
    next();
  };
}
