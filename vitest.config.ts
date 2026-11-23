import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    // integration suites share the compose Postgres; keep files serial to
    // avoid create/drop-database races on the shared instance
    fileParallelism: false,
  },
});
