import { randomBytes } from 'node:crypto';
import { safeFetch, type SafeFetchOptions } from '../safe-fetch/safe-fetch.ts';
import { loadAppConfig } from '../../../config/app-config.ts';

/**
 * Domain ownership verification (master prompt §7): prove the user controls
 * the domain before full crawling. Methods: /.well-known/uipocalypse.txt,
 * an HTML meta tag, or DNS TXT (added in P3 with the DNS plumbing). One
 * verified owner per domain (enforced by the DB store, P2 migration 002).
 * Unverified domains: single page, no scheduling.
 */

export function issueVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

export type VerificationMethod = 'well-known' | 'meta-tag' | 'dns-txt';
export type VerificationState = 'unverified' | 'verified';

/** Fetch helper scoped to this module (SSRF-guarded). */
async function guardedFetch(url: string, opts?: SafeFetchOptions): Promise<Response | null> {
  try {
    const res = await safeFetch(url, opts);
    if (res.status >= 400) return null;
    return res;
  } catch {
    return null;
  }
}

/** /.well-known/uipocalypse.txt must contain exactly the token. */
export async function checkWellKnown(origin: string, token: string, opts?: SafeFetchOptions): Promise<boolean> {
  const res = await guardedFetch(new URL('/.well-known/uipocalypse.txt', origin).toString(), opts);
  if (!res) return false;
  const text = (await res.text().catch(() => '')).trim();
  return text === token.trim();
}

/** <meta name="uipocalypse-verification" content="TOKEN"> on the homepage. */
export async function checkMetaTag(url: string, token: string, opts?: SafeFetchOptions): Promise<boolean> {
  const res = await guardedFetch(url, opts);
  if (!res) return false;
  const html = await res.text().catch(() => '');
  const m = /<meta\s+[^>]*name=["']uipocalypse-verification["'][^>]*content=["']([^"']+)["']/i.exec(html);
  const m2 = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']uipocalypse-verification["']/i.exec(html);
  const found = m?.[1] ?? m2?.[1];
  return Boolean(found && found.trim() === token.trim());
}

/** Try well-known first, then meta tag. DNS TXT arrives in P3. */
export async function verifyDomainOwnership(
  origin: string,
  token: string,
  opts?: SafeFetchOptions,
): Promise<{ verified: boolean; method?: VerificationMethod }> {
  if (await checkWellKnown(origin, token, opts)) return { verified: true, method: 'well-known' };
  if (await checkMetaTag(origin, token, opts)) return { verified: true, method: 'meta-tag' };
  return { verified: false };
}

export type CrawlLimits = {
  maxPages: number;
  maxDepth: number;
  schedulingAllowed: boolean;
};

/** Master prompt §7: unverified = single page, low frequency, no scheduling. */
export function crawlLimitsFor(state: VerificationState): CrawlLimits {
  const cfg = loadAppConfig({
    APP_URL: 'http://localhost:4311',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    DATABASE_URL: 'postgres://localhost/x',
  });
  if (state === 'verified') {
    return {
      maxPages: cfg.scan.defaultMaxPages,
      maxDepth: cfg.scan.defaultMaxDepth,
      schedulingAllowed: true,
    };
  }
  return { maxPages: 1, maxDepth: 1, schedulingAllowed: false };
}
