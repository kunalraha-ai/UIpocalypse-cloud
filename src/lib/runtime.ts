import pg from 'pg';
import { cookies } from 'next/headers';
import { processConfig, type AppConfig } from '../../config/app-config.ts';
import { SESSION_COOKIE, verifySignedSession } from './auth/session.ts';
import { getSessionUser, type UserRow } from './auth/users.ts';

/**
 * Config + DB singletons for the Next.js runtime. The worker and scripts
 * construct their own.
 */

let cachedConfig: AppConfig | null = null;

export function appConfig(): AppConfig {
  if (!cachedConfig) cachedConfig = processConfig();
  return cachedConfig;
}

let cachedPool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!cachedPool) {
    cachedPool = new pg.Pool({ connectionString: appConfig().databaseUrl, max: 10 });
  }
  return cachedPool;
}

/** read the signed session cookie → user row, or null */
export async function currentUser(): Promise<UserRow | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  const id = verifySignedSession(cookie, appConfig().sessionSecret);
  if (!id) return null;
  return getSessionUser(db(), id);
}
