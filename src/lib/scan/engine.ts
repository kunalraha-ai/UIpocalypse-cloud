import { chromium, type Browser, type Page } from 'playwright';
import type { Finding } from './fingerprint.ts';
import { dedupeFindings, normalizeUrl } from './fingerprint.ts';
import * as checks from './checks.ts';
import type { ScanThresholds } from './types.ts';
import { safeFetch, assertSafeUrl, type SafeFetchOptions } from '../safe-fetch/safe-fetch.ts';
import { parseRobots, robotsAllows, fetchRobots, ROBOTS_USER_AGENT } from '../crawl/robots.ts';
import { RateLimiter, RATE_LIMITS } from '../crawl/rate-limit.ts';

/**
 * The scan engine (master prompt §3): crawl same-origin, respect robots.txt,
 * per-host concurrency, and produce findings for every check. The caller
 * passes the SSRF resolver; the engine runs inside the worker process.
 */

export type ScanResult = {
  findings: Finding[];
  pagesScanned: number;
  skippedPages: Array<{ url: string; reason: string }>;
  discoveredUrls: number;
  durationMs: number;
};

export type ScanOptions = {
  url: string;
  thresholds?: Partial<ScanThresholds>;
  resolve: SafeFetchOptions['resolve'];
  fetchImpl?: typeof fetch;
  browser?: Browser; // injectable for tests; the engine creates its own otherwise
  rateLimiter?: RateLimiter;
  /** test hook: skip the SSRF URL check (fixture sites are loopback by nature) */
  _testSkipUrlCheck?: boolean;
};

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const t0 = Date.now();
  const t: ScanThresholds = { ...((await import('./types.ts')).DEFAULT_THRESHOLDS), ...opts.thresholds };
  const { url: startUrl } = opts;
  const origin = new URL(startUrl).origin;
  const rate = opts.rateLimiter ?? new RateLimiter(RATE_LIMITS);
  const fetchOpts: SafeFetchOptions = { resolve: opts.resolve, fetchImpl: opts.fetchImpl, timeoutMs: t.requestTimeoutMs, maxBytes: t.maxResponseBytes };

  const findings: Finding[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const visited = new Set<string>();
  const discovered = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

  // robots.txt (P2)
  const robots = await fetchRobots(origin, fetchOpts).catch(() => null);

  // ssl-expiry on the origin
  try {
    const ssl = await sslExpiry(origin, opts.resolve);
    const f = checks.checkSslExpiry(origin, ssl.daysRemaining, t.sslWarnDays);
    if (f) findings.push(f);
  } catch { /* no TLS info — skip */ }

  // browser for JS errors / network / images / timing
  const browser = opts.browser ?? (await chromium.launch());
  const context = await browser.newContext({ ignoreHTTPSErrors: false });

  try {
    while (queue.length > 0 && visited.size < t.maxPages) {
      const { url, depth } = queue.shift()!;
      const norm = normalizeUrl(url);
      if (visited.has(norm)) continue;
      if (robots && !robotsAllows(robots, new URL(url).pathname, ROBOTS_USER_AGENT)) {
        skipped.push({ url, reason: 'robots.txt disallows' });
        continue;
      }
      visited.add(norm);

      if (!rate.tryAcquire('worker', new URL(url).hostname)) {
        skipped.push({ url, reason: `throttled: ${rate.lastDenial}` });
        continue;
      }

      if (depth > t.maxDepth) {
        skipped.push({ url, reason: `max depth ${t.maxDepth} exceeded` });
        continue;
      }

      // scan one page
      const pageFindings = await scanPage(url, context, t, fetchOpts, opts._testSkipUrlCheck);
      findings.push(...pageFindings.findings);
      // page's own response is a link-check result too (the browser already loaded it)
      if (pageFindings.statusCode && pageFindings.statusCode >= 400) {
        const bf = checks.checkBrokenLink(url, pageFindings.statusCode, false, false);
        if (bf) findings.push(bf);
      }
      // redirect chains on the page's own navigation
      if (pageFindings.redirectHops > t.redirectHopLimit) {
        const rc = checks.checkRedirectChain(url, pageFindings.redirectHops, t.redirectHopLimit);
        if (rc) findings.push(rc);
      }
      if (pageFindings.redirectLoopUrl) {
        findings.push(checks.checkRedirectLoop(url, pageFindings.redirectLoopUrl));
      }
      for (const link of pageFindings.links) {
        discovered.add(normalizeUrl(link, origin));
        if (sameOrigin(link, origin) && !visited.has(normalizeUrl(link, origin)) && depth < t.maxDepth) {
          queue.push({ url: new URL(link, origin).toString(), depth: depth + 1 });
        }
      }
    }

    // link checking via plain HTTP through the guard — only for URLs the
    // browser didn't already visit (external links, or pages beyond limits)
    const checkOpts: SafeFetchOptions = { ...fetchOpts, maxRedirects: 10, ...(opts._testSkipUrlCheck ? { _testSkipUrlCheck: true } : {}) };
    for (const link of discovered) {
      if (link === normalizeUrl(startUrl)) continue;
      if (visited.has(link)) continue; // already scanned by the browser — we have its status
      if (!rate.tryAcquire('worker', new URL(link).hostname)) {
        skipped.push({ url: link, reason: `throttled: ${rate.lastDenial}` });
        continue;
      }
      const linkFindings = await checkLink(link, origin, t, checkOpts);
      findings.push(...linkFindings);
    }
  } finally {
    if (!opts.browser) await browser.close();
    else await context.close();
  }

  // page-not-scanned honesty
  for (const d of discovered) {
    if (!visited.has(d) && !skipped.some((s) => s.url === d)) {
      if (visited.size >= t.maxPages) skipped.push({ url: d, reason: `page limit (${t.maxPages}) reached` });
    }
  }

  return {
    findings: dedupeFindings(findings),
    pagesScanned: visited.size,
    skippedPages: skipped,
    discoveredUrls: discovered.size,
    durationMs: Date.now() - t0,
  };
}

async function scanPage(
  url: string,
  context: import('playwright').BrowserContext,
  t: ScanThresholds,
  fetchOpts: SafeFetchOptions,
  skipUrlCheck?: boolean,
): Promise<{ findings: Finding[]; links: string[]; statusCode?: number; redirectHops: number; redirectLoopUrl?: string; transferBytes: number }> {
  const findings: Finding[] = [];
  const page = await context.newPage();
  const resources: Array<{ url: string; status: number | 'failed' }> = [];
  const consoleErrors: string[] = [];
  let transferBytes = 0;
  let redirectHops = 0;
  let redirectLoopUrl: string | undefined;
  const redirectTargets = new Set<string>();

  // track redirects manually
  page.on('response', (res) => {
    resources.push({ url: res.url(), status: res.status() });
    const len = res.headers()['content-length'];
    if (len) transferBytes += Number(len);
    else {
      // estimate: use the response body size if headers don't say
      transferBytes += (res.headers()['content-encoding'] ? 1024 : 1024); // conservative estimate
    }
    if (res.status() >= 300 && res.status() < 400) {
      redirectHops++;
      const loc = res.headers()['location'];
      if (loc) {
        const target = normalizeUrl(new URL(loc, res.url()).toString());
        if (redirectTargets.has(target)) {
          redirectLoopUrl = target; // loop detected
        }
        redirectTargets.add(target);
      }
    }
  });
  page.on('requestfailed', (req) => {
    resources.push({ url: req.url(), status: 'failed' });
  });
  page.on('pageerror', (err) => findings.push(checks.checkJsError(url, 'pageerror', String(err))));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: Math.max(t.requestTimeoutMs, 10_000) }).catch(() => null);
    const statusCode = res?.status();
    if (!res) {
      findings.push(checks.make('failed-request', 'high', url, `page failed to load`, {}, 'Check the page URL and server.'));
      return { findings, links: [], statusCode: 0, redirectHops, redirectLoopUrl, transferBytes };
    }

    // timing
    const loadMs = res.request().timing()?.responseEnd ?? 0;
    const tf = checks.checkLoadTiming(url, 'load', loadMs, t.maxLoadMs);
    if (tf) findings.push(tf);
    const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) resolve(entries[entries.length - 1]!.startTime);
        else resolve(-1);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => resolve(-1), 3000);
    })).catch(() => -1);
    if (lcp > 0) {
      const lf = checks.checkLoadTiming(url, 'lcp', lcp, t.maxLcpMs);
      if (lf) findings.push(lf);
    }

    // page weight — use the ACTUAL response size (body length), not just headers
    const bodySize = (await res.body().catch(() => Buffer.alloc(0))).length;
    const totalBytes = Math.max(transferBytes, bodySize);
    const wf = checks.checkPageWeight(url, totalBytes, t.maxPageWeightBytes);
    if (wf) findings.push(wf);

    // subresource failures + mixed content
    for (const r of resources) {
      const rf = checks.checkFailedRequest(url, r.url, r.status);
      if (rf) findings.push(rf);
      if (new URL(url).protocol === 'https:' && r.url.startsWith('http:')) {
        findings.push(checks.checkMixedContent(url, r.url));
      }
    }

    // console errors
    for (const c of consoleErrors.slice(0, 5)) {
      findings.push(checks.checkJsError(url, 'console.error', c));
    }

    // missing images
    const brokenImgs = await page.evaluate(() => {
      return [...document.querySelectorAll('img')]
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => (img as HTMLImageElement).src);
    }).catch(() => [] as string[]);
    for (const src of brokenImgs) findings.push(checks.checkMissingImage(url, src));

    // meta tags
    const meta = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '',
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
    })).catch(() => ({ title: '', description: '', ogTitle: '', ogImage: '' }));
    findings.push(...checks.checkMissingMeta(url, meta));

    // extract links
    const links = await page.evaluate(() => {
      return [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h && !h.startsWith('javascript:') && !h.startsWith('#') && !h.startsWith('mailto:'));
    }).catch(() => [] as string[]);

    return { findings, links, statusCode, redirectHops, redirectLoopUrl, transferBytes: totalBytes };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function checkLink(url: string, origin: string, t: ScanThresholds, fetchOpts: SafeFetchOptions): Promise<Finding[]> {
  const out: Finding[] = [];
  const isExternal = !sameOrigin(url, origin);
  // try twice (retry once)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await safeFetch(url, { ...fetchOpts, maxRedirects: 10 });
      const f = checks.checkBrokenLink(url, res.status, isExternal, false);
      if (f) out.push(f);
      return out;
    } catch (e) {
      if (attempt === 0) continue;
      // SSRF refusal = not a broken link on the target, just unscannable by us
      if (String(e).includes('unsafe URL refused')) return out;
      const f = checks.checkBrokenLink(url, 'timeout', isExternal, false);
      if (f) out.push(f);
    }
  }
  return out;
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function sslExpiry(origin: string, resolve: SafeFetchOptions['resolve']): Promise<{ daysRemaining: number }> {
  const tls = await import('node:tls');
  return new Promise((resolve2, reject) => {
    const u = new URL(origin);
    const socket = tls.connect({ host: u.hostname, port: 443, servername: u.hostname, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      if (cert && cert.valid_to) {
        const expiry = new Date(cert.valid_to).getTime();
        const days = Math.floor((expiry - Date.now()) / 86_400_000);
        socket.destroy();
        resolve2({ daysRemaining: days });
      } else {
        socket.destroy();
        reject(new Error('no cert'));
      }
    });
    socket.on('error', (e) => reject(e));
  });
}
