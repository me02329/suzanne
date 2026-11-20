// Mode local (ADR 0011) : remplace ./mode.ts dans le build « local ». Démarre,
// dans la page, la base (PGlite, persistée dans IndexedDB) et le serveur
// Suzanne embarqué, puis redirige les appels /api/… de l'app vers lui.
import { Buffer } from 'buffer';
import { PGlite } from '@electric-sql/pglite';
import snapshotUrl from '../../.local-build/suzanne-db.tar.gz?url';

export const LOCAL_MODE = true;

// Origine fixe (IndexedDB est lié à l'origine et à ce nom) : ne jamais changer.
const DB_NAME = 'suzanne-local';
const IDB_NAME = `/pglite/${DB_NAME}`;
const READY_KEY = 'suzanne-local-db';

// Toutes les migrations du backend, embarquées : celles ajoutées depuis
// l'instantané (mise à jour de l'app) sont appliquées au lancement.
const MIGRATIONS = import.meta.glob('../../../backend/prisma/migrations/*/migration.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const migrationName = (key: string) => key.split('/').slice(-2, -1)[0]!;

declare global {
  // eslint-disable-next-line no-var
  var __suzanneLocalDb: Promise<PGlite> | undefined;
}

async function idbExists(name: string): Promise<boolean> {
  try { return (await indexedDB.databases()).some((d) => d.name === name); } catch { return false; }
}

async function openDatabase(): Promise<PGlite> {
  let db: PGlite;
  if (localStorage.getItem(READY_KEY) === '1' && await idbExists(IDB_NAME)) {
    db = await PGlite.create(`idb://${DB_NAME}`);
  } else {
    // Premier lancement : base pré-migrée (instantané livré avec l'app) plutôt
    // que 39 migrations sur le téléphone. Une base inachevée est repartie de zéro.
    if (await idbExists(IDB_NAME)) await new Promise((done) => { const r = indexedDB.deleteDatabase(IDB_NAME); r.onsuccess = r.onerror = r.onblocked = () => done(null); });
    const snapshot = await (await fetch(snapshotUrl)).blob();
    db = await PGlite.create(`idb://${DB_NAME}`, { loadDataDir: snapshot });
    localStorage.setItem(READY_KEY, '1');
  }
  await applyPendingMigrations(db);
  return db;
}

async function applyPendingMigrations(db: PGlite) {
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM _suzanne_migrations')).rows.map((r) => r.name));
  const pending = Object.keys(MIGRATIONS).sort().filter((key) => !applied.has(migrationName(key)));
  for (const key of pending) {
    // Une migration et son enregistrement réussissent ou échouent ensemble.
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[key]!);
      await tx.query('INSERT INTO _suzanne_migrations (name) VALUES ($1)', [migrationName(key)]);
    });
  }
}

type LocalHandler = (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{
  status: number; headers: Record<string, string>; body: string | Uint8Array | null; stream: ReadableStream<Uint8Array> | null;
}>;

/** Redirige fetch('/api/…') (même origine) vers le serveur embarqué. */
function interceptApi(handle: LocalHandler) {
  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, init);
    if (request.signal.aborted) throw new DOMException('Requête annulée', 'AbortError');

    const text = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }

    const result = await new Promise<Awaited<ReturnType<LocalHandler>>>((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Requête annulée', 'AbortError')), { once: true });
      handle(request.method, url.pathname + url.search, body, Object.fromEntries(request.headers)).then(resolve, reject);
    });
    const noBody = result.status === 204 || result.status === 304;
    const payload = noBody ? null : (result.stream ?? (result.body as BodyInit | null) ?? '');
    return new Response(payload, { status: result.status, headers: result.headers });
  };
}

export async function startLocal(): Promise<void> {
  (globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
  globalThis.__suzanneLocalDb = openDatabase();
  await globalThis.__suzanneLocalDb;
  // Chargé après la base : le module prisma local l'attend au chargement.
  const { handleLocal } = await import('../../../backend/src/local/handler');
  // Première ouverture : un profil prêt à l'emploi (comme l'installation d'un
  // serveur), créé par la même route que l'app — catégories par défaut comprises.
  const users = await handleLocal('GET', '/api/users');
  if (users.status === 200 && users.body === '[]') await handleLocal('POST', '/api/users', { name: 'Moi' });
  interceptApi(handleLocal as LocalHandler);
}
