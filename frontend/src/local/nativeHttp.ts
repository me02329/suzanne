// Côté page du pont HTTP natif de l'app Android (ADR 0012, NativeHttp.java).
// L'interface est servie par l'app (https://suzanne.local) ; les appels au
// serveur Suzanne passent par l'app, qui gère le certificat (« Faire confiance
// à ce serveur »), le http d'un serveur local et l'absence de CORS. Un fetch
// direct échouerait : WebView refuse un certificat auto-signé sans recours, et
// bloque le http depuis une page https (contenu mixte).

export interface SuzanneHttpBridge {
  start(meta: string): string;
  write(id: string, base64: string): boolean;
  send(id: string): void;
  read(id: string, max: number): string;
  cancel(id: string): void;
  release(id: string): void;
  serverUrl(): string;
}

declare global {
  interface Window {
    SuzanneHttp?: SuzanneHttpBridge;
    __suzanneHttp?: {
      ready(id: string, status: number, headers: string): void;
      fail(id: string, message: string): void;
    };
  }
}

/** Le pont de l'app, s'il existe (absent dans un navigateur). */
export function nativeBridge(): SuzanneHttpBridge | null {
  return typeof window !== 'undefined' && window.SuzanneHttp ? window.SuzanneHttp : null;
}

type Waiter = { resolve: (r: { status: number; headers: Record<string, string> }) => void; reject: (e: Error) => void };
const waiting = new Map<string, Waiter>();

function installCallbacks() {
  if (window.__suzanneHttp) return;
  window.__suzanneHttp = {
    ready(id, status, headers) {
      const w = waiting.get(id);
      waiting.delete(id);
      let parsed: Record<string, string> = {};
      try { parsed = JSON.parse(headers) as Record<string, string>; } catch { /* en-têtes illisibles : ignorés */ }
      w?.resolve({ status, headers: parsed });
    },
    fail(id, message) {
      const w = waiting.get(id);
      waiting.delete(id);
      // Comme un fetch qui échoue sur le réseau : TypeError.
      w?.reject(new TypeError(`Serveur injoignable — ${message}`));
    },
  };
}

const UPLOAD_CHUNK = 768 * 1024; // multiple de 3 : base64 sans remplissage intermédiaire
const DOWNLOAD_CHUNK = 1024 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const abortError = () => new DOMException('Requête annulée', 'AbortError');

/** fetch exécuté par l'app vers `url` (qui doit être sur le serveur configuré). */
export async function nativeFetch(bridge: SuzanneHttpBridge, url: string, request: Request): Promise<Response> {
  installCallbacks();
  if (request.signal.aborted) throw abortError();
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => { headers[name] = value; });

  const id = bridge.start(JSON.stringify({ method, url, headers }));
  if (id.startsWith('!')) throw new TypeError(id.slice(1));

  try {
    if (method !== 'GET' && method !== 'HEAD') {
      const body = new Uint8Array(await request.arrayBuffer());
      for (let i = 0; i < body.length; i += UPLOAD_CHUNK) {
        if (!bridge.write(id, toBase64(body.subarray(i, i + UPLOAD_CHUNK)))) throw new TypeError('Envoi de la requête impossible');
      }
    }
    const head = await new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      request.signal.addEventListener('abort', () => {
        waiting.delete(id);
        bridge.cancel(id);
        reject(abortError());
      }, { once: true });
      bridge.send(id);
    });

    const noBody = method === 'HEAD' || head.status === 204 || head.status === 304;
    if (noBody) {
      bridge.release(id);
      return new Response(null, { status: head.status, headers: head.headers });
    }
    let released = false;
    const release = () => { if (!released) { released = true; bridge.release(id); } };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = bridge.read(id, DOWNLOAD_CHUNK);
        if (!chunk) { release(); controller.close(); return; }
        controller.enqueue(fromBase64(chunk));
      },
      cancel: release,
    });
    request.signal.addEventListener('abort', release, { once: true });
    return new Response(body, { status: head.status, headers: head.headers });
  } catch (error) {
    bridge.release(id);
    throw error;
  }
}
