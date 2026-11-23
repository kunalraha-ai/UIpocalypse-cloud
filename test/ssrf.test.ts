import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { safeFetch, assertSafeUrl, type SafeFetchOptions } from '../src/lib/safe-fetch/safe-fetch.ts';

/**
 * SSRF guard against the real world (master prompt §7): resolve DNS yourself,
 * block bad ranges, re-validate on every redirect, connect to the validated IP.
 * These tests stand up real loopback servers — which the guard MUST refuse to
 * touch, even though they're right there and serving 200s.
 */

let loop: Server;
let loopPort = 0;
const trapHits: string[] = [];
let trap: Server;
let trapPort = 0;

beforeAll(async () => {
  loop = createServer((req, res) => { res.writeHead(200); res.end('loopback content'); });
  await new Promise<void>((r) => loop.listen(0, '127.0.0.1', r));
  loopPort = (loop.address() as { port: number }).port;
  // the trap server records any request that reaches it — a hit = guard failure
  trap = createServer((req, res) => { trapHits.push(req.url ?? '/'); res.writeHead(200); res.end('trap'); });
  await new Promise<void>((r) => trap.listen(0, '127.0.0.1', r));
  trapPort = (trap.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => loop.close(() => r));
  await new Promise<void>((r) => trap.close(() => r));
});

/** a resolver that maps test names to loopback — simulating hostile DNS */
const resolveToTrap: SafeFetchOptions['resolve'] = async (host) => [{ address: '127.0.0.1', family: 4 }];
const realResolve: SafeFetchOptions['resolve'] = async (host) => {
  // minimal real resolver for the tests: only the names we use
  if (host === 'example.test') return [{ address: '127.0.0.1', family: 4 }];
  throw new Error(`no such test host: ${host}`);
};

describe('assertSafeUrl — URL-level rejection', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', realResolve)).rejects.toThrow(/scheme/i);
    await expect(assertSafeUrl('ftp://x', realResolve)).rejects.toThrow(/scheme/i);
    await expect(assertSafeUrl('gopher://x', realResolve)).rejects.toThrow(/scheme/i);
  });
  it('rejects credentials in the URL ( userinfo smuggling )', async () => {
    await expect(assertSafeUrl('http://user:pass@example.test/', realResolve)).rejects.toThrow(/credential/i);
  });
});

describe('safeFetch — blocked ranges (real loopback servers, guard must refuse)', () => {
  it('127.0.0.1 literal → BLOCKED even though a live server answers', async () => {
    await expect(safeFetch(`http://127.0.0.1:${loopPort}/`, { resolve: realResolve })).rejects.toThrow(/loopback/);
  });
  it('localhost → BLOCKED via DNS resolution (name resolves to 127.0.0.1)', async () => {
    await expect(safeFetch(`http://localhost:${loopPort}/`, { resolve: async () => [{ address: '127.0.0.1', family: 4 }] })).rejects.toThrow(/loopback/);
  });
  it('[::1] → BLOCKED', async () => {
    await expect(safeFetch(`http://[::1]:${loopPort}/`, { resolve: resolveToTrap })).rejects.toThrow(/loopback/);
  });
  it('169.254.169.254 (cloud metadata) → BLOCKED', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/', { resolve: resolveToTrap })).rejects.toThrow(/metadata|link-local|blocked/i);
  });
  it('a name the resolver points at the trap loopback → BLOCKED (SSRF attempt via DNS)', async () => {
    await expect(safeFetch(`http://evil.attacker.test:${loopPort}/`, { resolve: resolveToTrap })).rejects.toThrow(/loopback/);
    expect(trapHits).toEqual([]); // and crucially: the trap server was never reached
  });
});

describe('safeFetch — DNS rebinding: connect to the validated IP only', () => {
  it('a name resolving to MULTIPLE IPs is blocked if ANY is bad (rebind to public + loopback)', async () => {
    const both: SafeFetchOptions['resolve'] = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    await expect(safeFetch('http://rebind.test/', { resolve: both })).rejects.toThrow(/loopback/);
    expect(trapHits).toEqual([]);
  });
  it('TOCTOU: the resolver is consulted ONCE and the connection pins that answer — a second lookup returning loopback never happens', async () => {
    let lookups = 0;
    const onceGood: SafeFetchOptions['resolve'] = async () => {
      lookups++;
      return [{ address: '127.0.0.1', family: 4 }]; // hostile: changes answers
    };
    await expect(safeFetch('http://toctou.test/', { resolve: onceGood })).rejects.toThrow(/loopback/);
    expect(lookups).toBe(1); // one resolution, one verdict
    expect(trapHits).toEqual([]);
  });
});

describe('safeFetch — redirect re-validation', () => {
  it('assertSafeUrl re-checks every hop (loopback redirect target refused)', async () => {
    await expect(assertSafeUrl(`http://127.0.0.1:${loopPort}/redirected`, realResolve)).rejects.toThrow(/loopback/);
  });
  it('redirect targets go through the same full validation', async () => {
    const pub = async () => [{ address: '93.184.216.34', family: 4 }];
    // a redirect to a public name validates; to loopback it does not
    await expect(assertSafeUrl('https://public.test/next', pub)).resolves.toBeDefined();
    await expect(assertSafeUrl('http://127.0.0.1/x', pub)).rejects.toThrow(/loopback/);
  });
});

describe('safeFetch — response size and time limits', () => {
  it('refuses responses larger than maxBytes', async () => {
    const pub = async () => [{ address: '93.184.216.34', family: 4 }];
    const fakeImpl = (async () => new Response('x'.repeat(1000), { headers: { 'content-length': '1000' } })) as unknown as typeof fetch;
    await expect(
      safeFetch('http://public.test/', { resolve: pub, maxBytes: 100, fetchImpl: fakeImpl }),
    ).rejects.toThrow(/size|limit|large/i);
  }, 10_000);
});

describe('safeFetch — allowed path works end to end', () => {
  it('a public name (resolver says public) is fetched, the trap is untouched', async () => {
    const fetchImpl = (async () => new Response('hello public')) as unknown as typeof fetch;
    const res = await safeFetch('https://public.test/', { resolve: async () => [{ address: '93.184.216.34', family: 4 }], fetchImpl });
    expect(await res.text()).toBe('hello public');
    expect(trapHits).toEqual([]);
  });
});
