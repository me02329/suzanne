// Bump CACHE_VERSION à chaque changement de stratégie : l'activate purge les
// anciens caches. Les assets hashés s'accumuleraient sinon à chaque
// déploiement, donc le cache runtime est aussi borné (MAX_RUNTIME_ENTRIES, FIFO).
const CACHE_VERSION = 'v3';
const CACHE_NAME = `suzanne-${CACHE_VERSION}`;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];
const MAX_RUNTIME_ENTRIES = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

async function putWithTrim(request, response) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  const keys = await cache.keys();
  const runtimeKeys = keys.filter((key) => new URL(key.url).pathname.startsWith('/assets/'));
  // FIFO : cache.keys() renvoie l'ordre d'insertion — on retire les plus vieux.
  for (const key of runtimeKeys.slice(0, Math.max(0, runtimeKeys.length - MAX_RUNTIME_ENTRIES))) {
    await cache.delete(key);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
        const clone = response.clone();
        event.waitUntil(putWithTrim(request, clone));
      }
      return response;
    })),
  );
});
