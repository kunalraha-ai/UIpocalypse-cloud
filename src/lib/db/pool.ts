import pg from 'pg';

/**
 * Postgres access. One pool per process (Next app, worker, scripts); tests
 * inject their own. No ORM — plain SQL with parameterized queries only.
 */

let pool: pg.Pool | null = null;

export function getPool(connectionString: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  return pool;
}

/** test hook */
export function resetPool(): void {
  pool = null;
}
