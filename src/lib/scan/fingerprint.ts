import { createHash } from 'node:crypto';

/**
 * Finding fingerprints (master prompt §3): stable identity for a finding so
 * runs can be diffed. type + normalized URL/endpoint + normalized message.
 * Dedupe by fingerprint within a run.
 */

export type Severity = 'low' | 'medium' | 'high';

export type Finding = {
  /** stable fingerprint: type + normalized url + normalized message */
  fingerprint: string;
  type: string;
  severity: Severity;
  url: string;
  message: string;
  evidence: Record<string, unknown>;
  fixHint: string;
};

/** Normalize a URL for fingerprinting: strip fragment, sort query, lowercase host. */
export function normalizeUrl(raw: string, origin?: string): string {
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return raw;
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  return u.toString();
}

/** Normalize a message for fingerprinting: collapse whitespace, strip volatile numbers. */
export function normalizeMessage(msg: string): string {
  return msg
    .replace(/\s+/g, ' ')
    .replace(/\b\d+(\.\d+)?(ms|s|kb|mb)?\b/gi, 'N') // timings and sizes churn
    .replace(/\b[0-9a-f]{8,}\b/gi, 'H') // hashes churn
    .trim()
    .slice(0, 200);
}

export function fingerprint(type: string, url: string, message: string): string {
  return createHash('sha256')
    .update(`${type}\n${normalizeUrl(url)}\n${normalizeMessage(message)}`)
    .digest('hex')
    .slice(0, 24);
}

/** Dedupe by fingerprint, keeping the first occurrence and merging observation counts. */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const by = new Map<string, Finding>();
  for (const f of findings) {
    const existing = by.get(f.fingerprint);
    if (existing) {
      const count = (existing.evidence.count as number | undefined) ?? 1;
      existing.evidence.count = count + ((f.evidence.count as number | undefined) ?? 1);
    } else {
      by.set(f.fingerprint, { ...f, evidence: { ...f.evidence, count: 1 } });
    }
  }
  return [...by.values()];
}
