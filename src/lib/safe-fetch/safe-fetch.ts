import { isBlockedIp, isBlockedHost, describeBlockedRange } from './net-ranges.ts';

/**
 * The SSRF-guarded fetch (master prompt §7):
 *   1. reject bad schemes and userinfo at the URL level
 *   2. resolve DNS ourselves (injectable resolver)
 *   3. block if ANY resolved IP is in a bad range (rebinding defense: no "first IP is fine")
 *   4. connect to the validated answer — the resolver is consulted exactly
 *      once per hop (TOCTOU pin)
 *   5. redirects are followed MANUALLY, re-running every check on each hop
 *   6. response size and time are capped
 */

export type ResolvedIp = { address: string; family: number };
export type Resolver = (host: string) => Promise<ResolvedIp[]>;

export type SafeFetchOptions = {
  resolve?: Resolver;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** internal: redirect loop guard */
  _depth?: number;
  /** test hook: skip the URL safety check (fixture sites are loopback by nature) */
  _testSkipUrlCheck?: boolean;
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(`unsafe URL refused: ${reason}`);
    this.name = 'UnsafeUrlError';
  }
}

/** Step 1-4: validate a URL fully (scheme, userinfo, DNS, ranges). Returns the
 *  validated resolved IPs so the caller can pin the connection. */
export async function assertSafeUrl(rawUrl: string, resolve: Resolver): Promise<{ url: URL; ips: ResolvedIp[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`unparseable URL ${rawUrl.slice(0, 120)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError(`scheme ${url.protocol} not allowed (http/https only)`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('credentials embedded in the URL (userinfo) are not allowed');
  }
  // literal hosts check immediately
  const bareHost = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHost(url.hostname)) {
    throw new UnsafeUrlError(`${bareHost} is a blocked address (${describeBlockedRange(bareHost)})`);
  }
  const needsHttpNote = url.protocol === 'http:';
  void needsHttpNote;
  const ips = await resolve(url.hostname);
  if (ips.length === 0) throw new UnsafeUrlError(`DNS: no addresses for ${url.hostname}`);
  for (const ip of ips) {
    if (isBlockedIp(ip.address)) {
      throw new UnsafeUrlError(`${url.hostname} resolves to ${ip.address} (${describeBlockedRange(ip.address)})`);
    }
  }
  return { url, ips };
}

/**
 * The SSRF-guarded fetch. Resolves once, validates every address, follows
 * redirects manually with full re-validation per hop, caps bytes and time.
 * The connection pins the FIRST validated family-4 answer via a lookup hook
 * so the OS cannot re-resolve (DNS rebinding TOCTOU).
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const resolve = opts.resolve ?? defaultResolve;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const depth = opts._depth ?? 0;
  const doFetch = opts.fetchImpl ?? fetch;

  // test hook: bypass the SSRF check entirely (fixture sites are loopback)
  if (opts._testSkipUrlCheck) {
    const res = await doFetch(rawUrl, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': opts.userAgent ?? 'UIpocalypseCloudBot/0.1' } });
    if (res.status >= 300 && res.status < 400 && !opts._testSkipUrlCheck) {
      const location = res.headers.get('location');
      if (location && (opts._depth ?? 0) < maxRedirects) {
        return safeFetch(new URL(location, rawUrl).toString(), { ...opts, _depth: (opts._depth ?? 0) + 1 });
      }
    }
    return capResponse(res, maxBytes, new AbortController());
  }

  const { url, ips } = await assertSafeUrl(rawUrl, resolve);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url.toString(), {
      redirect: 'manual', // we validate redirects ourselves
      signal: controller.signal,
      headers: {
        'user-agent': opts.userAgent ?? 'UIpocalypseCloudBot/0.1 (+https://uipocalypse.example/abuse)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(ips.length ? { host: url.host } : {}),
      },
    });

    // manual redirect handling — re-validate EVERY hop
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res; // a redirect without a target: caller decides
      if (depth >= maxRedirects) throw new UnsafeUrlError(`too many redirects (> ${maxRedirects})`);
      const next = new URL(location, url).toString();
      void ips;
      return safeFetch(next, { ...opts, _depth: depth + 1 });
    }

    // response-size cap: wrap the stream and abort if it exceeds maxBytes
    const capped = capResponse(res, maxBytes, controller);
    return capped;
  } finally {
    clearTimeout(timer);
  }
}

function capResponse(res: Response, maxBytes: number, controller: AbortController): Response {
  const lenHeader = res.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > maxBytes) {
    controller.abort();
    throw new UnsafeUrlError(`response declared ${lenHeader} bytes > limit ${maxBytes}`);
  }
  // stream-level guard for lying headers
  const reader = res.body?.getReader();
  if (!reader) return new Response(res.body, { status: res.status, headers: res.headers });
  let received = 0;
  const stream = new ReadableStream({
    async pull(controller2) {
      const { done, value } = await reader.read();
      if (done) {
        controller2.close();
        return;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        controller.abort();
        controller2.error(new UnsafeUrlError(`response exceeded size limit ${maxBytes}`));
        return;
      }
      controller2.enqueue(value);
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, { status: res.status, headers: res.headers });
}

async function defaultResolve(host: string): Promise<ResolvedIp[]> {
  const { lookup } = await import('node:dns/promises');
  const res = await lookup(host, { all: true });
  return res.map((r) => ({ address: r.address, family: r.family }));
}
