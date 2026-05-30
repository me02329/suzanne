import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit } from './rateLimit';

function mockRes() {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  return {
    res: res as unknown as Response,
    state: res,
    impl: {
      status(code: number) { res.statusCode = code; return this; },
      json(body: unknown) { res.body = body; return this; },
      setHeader(key: string, value: string) { res.headers[key] = value; },
    },
  };
}

function call(mw: ReturnType<typeof rateLimit>, req: Partial<Request>) {
  const m = mockRes();
  Object.assign(m.res, m.impl);
  let nexted = false;
  mw(req as Request, m.res, () => { nexted = true; });
  return { nexted, state: m.state };
}

describe('rateLimit', () => {
  it('allows up to max then blocks with 429 and a Retry-After header', () => {
    const mw = rateLimit({ windowMs: 1000, max: 2, key: () => 'k' });
    expect(call(mw, {}).nexted).toBe(true);
    expect(call(mw, {}).nexted).toBe(true);
    const third = call(mw, {});
    expect(third.nexted).toBe(false);
    expect(third.state.statusCode).toBe(429);
    expect(third.state.headers['Retry-After']).toBeDefined();
  });

  it('tracks each key independently', () => {
    const mw = rateLimit({ windowMs: 1000, max: 1, key: (req) => String((req as { k?: string }).k) });
    expect(call(mw, { k: 'a' } as Partial<Request>).nexted).toBe(true);
    expect(call(mw, { k: 'b' } as Partial<Request>).nexted).toBe(true);
    expect(call(mw, { k: 'a' } as Partial<Request>).nexted).toBe(false);
  });
});
