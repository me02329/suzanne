import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

// Mode local (ADR 0011) : les tests d'intégration, INCHANGÉS, exécutés à travers
// le gestionnaire local (backend/src/local/handler.ts) sur une base PGlite —
// le chemin du téléphone, réseau excepté. Aucun Postgres requis.
//
//   npm run test:local
const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'backend', 'src');
const swaps = new Map([
  [path.join(src, 'prisma.ts'), path.join(src, 'local', 'prismaLocal.ts')],
  [path.join(src, 'app.ts'), path.join(src, 'local', 'testApp.ts')],
]);

// Remplace des modules du backend importés en relatif ('../prisma.js', '../app').
function localSwaps(): Plugin {
  return {
    name: 'suzanne-local-swaps',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const target = resolved && swaps.get(path.normalize(resolved.id));
      return target ?? null;
    },
  };
}

export default defineConfig({
  plugins: [localSwaps()],
  resolve: {
    alias: [
      { find: /^express$/, replacement: path.join(src, 'local', 'expressShim.ts') },
      { find: /^supertest$/, replacement: path.join(src, 'local', 'testClient.ts') },
    ],
  },
  test: {
    include: ['backend/src/**/*.integration.test.ts'],
    setupFiles: ['backend/src/local/testSetup.ts', 'backend/src/test/integrationSetup.ts'],
    env: { DATABASE_URL: 'pglite://mode-local' },
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
