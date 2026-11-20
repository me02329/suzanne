// Mode local (ADR 0011) : base PGlite pré-migrée, livrée avec l'app pour un
// premier lancement instantané (pas de migrations sur le téléphone).
// Écrit frontend/.local-build/suzanne-db.tar.gz ; la table _suzanne_migrations
// liste les migrations incluses — l'app applique les suivantes à la mise à jour.
//
//   node tools/build-local-db.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'backend', 'prisma', 'migrations');
const outDir = path.join(root, 'frontend', '.local-build');

const db = new PGlite();
const t0 = Date.now();
const names = fs.readdirSync(migrationsDir).filter((n) => fs.existsSync(path.join(migrationsDir, n, 'migration.sql'))).sort();
await db.exec('CREATE TABLE _suzanne_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
for (const name of names) {
  await db.exec(fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'));
  await db.query('INSERT INTO _suzanne_migrations (name) VALUES ($1)', [name]);
}
// Base compacte avant export (VACUUM hors transaction : requêtes séparées).
await db.query('VACUUM FULL');
await db.query('CHECKPOINT');
const archive = Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer());
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'suzanne-db.tar.gz'), archive);
await db.close();
console.log(`[build-local-db] ${names.length} migrations en ${Date.now() - t0} ms → ${(archive.length / 1024).toFixed(0)} Ko`);
