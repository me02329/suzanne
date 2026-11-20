// Tests du mode local : base PGlite en mémoire, migrations appliquées dans
// l'ordre, publiée pour local/prismaLocal.ts avant le chargement des routes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

if (!globalThis.__suzanneLocalDb) {
  globalThis.__suzanneLocalDb = (async () => {
    const db = new PGlite();
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');
    const names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort();
    for (const name of names) await db.exec(fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'));
    return db;
  })();
}
