import { PrismaClient } from '@prisma/client';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import type { PGlite } from '@electric-sql/pglite';
import { withSoftDelete } from '../prismaSoftDelete.js';

// Mode local (ADR 0011) : remplace `src/prisma.ts` (alias de build / de test).
// La base est un PGlite (Postgres en WebAssembly) ouvert AVANT le chargement des
// routes par l'amorce (navigateur : IndexedDB + instantané ; tests Node : en
// mémoire + migrations), et publiée sur `globalThis.__suzanneLocalDb`.
declare global {
  // eslint-disable-next-line no-var
  var __suzanneLocalDb: Promise<PGlite> | undefined;
}

if (!globalThis.__suzanneLocalDb) {
  throw new Error('Mode local : base non initialisée (globalThis.__suzanneLocalDb).');
}
const db = await globalThis.__suzanneLocalDb;

// Mêmes exports que src/prisma.ts : les routes n'y voient aucune différence.
export const prismaBase = new PrismaClient({ adapter: new PrismaPGlite(db) });
export const prisma = withSoftDelete(prismaBase);
