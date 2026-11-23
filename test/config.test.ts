import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../config/app-config.ts';

/**
 * The master prompt: every money value, price, limit, and threshold is CONFIG
 * — never hardcoded. A config that loads wrong must refuse to boot, loudly.
 * This suite is the contract for that.
 */

const VALID = {
  APP_URL: 'http://localhost:4311',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  DATABASE_URL: 'postgres://uipoc:uipoc@localhost:5435/uipocalypse_cloud',
};

describe('app config', () => {
  it('loads with defaults: tiers, scan limits, credit price are present and sane', () => {
    const cfg = loadAppConfig(VALID);
    expect(cfg.billing.tiers.map((t) => t.id)).toEqual(['S', 'M', 'L']);
    expect(cfg.billing.tiers[0]!.priceCredits).toBe(3);
    expect(cfg.billing.creditPriceUsd).toBeGreaterThan(0);
    expect(cfg.scan.defaultMaxPages).toBe(25);
    expect(cfg.scan.defaultMaxDepth).toBe(3);
    expect(cfg.queue.workerConcurrency).toBeGreaterThan(0);
  });

  it('a provider is only enabled when BOTH id and secret are set', () => {
    const cfg = loadAppConfig({ ...VALID, GITHUB_CLIENT_ID: 'id-only-no-secret' });
    expect(cfg.auth.github.enabled).toBe(false);
    const cfg2 = loadAppConfig({ ...VALID, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'sec' });
    expect(cfg2.auth.github.enabled).toBe(true);
  });

  it('refuses to start without a real session secret', () => {
    expect(() => loadAppConfig({ ...VALID, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadAppConfig({ ...VALID, SESSION_SECRET: undefined })).toThrow();
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(() => loadAppConfig({ ...VALID, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('refuses a non-URL app URL', () => {
    expect(() => loadAppConfig({ ...VALID, APP_URL: 'not a url' })).toThrow();
  });
});
