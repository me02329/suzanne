import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from './vite.config';

// Build « local » (ADR 0011) : le frontend + le serveur Suzanne embarqué, qui
// s'exécute dans la page sur une base PGlite. Mêmes sources que le build
// normal ; seuls quelques modules sont substitués :
//   express            → petit routeur compatible (backend/src/local/expressShim.ts)
//   backend prisma.ts  → module prisma sur PGlite (backend/src/local/prismaLocal.ts)
//   @prisma/client     → client « edge » (moteur de requêtes en WebAssembly)
//   node:crypto        → SHA-256 identique à Node (empreintes d'import)
//   node:fs, path…     → indisponibles (seuls la synchro bancaire et le serveur HTTP s'en servent)
//   src/local/mode.ts  → src/local/bootstrap.ts (démarre base + serveur)
//
//   npm run build:local   (→ frontend/dist-local)
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const backendSrc = path.join(root, 'backend', 'src');
const shims = path.join(here, 'src', 'local', 'shims');
const unavailable = path.join(shims, 'unavailable.ts');

const swaps = new Map([
  [path.join(backendSrc, 'prisma.ts'), path.join(backendSrc, 'local', 'prismaLocal.ts')],
  [path.join(here, 'src', 'local', 'mode.ts'), path.join(here, 'src', 'local', 'bootstrap.ts')],
]);

function localSwaps(): Plugin {
  return {
    name: 'suzanne-local-swaps',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (resolved && swaps.get(path.normalize(resolved.id))) ?? null;
    },
  };
}

export default mergeConfig(base, defineConfig({
  plugins: [localSwaps()],
  define: {
    // Le backend lit process.env (réglages serveur) : vide en local.
    'process.env': '{}',
  },
  resolve: {
    alias: [
      { find: /^express$/, replacement: path.join(backendSrc, 'local', 'expressShim.ts') },
      { find: /^@prisma\/client$/, replacement: path.join(root, 'node_modules', '.prisma', 'client', 'edge.js') },
      { find: '#wasm-compiler-loader', replacement: path.join(shims, 'prismaWasmLoader.ts') },
      { find: /^(node:)?crypto$/, replacement: path.join(shims, 'nodeCrypto.ts') },
      { find: /^(node:)?(fs|path|url)$/, replacement: unavailable },
      { find: /^(dotenv\/config|compression|cors)$/, replacement: unavailable },
    ],
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    outDir: 'dist-local',
    emptyOutDir: true,
    target: 'es2022', // await de premier niveau (module prisma local, chargeur WASM)
    chunkSizeWarningLimit: 4000,
  },
}));
