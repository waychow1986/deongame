import pg from 'pg';
import type { DbConfig } from '../config.js';
import type { Logger } from '../logger.js';

export type Pool = pg.Pool;

export async function createPool(db: DbConfig, schema: string, logger: Logger): Promise<pg.Pool> {
  if (schema !== 'public') {
    const client = new pg.Client({ ...db });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } finally {
      await client.end();
    }
  }
  const pool = new pg.Pool({
    ...db,
    max: 10,
    ...(schema !== 'public' ? { options: `-c search_path=${schema}` } : {}),
  });
  pool.on('error', (err) => {
    logger.error({ event: 'db_pool_error', err: err.message }, 'database pool error');
  });
  return pool;
}

export async function createPoolWithRetry(
  db: DbConfig,
  schema: string,
  logger: Logger,
  timeoutMs = 60000,
): Promise<pg.Pool> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const pool = await createPool(db, schema, logger);
      await pool.query('SELECT 1');
      return pool;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      logger.warn({ event: 'db_connect_retry', err: (err as Error).message }, 'database unavailable, retrying');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
