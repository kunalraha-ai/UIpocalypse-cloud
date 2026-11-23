import type pg from 'pg';
import type { AppConfig } from '../../config/app-config.ts';

/**
 * Credits ledger (master prompt §6): append-only. Every entry is a grant,
 * purchase, run charge, refund, expiry, or adjustment. Balance = derived sum.
 * All money values from CONFIG. Auto-refund on infrastructure failures.
 * Per-project monthly spend cap. Low-balance at 20%. Never go negative.
 */

export type LedgerEntry = {
  type: 'grant' | 'purchase' | 'run-charge' | 'refund' | 'expiry' | 'adjustment';
  amount: number; // positive = add credit, negative = consume
  userId: string;
  projectId?: number;
  runId?: number;
  note?: string;
};

export async function appendLedger(pool: pg.Pool, entry: LedgerEntry): Promise<{ id: number; balance: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock the user's ledger rows for a consistent balance
    await client.query('SELECT pg_advisory_xact_lock($1)', [Number(entry.userId)]);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO credit_ledger (user_id, project_id, run_id, type, amount, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [entry.userId, entry.projectId ?? null, entry.runId ?? null, entry.type, entry.amount, entry.note ?? null],
    );
    const bal = await client.query<{ balance: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE user_id = $1`,
      [entry.userId],
    );
    await client.query('COMMIT');
    return { id: Number(ins.rows[0]!.id), balance: Number(bal.rows[0]!.balance) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getBalance(pool: pg.Pool, userId: string): Promise<number> {
  const res = await pool.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger WHERE user_id = $1`,
    [userId],
  );
  return Number(res.rows[0]!.balance);
}

/** Check a run charge against balance + spend cap. Never go negative. */
export async function canAffordRun(pool: pg.Pool, userId: string, projectId: number, priceCredits: number, monthlyCap: number, cfg: AppConfig): Promise<{ ok: boolean; reason?: string }> {
  const bal = await getBalance(pool, userId);
  if (bal < priceCredits) return { ok: false, reason: `insufficient credits: ${bal} < ${priceCredits}` };
  const monthSpend = await pool.query<{ spent: string }>(
    `SELECT COALESCE(SUM(-amount), 0) AS spent FROM credit_ledger
     WHERE user_id = $1 AND project_id = $2 AND type = 'run-charge' AND created_at > now() - interval '30 days'`,
    [userId, projectId],
  );
  const spent = Number(monthSpend.rows[0]!.spent);
  if (spent + priceCredits > monthlyCap) return { ok: false, reason: `monthly spend cap: ${spent} + ${priceCredits} > ${monthlyCap}` };
  void cfg;
  return { ok: true };
}

/** Auto-refund on a run that failed through no fault of the user. */
export async function autoRefund(pool: pg.Pool, userId: string, projectId: number, runId: number, priceCredits: number, reason: string): Promise<void> {
  await appendLedger(pool, { type: 'refund', amount: priceCredits, userId, projectId, runId, note: `auto-refund: ${reason}` });
}

/** Low-balance check (20% threshold from config). */
export function isLowBalance(balance: number, freeGrant: number, thresholdPct: number): boolean {
  return balance < (freeGrant * thresholdPct) / 100;
}
