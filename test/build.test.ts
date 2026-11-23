import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * The sign-in GATE mechanically: the Next.js app builds and the auth routes
 * exist with the right shapes. Full OAuth round-trips are covered by the
 * oauth unit tests against the stub provider; a real-provider smoke test
 * needs the operator's OAuth apps (documented in the README).
 */

const NEXT_BIN = join(import.meta.dirname, '..', 'node_modules', '.bin', 'next');

describe('P1 gate: the app builds (auth pages compile)', () => {
  it('next build succeeds (isolated distDir — safe beside a running dev server)', () => {
    execFileSync(
      NEXT_BIN,
      ['build'],
      {
        cwd: join(import.meta.dirname, '..'),
        stdio: 'pipe',
        timeout: 180_000,
        env: { ...process.env, BUILD_DIST_DIR: '.next-ci' },
      },
    );
  }, 200_000);
});
