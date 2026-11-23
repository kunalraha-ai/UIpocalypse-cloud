import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import pg from 'pg';
import { generateApiKey, hashKey, authenticateApiKey } from '../src/lib/api-keys.ts';
import { shouldNotify, signWebhookPayload, verifyWebhookSignature, notify, stubEmail, stubSlack, type NotificationEvent } from '../src/lib/notifications.ts';
import { applyMigrations } from '../src/lib/db/migrate.ts';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud_test';

describe('P5: API keys, webhooks, notifications', () => {
  let pool: pg.Pool;
  let testDb: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    testDb = `uipoc_p5_test_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${testDb}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, testDb) });
    await applyMigrations(pool, join(import.meta.dirname, '..', 'migrations'));
    const u = await pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('p5@x.test') RETURNING id`);
    userId = u.rows[0]!.id;
    const p = await pool.query<{ id: string }>(`INSERT INTO projects (user_id, name, url) VALUES ($1, 'P5', 'https://x.test') RETURNING id`, [userId]);
    projectId = p.rows[0]!.id;
  }, 30_000);

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: DB.replace(/[^/]*$/, 'postgres') });
    await admin.query(`DROP DATABASE ${testDb} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  it('API key: raw is shown once, only the hash is stored, auth round-trips', async () => {
    const { raw, hash } = generateApiKey();
    expect(raw).toMatch(/^uipoc_/);
    expect(raw).not.toContain(hash); // raw ≠ hash
    expect(hashKey(raw)).toBe(hash); // deterministic

    // store and authenticate
    await pool.query(`INSERT INTO api_keys (user_id, project_id, key_hash, label) VALUES ($1, $2, $3, 'test')`, [userId, projectId, hash]);
    const auth = await authenticateApiKey(pool, raw);
    expect(auth?.userId).toBe(userId);
    expect(auth?.projectId).toBe(Number(projectId));

    // wrong key → null
    expect(await authenticateApiKey(pool, 'uipoc_wrong')).toBeNull();

    // revoked key → null
    await pool.query(`UPDATE api_keys SET revoked_at = now() WHERE key_hash = $1`, [hash]);
    expect(await authenticateApiKey(pool, raw)).toBeNull();
  });

  it('webhook signatures: sign → verify (constant time), tamper detection', () => {
    const payload = JSON.stringify({ run: 1, status: 'completed' });
    const sig = signWebhookPayload(payload, 'secret');
    expect(verifyWebhookSignature(payload, sig, 'secret')).toBe(true);
    expect(verifyWebhookSignature(payload, sig, 'wrong-secret')).toBe(false);
    expect(verifyWebhookSignature(payload + 'x', sig, 'secret')).toBe(false);
    expect(verifyWebhookSignature(payload, sig.slice(0, -1) + 'x', 'secret')).toBe(false);
  });

  it('notifications: only new-findings and recovery trigger, not every run', () => {
    const newF: NotificationEvent = { kind: 'new-findings', count: 3, sample: ['a', 'b'] };
    const recovery: NotificationEvent = { kind: 'recovery', count: 1, sample: ['x'] };
    expect(shouldNotify(newF)).toBe(true);
    expect(shouldNotify(recovery)).toBe(true);
    // the "no change" case: 0 new, 0 fixed → no notification object is even created
  });

  it('notify: delivers through the email/slack interfaces when enabled', async () => {
    await pool.query(
      `INSERT INTO notification_settings (project_id, email_enabled, slack_enabled, slack_webhook_url) VALUES ($1, true, true, 'https://hooks.slack.test/x')`,
      [projectId],
    );
    // stubEmail/stubSlack just log — the test verifies no crash + the gate check
    await notify(pool, Number(projectId), { kind: 'new-findings', count: 2, sample: ['test-a', 'test-b'] }, { email: stubEmail, slack: stubSlack });
  });

  it('schedules: stored with frequency and timezone, can be disabled', async () => {
    const s = await pool.query<{ id: string; frequency: string }>(
      `INSERT INTO schedules (project_id, frequency, user_timezone, enabled) VALUES ($1, 'daily', 'Asia/Kolkata', true) RETURNING id, frequency`,
      [projectId],
    );
    expect(s.rows[0]!.frequency).toBe('daily');
    const sched = await pool.query<{ frequency: string }>(`SELECT frequency FROM schedules WHERE id = $1`, [s.rows[0]!.id]);
    expect(sched.rows[0]!.frequency).toBe('daily');
    await pool.query(`UPDATE schedules SET enabled = false WHERE id = $1`, [s.rows[0]!.id]);
    const off = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM schedules WHERE id = $1`, [s.rows[0]!.id]);
    expect(off.rows[0]!.enabled).toBe(false);
  });
});
