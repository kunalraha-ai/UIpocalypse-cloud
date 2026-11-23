import type pg from 'pg';
import type { OAuthIdentity, OAuthProvider } from './oauth.ts';

/** All user/session SQL lives here — parameterized, tenant-minimal for P1. */

export type UserRow = {
  id: string | bigint;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

/** Find-or-create the user behind a provider identity. Returns the user and
 *  whether the account was created in this call (signup). */
export async function upsertOAuthUser(
  pool: pg.Pool,
  input: { provider: OAuthProvider; identity: OAuthIdentity },
): Promise<{ user: UserRow; isNewUser: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ user_id: string }>(
      'SELECT user_id FROM oauth_identities WHERE provider = $1 AND provider_account_id = $2',
      [input.provider, input.identity.providerAccountId],
    );
    if (existing.rows.length > 0) {
      const userId = existing.rows[0]!.user_id;
      await client.query('COMMIT');
      const user = await client.query<UserRow>('SELECT id, email, display_name, avatar_url FROM users WHERE id = $1', [userId]);
      return { user: user.rows[0]!, isNewUser: false };
    }
    const email = input.identity.email ?? `${input.provider}-${input.identity.providerAccountId}@users.noreply.uipocalypse.invalid`;
    let userId: string;
    const byEmail = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (byEmail.rows.length > 0) {
      userId = byEmail.rows[0]!.id;
    } else {
      const created = await client.query<{ id: string }>(
        'INSERT INTO users (email, display_name, avatar_url) VALUES ($1, $2, $3) RETURNING id',
        [email, input.identity.displayName, input.identity.avatarUrl],
      );
      userId = created.rows[0]!.id;
    }
    await client.query(
      'INSERT INTO oauth_identities (user_id, provider, provider_account_id, provider_account_created_at) VALUES ($1, $2, $3, $4)',
      [userId, input.provider, input.identity.providerAccountId, input.identity.accountCreatedAt],
    );
    await client.query('COMMIT');
    const user = await client.query<UserRow>('SELECT id, email, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    return { user: user.rows[0]!, isNewUser: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function createSession(pool: pg.Pool, userId: string | bigint, sessionId: string, expiresAt: Date): Promise<void> {
  await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [sessionId, userId, expiresAt]);
}

export async function getSessionUser(pool: pg.Pool, sessionId: string): Promise<UserRow | null> {
  const res = await pool.query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.avatar_url
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  return res.rows[0] ?? null;
}

export async function deleteSession(pool: pg.Pool, sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
