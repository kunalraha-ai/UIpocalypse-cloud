import { z } from 'zod';

/**
 * The ONE place where tunable values live. The master prompt's rule: every
 * money value, price, tier, limit, and threshold is CONFIG — never hardcoded.
 * Validated at boot (and in tests); a bad config must refuse to start.
 */

const ProviderConfig = z.object({
  /** OAuth: identity + email scopes only — never request repo access */
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  enabled: z.boolean().default(false),
});

const CreditTier = z.object({
  id: z.enum(['S', 'M', 'L']),
  label: z.string(),
  maxPages: z.number().int().positive(),
  timeBudgetSeconds: z.number().int().positive(),
  priceCredits: z.number().positive(),
});

export const AppConfigSchema = z.object({
  appUrl: z.string().url(),
  sessionSecret: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  databaseUrl: z.string().min(1, 'DATABASE_URL is required'),
  auth: z.object({
    github: ProviderConfig.default({}),
    google: ProviderConfig.default({}),
  }).default({}),
  scan: z.object({
    defaultMaxPages: z.number().int().positive().default(25),
    defaultMaxDepth: z.number().int().positive().default(3),
    perHostConcurrency: z.number().int().positive().default(3),
    requestTimeoutMs: z.number().int().positive().default(15_000),
    maxResponseBytes: z.number().int().positive().default(5 * 1024 * 1024),
    userAgent: z.string().default('UIpocalypseCloudBot/0.1 (+https://uipocalypse.example/abuse)'),
  }).default({}),
  billing: z.object({
    /** one credit's money value — display and pricing are derived from this */
    creditPriceUsd: z.number().positive().default(0.1),
    freeGrantCredits: z.number().int().positive().default(100),
    freeGrantExpiryDays: z.number().int().positive().default(30),
    minGithubAccountAgeDays: z.number().int().positive().default(7),
    lowBalanceThresholdPct: z.number().min(1).max(100).default(20),
    tiers: z.array(CreditTier).default([
      { id: 'S', label: 'Small', maxPages: 25, timeBudgetSeconds: 180, priceCredits: 3 },
      { id: 'M', label: 'Medium', maxPages: 100, timeBudgetSeconds: 600, priceCredits: 10 },
      { id: 'L', label: 'Large', maxPages: 400, timeBudgetSeconds: 1800, priceCredits: 30 },
    ]),
  }).default({}),
  queue: z.object({
    workerConcurrency: z.number().int().positive().default(2),
  }).default({}),
  notifications: z.object({
    email: z.object({ enabled: z.boolean().default(false), provider: z.string().default('stub') }).default({}),
    slack: z.object({ enabled: z.boolean().default(false) }).default({}),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Load config from an explicit env map (injected — the app never reads
 * process.env directly in places that must stay testable).
 */
export function loadAppConfig(env: Record<string, string | undefined>): AppConfig {
  return AppConfigSchema.parse({
    appUrl: env.APP_URL ?? 'http://localhost:4311',
    sessionSecret: env.SESSION_SECRET,
    databaseUrl: env.DATABASE_URL,
    auth: {
      github: {
        clientId: env.GITHUB_CLIENT_ID ?? '',
        clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
        enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
        enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      },
    },
    scan: {
      userAgent: env.SCAN_USER_AGENT,
    },
    queue: {
      workerConcurrency: env.WORKER_CONCURRENCY ? Number(env.WORKER_CONCURRENCY) : undefined,
    },
  });
}

/** The running process's config. Fails fast — a misconfigured hosted crawler
 *  must never limp up half-configured. */
export function processConfig(): AppConfig {
  return loadAppConfig(process.env);
}
