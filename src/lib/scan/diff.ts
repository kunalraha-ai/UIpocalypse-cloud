import type pg from 'pg';
import type { Finding } from '../scan/fingerprint.ts';

/**
 * History and diff (master prompt §4): compare runs by fingerprint.
 * - fixed: absent in 2 CONSECUTIVE runs
 * - new: first appearance
 * - still-failing: present in all compared runs
 * - intermittent: present in some but not all
 * Zero phantom changes on identical runs.
 */

export type RunDiff = {
  runs: number[];
  new: Finding[];
  stillFailing: Finding[];
  fixed: Finding[];
  intermittent: Finding[];
  phantoms: string[]; // must be empty on identical runs
};

export async function storeFindings(pool: pg.Pool, runId: number, findings: Finding[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of findings) {
      await client.query(
        `INSERT INTO findings (run_id, fingerprint, type, severity, url, message, evidence_json, fix_hint, count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [runId, f.fingerprint, f.type, f.severity, f.url, f.message, JSON.stringify(f.evidence), f.fixHint, (f.evidence.count as number) ?? 1],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function diffRuns(pool: pg.Pool, runIds: number[]): Promise<RunDiff> {
  if (runIds.length < 2) throw new Error('diff needs at least 2 run ids, oldest first');

  // fetch findings per run
  const perRun: Map<number, Map<string, Finding>> = new Map();
  for (const id of runIds) {
    const res = await pool.query(
      'SELECT fingerprint, type, severity, url, message, evidence_json, fix_hint FROM findings WHERE run_id = $1',
      [id],
    );
    const map = new Map<string, Finding>();
    for (const row of res.rows as Array<Record<string, unknown>>) {
      const ev = typeof row.evidence_json === 'string' ? JSON.parse(row.evidence_json as string) : (row.evidence_json ?? {});
      map.set(row.fingerprint as string, {
        fingerprint: row.fingerprint as string,
        type: row.type as string,
        severity: row.severity as 'low' | 'medium' | 'high',
        url: row.url as string,
        message: row.message as string,
        evidence: ev as Record<string, unknown>,
        fixHint: row.fix_hint as string,
      });
    }
    perRun.set(id, map);
  }

  const allFingerprints = new Set<string>();
  for (const m of perRun.values()) for (const fp of m.keys()) allFingerprints.add(fp);

  const diff: RunDiff = { runs: runIds, new: [], stillFailing: [], fixed: [], intermittent: [], phantoms: [] };
  const oldest = perRun.get(runIds[0]!)!;
  const newest = perRun.get(runIds[runIds.length - 1]!)!;

  for (const fp of allFingerprints) {
    const presentIn: number[] = [];
    for (const [id, map] of perRun) {
      if (map.has(fp)) presentIn.push(id);
    }
    const f = newest.get(fp) ?? oldest.get(fp)!;

    if (presentIn.length === 0) {
      diff.phantoms.push(fp); // a fingerprint in the union but no run — impossible
      continue;
    }

    const inOldest = oldest.has(fp);
    const inNewest = newest.has(fp);

    if (!inOldest && inNewest) {
      diff.new.push(f);
    } else if (inOldest && !inNewest) {
      // "fixed" only after absence in 2 CONSECUTIVE runs
      const lastTwo = runIds.slice(-2);
      const absentFromBoth = lastTwo.every((id) => !perRun.get(id)!.has(fp));
      if (absentFromBoth) {
        diff.fixed.push(f);
      } else {
        diff.intermittent.push(f);
      }
    } else if (inOldest && inNewest) {
      if (presentIn.length === runIds.length) {
        diff.stillFailing.push(f);
      } else {
        diff.intermittent.push(f);
      }
    } else {
      // in neither oldest nor newest — appeared and disappeared mid-sequence
      diff.intermittent.push(f);
    }
  }

  return diff;
}
