// Mode local (ADR 0011) : remplace ./mode.ts dans le build « local ». Démarre,
// dans la page, la base (PGlite, persistée dans IndexedDB) et le serveur
// Suzanne embarqué, puis redirige les appels /api/… de l'app vers lui.
import { Buffer } from 'buffer';
import { PGlite } from '@electric-sql/pglite';
import snapshotUrl from '../../.local-build/suzanne-db.pgz?url';
import { migrateWithBackup } from './migrate';
import { nativeBridge, nativeFetch, type SuzanneHttpBridge } from './nativeHttp';

// Build de l'app : vrai quand les données sont sur le téléphone, faux quand
// l'app est reliée à un serveur (fixé par startLocal, avant le rendu).
export let LOCAL_MODE = true;

// Origine fixe (IndexedDB est lié à l'origine et à ce nom) : ne jamais changer.
const DB_NAME = 'suzanne-local';
const IDB_NAME = `/pglite/${DB_NAME}`;

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

/** La base contient-elle une installation complète (table de suivi des migrations) ? */
async function isInstalled(db: PGlite): Promise<boolean> {
  const r = await db.query<{ t: string | null }>("SELECT to_regclass('public._suzanne_migrations')::text AS t");
  return r.rows[0]?.t != null;
}

async function deleteIdb(name: string) {
  await new Promise((done) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => done(null); });
}

/**
 * Ouvre la base. Recopie vers IndexedDB : PGlite la fait par défaut après CHAQUE
 * requête, lectures comprises, et l'attend — mesuré : ~1 s par recopie sur un
 * appareil lent, 8 recopies pour le seul tableau de bord, l'app semblait figée.
 * Ici, durabilité « allégée » : la recopie part en arrière-plan sans bloquer
 * les lectures ; les écritures, elles, attendent une recopie complète avant
 * d'être confirmées (flushToDisk). Toutes les recopies — celles de PGlite et
 * les nôtres — passent l'une après l'autre (jamais deux en même temps).
 */
async function createDb(options: { loadDataDir?: Blob } = {}): Promise<PGlite> {
  const db = await PGlite.create(`idb://${DB_NAME}`, { relaxedDurability: true, ...options });
  const fs = (db as unknown as { fs: { syncToFs: (relaxed: boolean) => Promise<void> } }).fs;
  const original = fs.syncToFs.bind(fs);
  let chain: Promise<void> = Promise.resolve();
  fs.syncToFs = (relaxed: boolean) => {
    const run = chain.then(() => original(relaxed));
    chain = run.catch(() => undefined);
    return run;
  };
  return db;
}

/**
 * Durabilité : une écriture confirmée à l'écran doit être sur le disque, même si
 * l'app est tuée juste après (vérifié : sans cela, une opération créée puis l'app
 * fermée de force était perdue). Recopie complète, mise après toute recopie en
 * cours, et attendue jusqu'au bout.
 */
async function flushToDisk(db: PGlite): Promise<void> {
  await (db as unknown as { fs: { syncToFs: (relaxed: boolean) => Promise<void> } }).fs.syncToFs(false);
}

async function installFromSnapshot(): Promise<PGlite> {
  // Base pré-migrée livrée avec l'app plutôt que 39 migrations sur le téléphone.
  const response = await fetch(snapshotUrl);
  if (!response.ok) throw new Error(`Base de départ introuvable (${response.status})`);
  // Archive tar gzip : on le dit à PGlite quel que soit le type annoncé par
  // celui qui sert le fichier (APK, serveur de test…).
  const snapshot = new Blob([await response.arrayBuffer()], { type: 'application/gzip' });
  const db = await createDb({ loadDataDir: snapshot });
  await flushToDisk(db);
  return db;
}

async function openDatabase(): Promise<PGlite> {
  let db: PGlite;
  // Règle de sûreté : une base existante n'est JAMAIS effacée sur la foi d'un
  // indicateur extérieur (un drapeau localStorage peut se perdre si l'app est
  // tuée). Elle est ouverte ; seule une installation visiblement inachevée
  // (ouverte, mais sans sa table de suivi) est refaite. Si elle ne s'ouvre pas,
  // l'erreur remonte à l'écran plutôt que d'effacer quoi que ce soit.
  if (await idbExists(IDB_NAME)) {
    db = await createDb();
    if (!(await isInstalled(db))) {
      await db.close();
      await deleteIdb(IDB_NAME);
      db = await installFromSnapshot();
    }
  } else {
    db = await installFromSnapshot();
  }
  // Mise à jour de l'app : migrations en attente, avec copie de sécurité
  // préalable et restauration complète en cas d'échec (voir migrate.ts).
  const { db: migrated } = await migrateWithBackup(db, ALL_MIGRATIONS, {
    keepBackup: storeBackup,
    restore: async (dump) => {
      await deleteIdb(IDB_NAME);
      const restored = await createDb({ loadDataDir: dump });
      await flushToDisk(restored);
      return restored;
    },
    flush: flushToDisk,
  });
  return migrated;
}

const ALL_MIGRATIONS = Object.entries(MIGRATIONS).map(([key, sql]) => ({ name: migrationName(key), sql }));

// Copies de sécurité d'avant migration : dans une base IndexedDB à part (pas
// dans la base qu'on migre), les 3 plus récentes conservées.
const BACKUP_IDB = 'suzanne-local-backups';
const BACKUPS_KEPT = 3;

function openBackupStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_IDB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('dumps', { keyPath: 'at' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeBackup(dump: Blob, pending: string[]): Promise<void> {
  const idb = await openBackupStore();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('dumps', 'readwrite', { durability: 'strict' });
    const store = tx.objectStore('dumps');
    store.put({ at: new Date().toISOString(), pending, dump });
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const all = (keys.result as string[]).sort();
      for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) store.delete(old);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
}

type LocalHandler = (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{
  status: number; headers: Record<string, string>; body: string | Uint8Array | null; stream: ReadableStream<Uint8Array> | null;
}>;

/** Redirige fetch('/api/…') (même origine) vers le serveur embarqué. */
function interceptApi(handle: LocalHandler, db: PGlite) {
  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, init);
    if (request.signal.aborted) throw new DOMException('Requête annulée', 'AbortError');

    const text = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }

    const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
    const run = (async () => {
      const result = await handle(request.method, url.pathname + url.search, body, Object.fromEntries(request.headers));
      // Écriture (hors flux de l'assistant) : sur le disque avant de répondre.
      if (isWrite && !result.stream) await flushToDisk(db);
      return result;
    })();

    const result = await new Promise<Awaited<ReturnType<LocalHandler>>>((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Requête annulée', 'AbortError')), { once: true });
      run.then(resolve, reject);
    });
    const noBody = result.status === 204 || result.status === 304;
    const payload = noBody ? null : (result.stream ?? (result.body as BodyInit | null) ?? '');
    return new Response(payload, { status: result.status, headers: result.headers });
  };
}

/**
 * App reliée à un serveur : même interface embarquée, mais les appels /api/…
 * partent vers le serveur, par le pont natif (voir nativeHttp.ts). La base
 * locale n'est pas ouverte.
 */
function interceptToServer(bridge: SuzanneHttpBridge, server: string) {
  const networkFetch = window.fetch.bind(window);
  const base = server.replace(/\/+$/, '');
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, init);
    return nativeFetch(bridge, base + url.pathname + url.search, request);
  };
}

export async function startLocal(): Promise<void> {
  const bridge = nativeBridge();
  const server = bridge?.serverUrl() ?? '';
  if (bridge && server) {
    LOCAL_MODE = false;
    interceptToServer(bridge, server);
    return;
  }
  (globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
  globalThis.__suzanneLocalDb = openDatabase();
  const db = await globalThis.__suzanneLocalDb;
  // Chargé après la base : le module prisma local l'attend au chargement.
  const { handleLocal } = await import('../../../backend/src/local/handler');
  // Première ouverture : un profil prêt à l'emploi (comme l'installation d'un
  // serveur), créé par la même route que l'app — catégories par défaut comprises.
  const users = await handleLocal('GET', '/api/users');
  if (users.status === 200 && users.body === '[]') {
    await handleLocal('POST', '/api/users', { name: 'Moi' });
    await flushToDisk(db);
  }
  interceptApi(handleLocal as LocalHandler, db);
}
