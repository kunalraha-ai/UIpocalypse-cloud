import { processConfig } from '../config/app-config.ts';
import { SCAN_QUEUE, getBoss, type ScanJobPayload } from '../src/lib/queue.ts';
import pg from 'pg';

/**
 * The worker process: subscribes to the scan queue. P1 ships the no-op
 * handler — P2/P3 replace `handleScan` with the real (safety-gated) engine.
 * Runs outside Next: `npm run worker`.
 */

async function handleScan(payload: ScanJobPayload): Promise<void> {
  console.log(`[worker] scan run #${payload.runId} for project ${payload.projectId} (${payload.url}) — P1 no-op`);
  const pool = new pg.Pool({ connectionString: processConfig().databaseUrl });
  try {
    await pool.query(
      `UPDATE runs SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued'`,
      [payload.runId],
    );
    // P1 gate: a no-op job runs END TO END — queued → running → completed.
    // The real engine arrives in P3; until then the run honestly reports
    // itself as a no-op in summary_json.
    await pool.query(
      `UPDATE runs SET status = 'completed', finished_at = now(),
         summary_json = $2 WHERE id = $1`,
      [payload.runId, JSON.stringify({ noop: true, note: 'P1 foundations gate — the scan engine arrives in P3' })],
    );
  } finally {
    await pool.end();
  }
}

const config = processConfig();
const boss = await getBoss(config);
await boss.work<ScanJobPayload>(SCAN_QUEUE, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) {
    try {
      await handleScan(job.data);
    } catch (e) {
      console.error(`[worker] run ${job.data.runId} failed:`, e);
      const pool = new pg.Pool({ connectionString: config.databaseUrl });
      await pool
        .query(`UPDATE runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [
          job.data.runId,
          String(e).slice(0, 500),
        ])
        .catch(() => undefined)
        .finally(() => pool.end());
    }
  }
});
console.log(`[worker] subscribed to '${SCAN_QUEUE}' (concurrency ${config.queue.workerConcurrency})`);
