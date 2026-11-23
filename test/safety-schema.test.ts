import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../src/lib/db/migrate.ts';

/**
 * Safety schema contract: one verified owner per domain (the DB is the
 * enforcement floor, not just app code), denylist and kill switches exist.
 */

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud_test';

describe('migration 002 — safety schema', () => {
  let pool: pg.Pool;
  let testDb: string;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    testDb = `uipoc_safety_test_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${testDb}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, testDb) });
    await applyMigrations(pool, join(import.meta.dirname, '..', 'migrations'));
  });

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    await admin.query(`DROP DATABASE ${testDb} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  it('a domain can only have ONE verified owner — the second insert is refused', async () => {
    const u1 = await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('first@x.test') RETURNING id`);
    const u2 = await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('second@x.test') RETURNING id`);
    await pool.query(
      `INSERT INTO domain_verifications (domain, user_id, token, method) VALUES ('site.test', $1, 'tok', 'well-known')`,
      [u1.rows[0]!.id],
    );
    await expect(
      pool.query(`INSERT INTO domain_verifications (domain, user_id, token, method) VALUES ('site.test', $1, 'tok2', 'meta-tag')`, [u2.rows[0]!.id]),
    ).rejects.toThrow();
  });

  it('users carry the kill switch', async () => {
    const col = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='disabled'`);
    expect(col.rows.length).toBe(1);
  });

  it('denied domains are unique', async () => {
    await pool.query(`INSERT INTO denied_domains (domain, reason) VALUES ('bad.test', 'abuse report')`);
    await expect(pool.query(`INSERT INTO denied_domains (domain, reason) VALUES ('bad.test', 'again')`)).rejects.toThrow();
  });
});
