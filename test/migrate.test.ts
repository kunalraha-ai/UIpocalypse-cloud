import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../src/lib/db/migrate.ts';

/**
 * Migration runner contract: applies in order, records what ran, is
 * idempotent (re-run applies nothing), and a failing migration rolls back
 * completely. Runs against the docker-compose Postgres (see README).
 */

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud_test';
const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

describe('migration runner (integration)', () => {
  let pool: pg.Pool;
  let testDb: string;

  beforeAll(async () => {
    // fresh, isolated test database per run
    const admin = new pg.Pool({ connectionString: DB.replace(/\/[^/]*$/, '/postgres') });
    testDb = `uipoc_migration_test_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${testDb}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: DB.replace(/\/[^/]*$/, `/${testDb}`) });
  });

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    await admin.query(`DROP DATABASE ${testDb} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  it('applies the real migrations in order and is idempotent on re-run', async () => {
    const first = await applyMigrations(pool, MIGRATIONS);
    expect(first.length).toBeGreaterThan(0); // the real 001-foundation ran
    expect(first[0]).toMatch(/^001/);
    const again = await applyMigrations(pool, MIGRATIONS);
    expect(again).toEqual([]); // nothing re-applies

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const expected of ['users', 'oauth_identities', 'sessions', 'projects', 'runs', 'schema_migrations']) {
      expect(names).toContain(expected);
    }
  });

  it('a failing migration rolls back atomically', async () => {
    // a migration dir with a SQL syntax error must leave NOTHING behind
    const badDir = join(import.meta.dirname, 'fixtures', 'bad-migrations');
    await expect(applyMigrations(pool, badDir)).rejects.toThrow(/migration .* failed/);
    const res = await pool.query(`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE id LIKE '999%'`);
    expect(res.rows[0]!.n).toBe(0);
  });
});
