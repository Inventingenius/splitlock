import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://splitlock:splitlock@localhost:5432/splitlock";

/**
 * Shared process-wide pool.
 *
 * max=20 is sized for a single API replica under moderate concurrent mod
 * traffic (queue page + a few detail fetches). Each checked-out client holds
 * a backend connection; keeping the pool bounded prevents Postgres
 * `max_connections` exhaustion when the Node event loop is busy.
 *
 * idleTimeoutMillis recycles idle clients so long-lived containers do not
 * pin stale connections across Postgres restarts.
 */
export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
