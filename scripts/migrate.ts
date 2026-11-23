import { resolve } from 'node:path';
import pg from 'pg';
import { applyMigrations } from '../src/lib/db/migrate.ts';

/** `npm run migrate` — applies pending migrations to DATABASE_URL. */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const applied = await applyMigrations(pool, resolve(import.meta.dirname, '..', 'migrations'));
  console.log(applied.length ? `done: ${applied.length} applied` : 'up to date');
} finally {
  await pool.end();
}
