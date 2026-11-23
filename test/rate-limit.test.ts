import { describe, expect, it, vi } from 'vitest';
import { RateLimiter, RATE_LIMITS } from '../src/lib/crawl/rate-limit.ts';

/**
 * Rate limits (master prompt §7): per user, per target domain, and global —
 * plus a global concurrency cap. A hosted crawler without these is a DoS tool.
 * In-memory token buckets (single worker process owns all crawling); the
 * worker enforces them and the run reports throttling honestly.
 */

/** a clock that only moves when you say so — refill must never happen by accident */
function fastClock() {
  let t = 0;
  const now = () => t;
  (now as { tick?: () => void }).tick = () => { t += 1000; };
  return now as (() => number) & { tick: () => void };
}

describe('RateLimiter — per-domain', () => {
  it('allows up to the domain budget then throttles', () => {
    const clock = fastClock();
    const rl = new RateLimiter(RATE_LIMITS, clock);
    for (let i = 0; i < RATE_LIMITS.perDomainPerMinute; i++) {
      expect(rl.tryAcquire('user-1', 'example.com')).toBe(true);
    }
    expect(rl.tryAcquire('user-1', 'example.com')).toBe(false); // throttled
    expect(rl.tryAcquire('user-1', 'other.com')).toBe(true); // other domains unaffected
  });
  it('refills over time', () => {
    const clock = fastClock();
    const rl = new RateLimiter({ ...RATE_LIMITS, perDomainPerMinute: 2 }, clock);
    expect(rl.tryAcquire('u', 'a.com')).toBe(true);
    expect(rl.tryAcquire('u', 'a.com')).toBe(true);
    expect(rl.tryAcquire('u', 'a.com')).toBe(false);
    clock.tick(); // refill is cap/minute: with cap 2, ~30 s refills one token
    for (let i = 0; i < 30; i++) clock.tick();
    expect(rl.tryAcquire('u', 'a.com')).toBe(true); // refilled
  });
});

describe('RateLimiter — per-user', () => {
  it('caps a single user hammering many domains', () => {
    const clock = fastClock();
    const rl = new RateLimiter({ ...RATE_LIMITS, perUserPerMinute: 3, perDomainPerMinute: 100 }, clock);
    for (let i = 0; i < 3; i++) expect(rl.tryAcquire('u1', `d${i}.com`)).toBe(true);
    expect(rl.tryAcquire('u1', 'd99.com')).toBe(false); // user budget exhausted
    expect(rl.tryAcquire('u2', 'd99.com')).toBe(true); // other users unaffected
  });
});

describe('RateLimiter — global', () => {
  it('the global cap stops everything regardless of who/where', () => {
    const clock = fastClock();
    const rl = new RateLimiter({ ...RATE_LIMITS, globalPerMinute: 2, perUserPerMinute: 100, perDomainPerMinute: 100 }, clock);
    expect(rl.tryAcquire('u1', 'a.com')).toBe(true);
    expect(rl.tryAcquire('u2', 'b.com')).toBe(true);
    expect(rl.tryAcquire('u3', 'c.com')).toBe(false); // global budget gone
  });
});

describe('RateLimiter — reporting (honest throttling in reports)', () => {
  it('records which bucket denied each request', () => {
    const clock = fastClock();
    const rl = new RateLimiter({ ...RATE_LIMITS, perUserPerMinute: 1, perDomainPerMinute: 100, globalPerMinute: 100 }, clock);
    rl.tryAcquire('u', 'a.com');
    const verdict = rl.tryAcquire('u', 'b.com');
    expect(verdict).toBe(false);
    expect(rl.lastDenial).toBe('per-user');
  });
});

describe('RateLimiter — concurrency cap', () => {
  it('withRun gates concurrent executions at the cap', async () => {
    const clock = fastClock();
    const rl = new RateLimiter({ ...RATE_LIMITS, maxConcurrency: 2 }, clock);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
    };
    await Promise.all(Array.from({ length: 8 }, () => rl.withRun('u', 'a.com', task)));
    expect(peak).toBe(2); // never more than the cap
  });
});
