import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  issueVerificationToken,
  checkMetaTag,
  checkWellKnown,
  verifyDomainOwnership,
  crawlLimitsFor,
} from '../src/lib/crawl/ownership.ts';

/**
 * Ownership verification (master prompt §7): meta tag, DNS TXT, or
 * /.well-known file. Unverified domains get single-page, no-schedule treatment;
 * verified domains get the full crawl limits. One owner per domain (DB, tested
 * at the store level). All fetch paths go through the SSRF guard.
 */

let srv: Server;
let port = 0;
const TOKEN = 'verify-token-abc123';

/** The SSRF guard blocks loopback (by design), so tests reach the fixture via
 *  a "public" name: the resolver vouches a public IP, and the transport
 *  rewires to the local fixture. This tests the verification parsing against
 *  the real HTTP server while the guard sees a public target. */
const ownerFetch = (async (url: string | URL | RequestInfo, init?: RequestInit) => {
  const real = String(url).replace('owner.test', `127.0.0.1:${port}`);
  return fetch(real, init);
}) as unknown as typeof fetch;
const publicResolve = async () => [{ address: '93.184.216.34', family: 4 }];
const OPTS = { resolve: publicResolve, fetchImpl: ownerFetch };

beforeAll(async () => {
  srv = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><head><meta name="uipocalypse-verification" content="${TOKEN}"></head><body>ok</body></html>`);
      return;
    }
    if (req.url === '/.well-known/uipocalypse.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(TOKEN);
      return;
    }
    if (req.url === '/empty') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head></head><body>no meta</body></html>');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  port = (srv.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => srv.close(() => r()));
});

describe('token issuance', () => {
  it('tokens are random, url-safe, and long', () => {
    const a = issueVerificationToken();
    const b = issueVerificationToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[\w-]{40,}$/);
  });
});

describe('meta-tag verification (via SSRF-guarded fetch)', () => {
  it('finds the token on a page that has it', async () => {
    expect(await checkMetaTag('http://owner.test/', TOKEN, OPTS)).toBe(true);
  }, 15_000);
  it('rejects a page without the meta tag', async () => {
    expect(await checkMetaTag('http://owner.test/empty', TOKEN, OPTS)).toBe(false);
  }, 15_000);
  it('rejects a wrong token', async () => {
    expect(await checkMetaTag('http://owner.test/', 'wrong-token', OPTS)).toBe(false);
  }, 15_000);
});

describe('well-known verification', () => {
  it('accepts an exact token at /.well-known/uipocalypse.txt', async () => {
    expect(await checkWellKnown('http://owner.test', TOKEN, OPTS)).toBe(true);
  }, 15_000);
  it('rejects a wrong token', async () => {
    expect(await checkWellKnown('http://owner.test', 'wrong', OPTS)).toBe(false);
  }, 15_000);
});

describe('verifyDomainOwnership — method resolution', () => {
  it('well-known wins when present; meta tag is the fallback', async () => {
    const res = await verifyDomainOwnership('http://owner.test', TOKEN, OPTS);
    expect(res).toEqual({ verified: true, method: 'well-known' });
  }, 20_000);
});

describe('crawlLimitsFor — unverified vs verified', () => {
  it('unverified: single page, no scheduling, low frequency', () => {
    const lim = crawlLimitsFor('unverified');
    expect(lim.maxPages).toBe(1);
    expect(lim.schedulingAllowed).toBe(false);
  });
  it('verified: the configured crawl limits, scheduling allowed', () => {
    const lim = crawlLimitsFor('verified');
    expect(lim.maxPages).toBeGreaterThan(1);
    expect(lim.schedulingAllowed).toBe(true);
  });
});
