import type { PGlite } from '@electric-sql/pglite';

// Mode local (ADR 0011) : migrations appliquées sur le téléphone après une mise
// à jour de l'app, avec filet de sécurité. Avant la première migration en
// attente, une copie complète de la base est faite (et confiée à `keepBackup`,
// qui la conserve hors de la base). Si une migration échoue, la base est
// restaurée depuis cette copie : on ne laisse jamais une base à moitié migrée.
//
// Indépendant du navigateur (stockage et restauration injectés) : testé sous
// Node avec une vraie base PGlite (migrate.test.ts).

export interface Migration { name: string; sql: string }

export interface MigrateOptions {
  /** Conserve la copie de sécurité (ex. IndexedDB), avec les migrations à venir. */
  keepBackup: (dump: Blob, pending: string[]) => Promise<void>;
  /** Recrée une base à partir de la copie (remplace la base courante). */
  restore: (dump: Blob) => Promise<PGlite>;
  /** Écrit la base migrée sur le disque et attend la fin (par défaut : db.syncToFs). */
  flush?: (db: PGlite) => Promise<void>;
}

export interface MigrateResult {
  db: PGlite;
  applied: string[];
}

export class LocalMigrationError extends Error {
  constructor(public readonly migration: string, public readonly cause: unknown) {
    super(`La mise à jour de la base (${migration}) a échoué ; tes données ont été restaurées telles qu'avant la mise à jour.`);
    this.name = 'LocalMigrationError';
  }
}

export async function pendingMigrations(db: PGlite, all: Migration[]): Promise<Migration[]> {
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM _suzanne_migrations')).rows.map((r) => r.name));
  return [...all].sort((a, b) => a.name.localeCompare(b.name)).filter((m) => !applied.has(m.name));
}

export async function migrateWithBackup(db: PGlite, all: Migration[], options: MigrateOptions): Promise<MigrateResult> {
  const pending = await pendingMigrations(db, all);
  if (pending.length === 0) return { db, applied: [] };

  // Copie de sécurité AVANT de toucher au schéma ou aux données.
  const dump = await db.dumpDataDir('gzip');
  await options.keepBackup(dump, pending.map((m) => m.name));

  const applied: string[] = [];
  for (const migration of pending) {
    try {
      // La migration et son enregistrement réussissent ou échouent ensemble.
      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.query('INSERT INTO _suzanne_migrations (name) VALUES ($1)', [migration.name]);
      });
      applied.push(migration.name);
    } catch (error) {
      // Les migrations précédentes de ce lot sont déjà validées : on revient à
      // l'état d'avant la mise à jour, en entier.
      await db.close().catch(() => {});
      await options.restore(dump);
      throw new LocalMigrationError(migration.name, error);
    }
  }
  await (options.flush ? options.flush(db) : db.syncToFs());
  return { db, applied };
}
