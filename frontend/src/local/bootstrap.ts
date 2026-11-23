// App Android (ADR 0011, 0012) : remplace ./mode.ts dans le build « app ».
// L'interface est embarquée ; chaque profil vit sur le serveur (appels par le
// pont natif) ou sur le téléphone (base PGlite dans IndexedDB + serveur Suzanne
// embarqué dans la page, démarrés seulement si un profil du téléphone sert).
import { Buffer } from 'buffer';
import { PGlite } from '@electric-sql/pglite';
import snapshotUrl from '../../.local-build/suzanne-db.pgz?url';
import { migrateWithBackup } from './migrate';
import { nativeBridge, nativeFetch, toBase64 } from './nativeHttp';
import { saveBlob } from '../lib/download';
import { authHeaders, notifyUnauthorized } from '../lib/authToken';
import { readActiveProfile, writeActiveProfile, type Backend } from '../lib/activeProfile';

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

// Base installée pendant ce lancement (première ouverture) ?
let freshInstall = false;

async function installFromSnapshot(): Promise<PGlite> {
  freshInstall = true;
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

// ---- Serveur embarqué (côté « téléphone »), démarré à la demande -----------

let localServer: Promise<{ handle: LocalHandler; db: PGlite }> | null = null;

/** Ouvre la base du téléphone et charge le serveur embarqué (une seule fois). */
function ensureLocal(): Promise<{ handle: LocalHandler; db: PGlite }> {
  localServer ??= (async () => {
    (globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
    globalThis.__suzanneLocalDb = openDatabase();
    const db = await globalThis.__suzanneLocalDb;
    // Chargé après la base : le module prisma local l'attend au chargement.
    const { handleLocal } = await import('../../../backend/src/local/handler');
    return { handle: handleLocal as LocalHandler, db };
  })();
  return localServer;
}

/** Requête /api/… exécutée par le serveur embarqué. */
async function localFetch(request: Request): Promise<Response> {
  if (request.signal.aborted) throw new DOMException('Requête annulée', 'AbortError');
  const { handle, db } = await ensureLocal();
  const url = new URL(request.url);
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
}

// ---- Serveur distant (côté « serveur »), par le pont natif ------------------

function serverBase(): string {
  return (nativeBridge()?.serverUrl() ?? '').replace(/\/+$/, '');
}

export function serverConfigured(): boolean {
  return serverBase() !== '';
}

function serverFetch(request: Request): Promise<Response> {
  const bridge = nativeBridge();
  const base = serverBase();
  if (!bridge || !base) return Promise.reject(new TypeError('Aucun serveur configuré dans l’app'));
  const url = new URL(request.url);
  return nativeFetch(bridge, base + url.pathname + url.search, request);
}

// ---- Côté actif --------------------------------------------------------------

/**
 * Côté du profil actif, fixé au démarrage (changer de côté recharge l'app) :
 * celui retenu s'il est encore disponible, sinon le serveur s'il y en a un.
 */
const ACTIVE: Backend = (() => {
  const saved = readActiveProfile()?.backend;
  if (saved === 'phone') return 'phone';
  if (saved === 'server' && serverConfigured()) return 'server';
  return serverConfigured() ? 'server' : 'phone';
})();

export const IS_APP = true;

export function activeBackend(): Backend {
  return ACTIVE;
}

export function availableBackends(): Backend[] {
  return serverConfigured() ? ['server', 'phone'] : ['phone'];
}

function dispatch(backend: Backend, request: Request): Promise<Response> {
  return backend === 'phone' ? localFetch(request) : serverFetch(request);
}

/** Appel à l'API d'un côté donné, quel que soit le côté actif. */
export function fetchFrom(backend: Backend, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (backend === 'server') for (const [name, value] of Object.entries(authHeaders())) if (!headers.has(name)) headers.set(name, value);
  return dispatch(backend, new Request(new URL(path, window.location.origin), { ...init, headers })).then((response) => {
    // Jeton manquant ou refusé, même depuis le côté téléphone : on le demande.
    if (backend === 'server' && response.status === 401) notifyUnauthorized();
    return response;
  });
}

/**
 * Enregistre un fichier dans Téléchargements et attend la confirmation de
 * l'app (une sauvegarde d'avant transfert doit être sur le disque avant
 * qu'on retire quoi que ce soit).
 */
export async function saveFileNow(blob: Blob, filename: string): Promise<void> {
  const android = (window as { SuzanneAndroid?: { saveFile(base64: string, name: string, mime: string, open: boolean): boolean } }).SuzanneAndroid;
  if (!android) { saveBlob(blob, filename); return; }
  const saved = android.saveFile(toBase64(new Uint8Array(await blob.arrayBuffer())), filename, blob.type || 'application/octet-stream', false);
  if (saved !== true) throw new Error('fichier non enregistré');
}

/** Ouvre un profil ; changer de côté recharge l'app. */
export function switchProfile(backend: Backend, userId: number): void {
  writeActiveProfile({ backend, userId });
  if (backend !== ACTIVE) window.location.reload();
}

// Même liste que NativeHttp.MARKET_HOSTS (l'app refuse tout autre hôte).
const MARKET_HOSTS = new Set(['query1.finance.yahoo.com', 'query2.finance.yahoo.com']);

export async function startLocal(): Promise<void> {
  // Tous les fetch('/api/…') de l'interface vont au côté actif.
  const networkFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    // Cours et taux de change (serveur embarqué) : Yahoo n'autorise pas les
    // appels depuis une page, l'app les fait pour nous.
    const bridge = nativeBridge();
    if (bridge && MARKET_HOSTS.has(url.host)) return nativeFetch(bridge, url.href, request);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, init);
    return dispatch(ACTIVE, request);
  };
  if (ACTIVE !== 'phone') return; // la base du téléphone ne s'ouvre qu'au besoin

  const { handle, db } = await ensureLocal();
  // Côté téléphone, toute première ouverture : un profil prêt à l'emploi (comme
  // l'installation d'un serveur), créé par la même route que l'app. Pas après
  // coup : un téléphone vidé par un transfert reste vide.
  if (!freshInstall) return;
  const users = await handle('GET', '/api/users');
  if (users.status === 200 && users.body === '[]') {
    await handle('POST', '/api/users', { name: 'Moi' });
    await flushToDisk(db);
  }
}
