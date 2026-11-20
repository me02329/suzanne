// Mode local (ADR 0011) : sous-ensemble d'Express suffisant pour exécuter les
// routes du backend SANS serveur HTTP — dans la WebView (alias `express` → ce
// fichier dans le build local) ou sous Node (tests). Couvre ce que les routes
// utilisent : Router get/post/put/patch/delete/use, paramètres `:nom`, chaîne de
// middlewares, middlewares d'erreur (4 arguments), et côté réponse
// status/json/send/setHeader/write/end/on('finish'|'close').
//
// Le code des routes n'est pas modifié : il importe `Router` et les types
// `Request`/`Response`/`NextFunction`/`RequestHandler` comme avec Express.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type NextFunction = (err?: unknown) => void;
export type RequestHandler = (req: any, res: any, next: NextFunction) => unknown;
type ErrorHandler = (err: unknown, req: any, res: any, next: NextFunction) => unknown;
export type Request = LocalRequest;
export type Response = LocalResponse;

interface Layer {
  method: string | null; // null = use()
  regex: RegExp;
  keys: string[];
  handlers: Array<RequestHandler | ErrorHandler>;
  prefix: boolean; // use() : correspond aussi aux sous-chemins
  pathLength: string; // préfixe littéral à retirer pour un sous-routeur
}

function compile(path: string, prefix: boolean): Pick<Layer, 'regex' | 'keys' | 'prefix' | 'pathLength'> {
  const keys: string[] = [];
  const clean = path === '/' ? '' : path.replace(/\/$/, '');
  const source = clean
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) { keys.push(segment.slice(1)); return '([^/]+?)'; }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  // Comme Express : insensible à la casse, barre finale tolérée.
  const regex = prefix ? new RegExp(`^${source}(?=/|$)`, 'i') : new RegExp(`^${source}/?$`, 'i');
  return { regex, keys, prefix, pathLength: clean };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface LocalRouter {
  (req: LocalRequest, res: LocalResponse, done: NextFunction): void;
  get(path: string, ...handlers: RequestHandler[]): LocalRouter;
  post(path: string, ...handlers: RequestHandler[]): LocalRouter;
  put(path: string, ...handlers: RequestHandler[]): LocalRouter;
  patch(path: string, ...handlers: RequestHandler[]): LocalRouter;
  delete(path: string, ...handlers: RequestHandler[]): LocalRouter;
  use(...args: unknown[]): LocalRouter;
}

export function Router(): LocalRouter {
  const layers: Layer[] = [];

  const router = ((req: LocalRequest, res: LocalResponse, done: NextFunction) => {
    let index = 0;
    const next: NextFunction = (err?: unknown) => {
      if (res.writableEnded) return;
      const layer = layers[index++];
      if (!layer) { done(err); return; }
      const match = layer.regex.exec(req.path);
      if (!match || (layer.method && layer.method !== req.method)) { next(err); return; }

      const params: Record<string, string> = {};
      layer.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1] ?? ''); });
      runHandlers(layer, req, res, { ...req.params, ...params }, err, next);
    };
    next();
  }) as LocalRouter;

  for (const method of METHODS) {
    router[method] = (path: string, ...handlers: RequestHandler[]) => {
      layers.push({ method: method.toUpperCase(), handlers, ...compile(path, false) });
      return router;
    };
  }
  router.use = (...args: unknown[]) => {
    const path = typeof args[0] === 'string' ? (args.shift() as string) : '/';
    layers.push({ method: null, handlers: args.flat() as RequestHandler[], ...compile(path, true) });
    return router;
  };
  return router;
}

function runHandlers(layer: Layer, req: LocalRequest, res: LocalResponse, params: Record<string, string>, err: unknown, next: NextFunction) {
  let h = 0;
  const step: NextFunction = (error?: unknown) => {
    if (res.writableEnded) return;
    const handler = layer.handlers[h++];
    if (!handler) { next(error); return; }
    const isErrorHandler = handler.length === 4;
    if ((error !== undefined && !isErrorHandler) || (error === undefined && isErrorHandler)) { step(error); return; }
    // use('/prefixe', sousRouteur) : le sous-routeur voit un chemin relatif.
    const savedPath = req.path;
    const savedParams = req.params;
    const mounted = layer.method === null && layer.pathLength !== '';
    if (mounted) req.path = req.path.slice(layer.pathLength.length) || '/';
    req.params = params;
    const restore = () => { req.path = savedPath; req.params = savedParams; };
    const after: NextFunction = (e?: unknown) => { restore(); step(e); };
    try {
      const out = isErrorHandler
        ? (handler as ErrorHandler)(error, req, res, after)
        : (handler as RequestHandler)(req, res, after);
      if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch((e) => after(e));
    } catch (e) {
      after(e);
    }
  };
  step(err);
}

// ---- Requête / réponse -----------------------------------------------------

export class LocalRequest {
  method: string;
  url: string;
  originalUrl: string;
  path: string;
  query: Record<string, string | string[]>;
  body: unknown;
  params: Record<string, string> = {};
  headers: Record<string, string>;
  ip = '127.0.0.1';

  constructor(method: string, url: string, body: unknown, headers: Record<string, string> = {}) {
    const parsed = new URL(url, 'http://local');
    this.method = method.toUpperCase();
    this.url = parsed.pathname + parsed.search;
    this.originalUrl = this.url;
    this.path = parsed.pathname;
    this.body = body ?? {};
    this.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    // Comme le parseur de requête d'Express : une clé répétée donne un tableau.
    const query: Record<string, string | string[]> = {};
    for (const [key, value] of parsed.searchParams) {
      const prev = query[key];
      query[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
    }
    this.query = query;
  }

  header(name: string): string | undefined { return this.headers[name.toLowerCase()]; }
  get(name: string): string | undefined { return this.header(name); }
  on(): this { return this; }
}

export interface LocalResult {
  status: number;
  headers: Record<string, string>;
  /** Corps complet (json/send/end) ; null si la réponse est un flux. */
  body: string | Uint8Array | null;
  /** Flux (réponse écrite par morceaux, ex. assistant en SSE). */
  stream: ReadableStream<Uint8Array> | null;
}

export class LocalResponse {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  private headerMap: Record<string, string> = {};
  private listeners: Record<string, Array<() => void>> = {};
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private resolveResult: (r: LocalResult) => void = () => {};
  readonly result: Promise<LocalResult>;
  private encoder = new TextEncoder();

  constructor() {
    this.result = new Promise((resolve) => { this.resolveResult = resolve; });
  }

  status(code: number): this { this.statusCode = code; return this; }
  setHeader(name: string, value: string | number): this { this.headerMap[name.toLowerCase()] = String(value); return this; }
  getHeader(name: string): string | undefined { return this.headerMap[name.toLowerCase()]; }
  set(name: string, value: string): this { return this.setHeader(name, value); }
  type(value: string): this { return this.setHeader('content-type', value.includes('/') ? value : `text/${value}`); }
  on(event: string, listener: () => void): this { (this.listeners[event] ??= []).push(listener); return this; }
  private emit(event: string) { for (const l of this.listeners[event] ?? []) { try { l(); } catch { /* écouteur */ } } }

  json(value: unknown): this {
    if (!this.getHeader('content-type')) this.setHeader('content-type', 'application/json; charset=utf-8');
    return this.finish(JSON.stringify(value));
  }

  send(value?: unknown): this {
    if (value instanceof Uint8Array) {
      if (!this.getHeader('content-type')) this.setHeader('content-type', 'application/octet-stream');
      return this.finish(value);
    }
    if (typeof value === 'object' && value !== null) return this.json(value);
    if (!this.getHeader('content-type')) this.setHeader('content-type', 'text/html; charset=utf-8');
    return this.finish(value === undefined ? '' : String(value));
  }

  sendStatus(code: number): this { return this.status(code).send(String(code)); }

  /** Démarre une réponse en flux (SSE) : les en-têtes partent tout de suite. */
  flushHeaders(): void {
    if (this.headersSent) return;
    this.headersSent = true;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => { this.controller = controller; },
      cancel: () => { this.destroyed = true; this.emit('close'); },
    });
    this.resolveResult({ status: this.statusCode, headers: { ...this.headerMap }, body: null, stream });
  }

  write(chunk: string | Uint8Array): boolean {
    if (this.writableEnded) return false;
    this.flushHeaders();
    this.controller?.enqueue(typeof chunk === 'string' ? this.encoder.encode(chunk) : chunk);
    return true;
  }

  end(chunk?: string | Uint8Array): this {
    if (this.writableEnded) return this;
    if (this.controller) {
      if (chunk !== undefined) this.write(chunk);
      this.writableEnded = true;
      try { this.controller.close(); } catch { /* déjà fermé */ }
      this.emit('finish');
      this.emit('close');
      return this;
    }
    return this.finish(chunk ?? '');
  }

  private finish(body: string | Uint8Array): this {
    if (this.writableEnded) return this;
    this.writableEnded = true;
    this.headersSent = true;
    this.resolveResult({ status: this.statusCode, headers: { ...this.headerMap }, body, stream: null });
    // Comme Node : « finish » puis « close » une fois la réponse envoyée.
    queueMicrotask(() => { this.emit('finish'); this.emit('close'); });
    return this;
  }
}

// `import express from 'express'` : non utilisé par les routes ; présent pour
// que le module soit un remplaçant complet si un fichier l'importe.
const express = Object.assign(() => { throw new Error('express() indisponible en mode local'); }, { Router });
export default express;
