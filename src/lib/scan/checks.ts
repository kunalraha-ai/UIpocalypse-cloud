import type { Finding, Severity } from './fingerprint.ts';
import { fingerprint } from './fingerprint.ts';

/**
 * All scan checks (master prompt §3). Each takes the raw observation and
 * returns zero or more findings. Thresholds come from CONFIG, never hardcoded.
 */

export function make(type: string, severity: Severity, url: string, message: string, evidence: Record<string, unknown>, fixHint: string): Finding {
  return { fingerprint: fingerprint(type, url, message), type, severity, url, message, evidence, fixHint };
}

/** broken-link: 404/5xx/timeout/DNS on internal and external links. Retry once. */
export function checkBrokenLink(url: string, status: number | string, isExternal: boolean, retryOk: boolean): Finding | null {
  if (retryOk) return null;
  const st: number | string = status;
  if (isExternal && (st === 403 || st === 429)) return null; // bot-blocking = unverifiable, not broken
  if (typeof st === 'number' && st >= 200 && st < 400) return null;
  const severity: Severity = st === 'timeout' || st === 'dns' || (typeof st === 'number' && st >= 500) ? 'high' : 'medium';
  const kind = st === 'timeout' ? 'timed out' : st === 'dns' ? 'DNS failure' : `HTTP ${st}`;
  const fix = st === 404 ? 'Fix the link target or remove the link.' : st === 'dns' ? 'Check the domain — it does not resolve.' : 'Check the target URL.';
  return make('broken-link', severity, url, `broken link (${kind})`, { target: url, status }, fix);
}

/** js-error: console.error, pageerror, unhandled rejection. */
export function checkJsError(url: string, kind: 'pageerror' | 'console.error' | 'unhandledrejection', message: string): Finding {
  return make('js-error', 'high', url, `${kind}: ${message}`, { kind, message }, 'Fix the JavaScript error — check the browser console for the stack trace.');
}

/** failed-request: 4xx/5xx or network failure for page subresources. */
export function checkFailedRequest(pageUrl: string, resourceUrl: string, status: number | 'failed'): Finding | null {
  const isFailed = status === 'failed' || status >= 400;
  if (isFailed) {
    const sev: Severity = status === 'failed' || status >= 500 ? 'medium' : 'low';
    return make('failed-request', sev, pageUrl, `resource failed to load: ${resourceUrl} (${status})`, { resourceUrl, status }, 'Fix the resource URL or the server returning the error.');
  }
  return null;
}

/** missing-image: img that failed or has zero naturalWidth. */
export function checkMissingImage(pageUrl: string, src: string): Finding {
  return make('missing-image', 'medium', pageUrl, `image missing: ${src}`, { src }, 'Fix or remove the broken image src.');
}

/** mixed-content: http:// subresource on an https:// page. */
export function checkMixedContent(pageUrl: string, resourceUrl: string): Finding {
  return make('mixed-content', 'medium', pageUrl, `mixed content: ${resourceUrl} on https page`, { resourceUrl }, 'Serve the resource over https (or use protocol-relative URLs).');
}

/** redirect-chain: more than the config threshold of hops. */
export function checkRedirectChain(url: string, hops: number, threshold: number): Finding | null {
  if (hops > threshold) {
    return make('redirect-chain', 'low', url, `redirect chain: ${hops} hops (> ${threshold})`, { hops }, 'Reduce redirect hops to 1–2.');
  }
  return null;
}

/** redirect-loop: detected when the same URL appears twice in the chain. */
export function checkRedirectLoop(url: string, loopAt: string): Finding {
  return make('redirect-loop', 'high', url, `redirect loop at ${loopAt}`, { loopAt }, 'Fix the redirect loop — check your rewrite rules.');
}

/** page-weight: total transfer size over threshold. */
export function checkPageWeight(pageUrl: string, bytes: number, maxBytes: number): Finding | null {
  if (bytes > maxBytes) {
    return make('page-weight', 'low', pageUrl, `page weight: ${(bytes / 1024).toFixed(0)} KB (limit ${(maxBytes / 1024).toFixed(0)} KB)`, { bytes, maxBytes }, 'Reduce page weight: compress images, lazy-load below-the-fold content, minimize bundles.');
  }
  return null;
}

/** load-timing: load or LCP over threshold. */
export function checkLoadTiming(pageUrl: string, metric: 'load' | 'lcp', ms: number, thresholdMs: number): Finding | null {
  if (ms > thresholdMs) {
    return make('load-timing', 'medium', pageUrl, `${metric}: ${ms.toFixed(0)} ms (limit ${thresholdMs} ms)`, { metric, ms, thresholdMs }, `Improve ${metric === 'lcp' ? 'Largest Contentful Paint' : 'load time'}: optimize the critical path.`);
  }
  return null;
}

/** ssl-expiry: certificate expiring within the warning window. */
export function checkSslExpiry(origin: string, daysRemaining: number, warnDays: number): Finding | null {
  if (daysRemaining < 0) return make('ssl-expired', 'high', origin, `SSL certificate EXPIRED ${-daysRemaining} days ago`, { daysRemaining }, 'Renew the SSL certificate immediately.');
  if (daysRemaining <= warnDays) {
    return make('ssl-expiry', 'medium', origin, `SSL certificate expires in ${daysRemaining} days`, { daysRemaining }, `Renew the SSL certificate — it expires within ${warnDays} days.`);
  }
  return null;
}

/** missing-meta: title, description, OG tags. */
export function checkMissingMeta(pageUrl: string, meta: { title?: string; description?: string; ogTitle?: string; ogImage?: string }): Finding[] {
  const out: Finding[] = [];
  if (!meta.title?.trim()) out.push(make('missing-meta', 'low', pageUrl, 'missing <title>', {}, 'Add a descriptive <title> to the page.'));
  if (!meta.description?.trim()) out.push(make('missing-meta', 'low', pageUrl, 'missing meta description', {}, 'Add a <meta name="description"> for search results and link previews.'));
  if (!meta.ogTitle?.trim()) out.push(make('missing-meta', 'low', pageUrl, 'missing og:title', {}, 'Add <meta property="og:title"> for social sharing.'));
  if (!meta.ogImage?.trim()) out.push(make('missing-meta', 'low', pageUrl, 'missing og:image', {}, 'Add <meta property="og:image"> for social sharing.'));
  return out;
}
