import { handleLocal } from './handler.js';

// Tests du mode local : remplace `supertest` (alias dans
// vitest.local.config.ts) pour faire passer les tests d'intégration, inchangés,
// par le gestionnaire local — exactement le chemin du téléphone, réseau excepté.
// Couvre l'usage des tests : request(app).get|post|put|patch|delete(url)
// .send(body).query(q).set(h).expect(status) puis await → { status, body, text, headers }.

interface TestResponse { status: number; body: any; text: string; headers: Record<string, string> } // eslint-disable-line @typescript-eslint/no-explicit-any

class TestRequest implements PromiseLike<TestResponse> {
  private payload: unknown = undefined;
  private extraQuery = new URLSearchParams();
  private headers: Record<string, string> = {};
  private expected: number | null = null;

  constructor(private method: string, private url: string) {}

  send(body: unknown): this { this.payload = body; return this; }
  query(q: Record<string, string | number>): this { for (const [k, v] of Object.entries(q)) this.extraQuery.append(k, String(v)); return this; }
  set(name: string, value: string): this { this.headers[name] = value; return this; }
  expect(status: number): this { this.expected = status; return this; }

  private async run(): Promise<TestResponse> {
    const qs = this.extraQuery.toString();
    const url = qs ? `${this.url}${this.url.includes('?') ? '&' : '?'}${qs}` : this.url;
    // Aller-retour JSON, comme sur le réseau (dates → chaînes, undefined retiré).
    const body = this.payload === undefined ? undefined : JSON.parse(JSON.stringify(this.payload));
    const result = await handleLocal(this.method, url, body, this.headers);
    let text = '';
    if (result.stream) {
      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
    } else if (result.body instanceof Uint8Array) {
      text = new TextDecoder().decode(result.body);
    } else {
      text = result.body ?? '';
    }
    const isJson = (result.headers['content-type'] ?? '').includes('application/json');
    const response: TestResponse = { status: result.status, headers: result.headers, text, body: isJson && text ? JSON.parse(text) : {} };
    if (this.expected !== null && response.status !== this.expected) {
      throw new Error(`expected ${this.expected}, got ${response.status} ${text.slice(0, 300)} (${this.method} ${url})`);
    }
    return response;
  }

  then<A = TestResponse, B = never>(ok?: ((v: TestResponse) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, ko);
  }
}

export default function request(_app?: unknown) {
  return {
    get: (url: string) => new TestRequest('GET', url),
    post: (url: string) => new TestRequest('POST', url),
    put: (url: string) => new TestRequest('PUT', url),
    patch: (url: string) => new TestRequest('PATCH', url),
    delete: (url: string) => new TestRequest('DELETE', url),
  };
}
