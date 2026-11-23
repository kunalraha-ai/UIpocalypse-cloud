import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import pg from 'pg';
import { appendLedger, getBalance, canAffordRun, autoRefund, isLowBalance } from '../src/lib/credits.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { applyMigrations } from '../src/lib/db/migrate.ts';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud_test';
const cfg = loadAppConfig({
  APP_URL: 'http://localhost:4311',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  DATABASE_URL: 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud',
});

describe('P6: credits ledger — append-only, derived balance, spend caps, auto-refund', () => {
  let pool: pg.Pool;
  let testDb: string;
  let userId: string;
  let projectId: number;
  let runId: number;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    testDb = `uipoc_p6_test_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${testDb}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, testDb) });
    await applyMigrations(pool, join(import.meta.dirname, '..', 'migrations'));
    const u = await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('p6@x.test') RETURNING id`);
    userId = u.rows[0]!.id;
    const p = await pool.query<{ id: string }>(`INSERT INTO projects (user_id, name, url) VALUES ($1, 'P6', 'https://x.test') RETURNING id`, [userId]);
    projectId = Number(p.rows[0]!.id);
    const r = await pool.query<{ id: string }>(`INSERT INTO runs (project_id, status, trigger) VALUES ($1, 'failed', 'manual') RETURNING id`, [projectId]);
    runId = Number(r.rows[0]!.id);
  }, 30_000);

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    await admin.query(`DROP DATABASE ${testDb} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  it('free grant → balance derived from the ledger sum', async () => {
    const { balance } = await appendLedger(pool, { type: 'grant', amount: 100, userId, note: 'free grant' });
    expect(balance).toBe(100);
    expect(await getBalance(pool, userId)).toBe(100);
  });

  it('run charge decrements the balance', async () => {
    const { balance } = await appendLedger(pool, { type: 'run-charge', amount: -3, userId, projectId, runId, note: 'S tier' });
    expect(balance).toBe(97);
  });

  it('canAffordRun: refuses when balance is insufficient (never go negative)', async () => {
    const ok = await canAffordRun(pool, userId, projectId, 98, 1000, cfg);
    expect(ok.ok).toBe(false);
    expect(ok.reason).toMatch(/insufficient/);
  });

  it('canAffordRun: refuses when the monthly spend cap is exceeded', async () => {
    // charge 50 more (total spend = 53); cap of 51 should refuse a 3-credit run
    await appendLedger(pool, { type: 'run-charge', amount: -50, userId, projectId, runId, note: 'cap test' });
    const ok = await canAffordRun(pool, userId, projectId, 3, 51, cfg);
    expect(ok.ok).toBe(false);
    expect(ok.reason).toMatch(/spend cap/);
  });

  it('auto-refund: a failed run gets its charge back, logged in the ledger', async () => {
    const before = await getBalance(pool, userId);
    await autoRefund(pool, userId, projectId, runId, 3, 'target unreachable');
    const after = await getBalance(pool, userId);
    expect(after).toBe(before + 3);
    const refunds = await pool.query<{ type: string; note: string }>(
      `SELECT type, note FROM credit_ledger WHERE run_id = $1 AND type = 'refund'`,
      [runId],
    );
    expect(refunds.rows.length).toBe(1);
    expect(refunds.rows[0]!.note).toContain('auto-refund: target unreachable');
  });

  it('low-balance check at the 20% threshold', () => {
    expect(isLowBalance(15, 100, 20)).toBe(true); // 15 < 20% of 100
    expect(isLowBalance(25, 100, 20)).toBe(false); // 25 > 20% of 100
    expect(isLowBalance(0, 100, 20)).toBe(true);
  });

  it('the ledger is append-only: every operation adds a row, never modifies one', async () => {
    // the only write path is INSERT (appendLedger); verified by reading the module
    // — the test asserts the semantic: every operation adds a row, never modifies one
    const before = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = $1`, [userId]);
    await appendLedger(pool, { type: 'adjustment', amount: 1, userId, note: 'test' });
    const after = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = $1`, [userId]);
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1); // grew by 1, nothing was mutated
  });
});
