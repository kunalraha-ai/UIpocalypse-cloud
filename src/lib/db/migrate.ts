import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';

/**
 * Hand-rolled SQL migrations: numbered files in migrations/, applied in order,
 * recorded in schema_migrations, one transaction each. No ORM, no magic —
 * the schema is readable SQL.
 */

export async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

export async function appliedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const res = await client.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
  return new Set(res.rows.map((r) => r.id));
}

/** Apply every pending migration in migrationsDir. Returns the applied ids. */
export async function applyMigrations(pool: pg.Pool, migrationsDir: string): Promise<string[]> {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{3}-.*\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const client = await pool.connect();
    try {
      await ensureMigrationsTable(client);
      const done = await client.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [id]);
      if (done.rows.length > 0) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      await client.query('COMMIT');
      applied.push(id);
      console.log(`migration applied: ${id}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`migration ${id} failed: ${String(e)}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
