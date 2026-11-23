export type ScanThresholds = {
  maxPages: number;
  maxDepth: number;
  maxPageWeightBytes: number;
  maxLoadMs: number;
  maxLcpMs: number;
  redirectHopLimit: number;
  sslWarnDays: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
};

export const DEFAULT_THRESHOLDS: ScanThresholds = {
  maxPages: 25,
  maxDepth: 3,
  maxPageWeightBytes: 3 * 1024 * 1024,
  maxLoadMs: 5_000,
  maxLcpMs: 4_000,
  redirectHopLimit: 2,
  sslWarnDays: 14,
  requestTimeoutMs: 15_000,
  maxResponseBytes: 5 * 1024 * 1024,
};

export type ScanSummary = {
  pagesScanned: number;
  durationMs: number;
  findingsBySeverity: Record<string, number>;
  skippedPages: Array<{ url: string; reason: string }>;
  coverage: { scanned: number; discovered: number };
};
