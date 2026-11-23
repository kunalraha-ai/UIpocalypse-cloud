import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque server-side sessions: the cookie carries only a random id; state
 * lives in Postgres (sessions table). The id is additionally HMAC-signed so
 * a tampered cookie fails closed before we even hit the DB.
 */

export const SESSION_COOKIE = 'uipoc_session';

export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

export function signSessionId(id: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(id).digest('base64url');
  return `${id}.${mac}`;
}

/** constant-time verification; returns the id or null */
export function verifySignedSession(cookie: string, secret: string): string | null {
  const dot = cookie.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(id).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export const SESSION_TTL_DAYS = 30;

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
}
