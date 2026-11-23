import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { getBoss, enqueueScan, SCAN_QUEUE, resetBoss, type ScanJobPayload } from '../src/lib/queue.ts';
import { loadAppConfig } from '../config/app-config.ts';
import { applyMigrations } from '../src/lib/db/migrate.ts';
import { join } from 'node:path';

/**
 * THE P1 GATE: a no-op job runs end to end — enqueued by the web path,
 * consumed by a worker handler, run row goes queued → running → completed,
 * with the honest noop summary. Against real Postgres + real pg-boss.
 */

const ENV = {
  APP_URL: 'http://localhost:4311',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  DATABASE_URL: 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud',
};
const config = loadAppConfig(ENV);

describe('P1 gate: no-op scan job end to end', () => {
  let pool: pg.Pool;
  let testDb: string;
  let testPool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ENV.DATABASE_URL.replace(/[^/]*$/, 'postgres') });
    testDb = `uipoc_queue_test_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${testDb}`);
    await admin.end();
    testPool = new pg.Pool({ connectionString: ENV.DATABASE_URL.replace(/[^/]*$/, testDb) });
    await applyMigrations(testPool, join(import.meta.dirname, '..', 'migrations'));
    pool = testPool;
  });

  afterAll(async () => {
    resetBoss();
    await testPool.end();
    const admin = new pg.Pool({ connectionString: ENV.DATABASE_URL.replace(/[^/]*$/, 'postgres') });
    await admin.query(`DROP DATABASE ${testDb} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  it('queued job → worker handler → run row completes with the honest noop summary', async () => {
    // arrange: user, project, queued run
    const user = await pool.query<{ id: string }>(
      'INSERT INTO users (email) VALUES ($1) RETURNING id',
      ['gate@example.test'],
    );
    const userId = user.rows[0]!.id;
    const project = await pool.query<{ id: string }>(
      'INSERT INTO projects (user_id, name, url) VALUES ($1, $2, $3) RETURNING id',
      [userId, 'Gate fixture', 'https://example.test/'],
    );
    const projectId = Number(project.rows[0]!.id);
    const run = await pool.query<{ id: string }>(
      'INSERT INTO runs (project_id, status, trigger) VALUES ($1, $2, $3) RETURNING id',
      [projectId, 'queued', 'manual'],
    );
    const runId = Number(run.rows[0]!.id);

    // act: enqueue through the same function the web route uses
    const cfg = { ...config, databaseUrl: ENV.DATABASE_URL.replace(/[^/]*$/, testDb) };
    const jobId = await enqueueScan(cfg, {
      runId,
      projectId,
      url: 'https://example.test/',
      maxPages: 25,
      maxDepth: 3,
      trigger: 'manual',
    });
    expect(jobId).toBeTruthy();

    // consume with the worker's contract (same as worker/worker.ts)
    const boss = await getBoss(cfg);
    await boss.work<ScanJobPayload>(SCAN_QUEUE, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        await pool.query('UPDATE runs SET status = $2, started_at = now() WHERE id = $1 AND status = $3', [job.data.runId, 'running', 'queued']);
        await pool.query(
          'UPDATE runs SET status = $2, finished_at = now(), summary_json = $3 WHERE id = $1',
          [job.data.runId, 'completed', JSON.stringify({ noop: true, note: 'P1 gate' })],
        );
      }
    });

    // assert: the run row reached completed with the noop summary
    let row: { status: string; summary_json: { noop?: boolean } } | undefined;
    for (let i = 0; i < 30; i++) {
      const res = await pool.query('SELECT status, summary_json FROM runs WHERE id = $1', [runId]);
      row = res.rows[0] as { status: string; summary_json: { noop?: boolean } } | undefined;
      if (row?.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(row?.status).toBe('completed');
    expect(row?.summary_json?.noop).toBe(true);
  }, 60_000);
});
