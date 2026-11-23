import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * API keys (master prompt §5): hashed storage, scoped per project.
 * The raw key is shown once; only the SHA-256 hash is stored.
 */

export function generateApiKey(): { raw: string; hash: string } {
  const raw = `uipoc_${randomBytes(24).toString('base64url')}`;
  return { raw, hash: hashKey(raw) };
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function authenticateApiKey(pool: pg.Pool, rawKey: string): Promise<{ userId: string; projectId?: number } | null> {
  const hash = hashKey(rawKey);
  const res = await pool.query<{ user_id: string; project_id: string | null }>(
    'SELECT user_id, project_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [hash],
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0]!;
  return { userId: row.user_id, projectId: row.project_id !== null ? Number(row.project_id) : undefined };
}
