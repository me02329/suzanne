import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { LocalMigrationError, migrateWithBackup, type Migration } from './migrate';

// Base de départ : schéma minimal + une donnée utilisateur à protéger.
async function startDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE _suzanne_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE ops (id serial PRIMARY KEY, label text NOT NULL);
    INSERT INTO _suzanne_migrations (name) VALUES ('001_init');
    INSERT INTO ops (label) VALUES ('Boulangerie'), ('Loyer');
  `);
  return db;
}

const labels = async (db: PGlite) => (await db.query<{ label: string }>('SELECT label FROM ops ORDER BY id')).rows.map((r) => r.label);
const appliedNames = async (db: PGlite) => (await db.query<{ name: string }>('SELECT name FROM _suzanne_migrations ORDER BY name')).rows.map((r) => r.name);

describe('migrations du mode local', () => {
  it('applique les migrations en attente, dans l’ordre, après une copie de sécurité', async () => {
    const db = await startDb();
    const backups: Array<{ size: number; pending: string[] }> = [];
    const all: Migration[] = [
      { name: '003_note', sql: 'ALTER TABLE ops ADD COLUMN note text' },
      { name: '001_init', sql: 'SELECT 1' },
      { name: '002_montant', sql: 'ALTER TABLE ops ADD COLUMN amount numeric NOT NULL DEFAULT 0' },
    ];
    const { applied } = await migrateWithBackup(db, all, {
      keepBackup: async (dump, pending) => { backups.push({ size: dump.size, pending }); },
      restore: async () => { throw new Error('ne doit pas restaurer'); },
    });
    expect(applied).toEqual(['002_montant', '003_note']);
    expect(backups).toHaveLength(1);
    expect(backups[0]!.pending).toEqual(['002_montant', '003_note']);
    expect(backups[0]!.size).toBeGreaterThan(0);
    expect(await appliedNames(db)).toEqual(['001_init', '002_montant', '003_note']);
    expect(await labels(db)).toEqual(['Boulangerie', 'Loyer']);
  });

  it('rien à faire : ni copie, ni migration', async () => {
    const db = await startDb();
    let copies = 0;
    const { applied } = await migrateWithBackup(db, [{ name: '001_init', sql: 'SELECT 1' }], {
      keepBackup: async () => { copies += 1; },
      restore: async () => { throw new Error('ne doit pas restaurer'); },
    });
    expect(applied).toEqual([]);
    expect(copies).toBe(0);
  });

  it('une migration en échec restaure la base d’avant la mise à jour, données comprises', async () => {
    const db = await startDb();
    let restored: PGlite | null = null;
    const all: Migration[] = [
      { name: '002_ok', sql: "ALTER TABLE ops ADD COLUMN amount numeric NOT NULL DEFAULT 0; UPDATE ops SET label = label || ' (migré)'" },
      { name: '003_casse', sql: 'ALTER TABLE table_absente ADD COLUMN x int' },
    ];
    const error = await migrateWithBackup(db, all, {
      keepBackup: async () => {},
      restore: async (dump) => { restored = await PGlite.create({ loadDataDir: dump }); return restored; },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LocalMigrationError);
    expect((error as LocalMigrationError).migration).toBe('003_casse');
    expect((error as Error).message).toMatch(/restaurées telles qu'avant la mise à jour/);
    // La base restaurée est celle d'avant : ni la migration réussie du lot, ni ses effets.
    expect(restored).not.toBeNull();
    expect(await appliedNames(restored!)).toEqual(['001_init']);
    expect(await labels(restored!)).toEqual(['Boulangerie', 'Loyer']);
    const columns = (await restored!.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'ops'")).rows.map((r) => r.column_name);
    expect(columns).not.toContain('amount');
  });
});
