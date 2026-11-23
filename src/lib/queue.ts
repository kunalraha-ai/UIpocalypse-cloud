import PgBoss from 'pg-boss';
import type { AppConfig } from '../../config/app-config.ts';

/**
 * pg-boss wrapper. The Next app ENQUEUES; the separate worker process
 * DEQUEUES and executes. Nothing heavy ever runs inside the web process.
 */

export const SCAN_QUEUE = 'scan';

let boss: PgBoss | null = null;

export async function getBoss(config: AppConfig): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({ connectionString: config.databaseUrl });
    boss.on('error', (e) => console.error('queue error:', e));
    await boss.start();
    // v10: queues are first-class — create (idempotent) before use. The DLQ
    // must exist first (FK), so create it before referencing it.
    await boss.createQueue(`${SCAN_QUEUE}Dlq`).catch(() => undefined);
    await boss.createQueue(SCAN_QUEUE, { name: SCAN_QUEUE, deadLetter: `${SCAN_QUEUE}Dlq` });
  }
  return boss;
}

export type ScanJobPayload = {
  runId: number;
  projectId: number;
  url: string;
  maxPages: number;
  maxDepth: number;
  trigger: 'manual' | 'schedule' | 'api' | 'ci';
};

export async function enqueueScan(config: AppConfig, payload: ScanJobPayload): Promise<string | number> {
  const b = await getBoss(config);
  const id = await b.send(SCAN_QUEUE, payload, { priority: 1 });
  return id ?? '';
}

/** test hook */
export function resetBoss(): void {
  boss = null;
}
