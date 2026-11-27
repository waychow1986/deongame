import { cryptoRng } from '../shared/rng.js';
import { ConfigError, parseConfig } from './config.js';
import { createServer } from './http/app.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const bootLogger = createLogger(process.env.LOG_LEVEL || 'info');
  let config;
  try {
    config = parseConfig(process.env);
  } catch (err) {
    bootLogger.fatal({ event: 'config_invalid', err: (err as Error).message }, 'invalid configuration');
    process.exit(1);
  }
  const logger = createLogger(config.logLevel);
  const server = await createServer({ config, rng: cryptoRng, logger, retryDb: true });
  const port = await server.listen(config.port, '0.0.0.0');
  logger.info({ event: 'server_started', port }, 'server started');

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ event: 'server_stopping', signal }, 'server stopping');
    server
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const logger = createLogger('info');
  const msg = err instanceof ConfigError ? err.message : (err as Error).message;
  logger.fatal({ event: 'startup_failed', err: msg }, 'startup failed');
  process.exit(1);
});
