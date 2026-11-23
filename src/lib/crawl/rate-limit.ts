/**
 * Rate limits (master prompt §7): per user, per target domain, global, plus a
 * global concurrency cap. Token buckets keyed by scope; the worker process
 * owns all crawling, so in-memory is correct and cheap. Refusal is honest and
 * attributable: lastDenial names the bucket so reports say WHY a page was
 * skipped ("throttled: per-domain"), never silently.
 */

export type RateLimitConfig = {
  perUserPerMinute: number;
  perDomainPerMinute: number;
  globalPerMinute: number;
  maxConcurrency: number;
};

export const RATE_LIMITS: RateLimitConfig = {
  perUserPerMinute: 120,
  perDomainPerMinute: 30,
  globalPerMinute: 600,
  maxConcurrency: 10,
};

type Bucket = { tokens: number; last: number };

export class RateLimiter {
  private readonly user = new Map<string, Bucket>();
  private readonly domain = new Map<string, Bucket>();
  private readonly global: Bucket;
  private inFlight = 0;
  lastDenial: string | null = null;

  constructor(
    private readonly limits: RateLimitConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.global = { tokens: limits.globalPerMinute, last: now() };
  }

  /** Take one request. false = throttled (see lastDenial for the bucket). */
  tryAcquire(user: string, domain: string): boolean {
    const t = this.now();
    const refill = (b: Bucket, cap: number) => {
      const elapsed = t - b.last;
      if (elapsed > 0) {
        b.tokens = Math.min(cap, b.tokens + (elapsed / 60_000) * cap);
        b.last = t;
      }
    };
    const take = (map: Map<string, Bucket>, key: string, cap: number, name: string): boolean => {
      let b = map.get(key);
      if (!b) {
        b = { tokens: cap, last: t };
        map.set(key, b);
      }
      refill(b, cap);
      if (b.tokens < 1) {
        this.lastDenial = name;
        return false;
      }
      b.tokens -= 1;
      return true;
    };
    // order: global → user → domain (cheapest, most-shared bucket first)
    if (!take(new Map([['g', this.global]]), 'g', this.limits.globalPerMinute, 'global')) return false;
    if (!take(this.user, user, this.limits.perUserPerMinute, 'per-user')) return false;
    if (!take(this.domain, domain, this.limits.perDomainPerMinute, 'per-domain')) return false;
    this.lastDenial = null;
    return true;
  }

  /** Global concurrency cap: never run more than maxConcurrency tasks at once. */
  async withRun<T>(user: string, domain: string, task: () => Promise<T>): Promise<T> {
    while (this.inFlight >= this.limits.maxConcurrency) {
      await new Promise((r) => setTimeout(r, 25));
    }
    this.inFlight++;
    try {
      return await task();
    } finally {
      this.inFlight--;
    }
  }
}
