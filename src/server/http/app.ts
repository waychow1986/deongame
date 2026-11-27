import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import type pg from 'pg';
import type { Rng } from '../../shared/rng.js';
import { ERROR_MESSAGES } from '../../shared/protocol.js';
import { SessionStore } from '../auth/sessions.js';
import type { AppConfig } from '../config.js';
import type { AppContext, Broadcaster } from '../context.js';
import { runMigrations } from '../db/migrate.js';
import { loadChipBalances } from '../db/pokerSettlements.js';
import { createPool, createPoolWithRetry } from '../db/pool.js';
import { UserRepository } from '../db/users.js';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { attachRealtime } from '../realtime/socket.js';
import { createChessSettler } from '../rooms/chessSettlement.js';
import { createPokerSettler } from '../rooms/pokerSettlement.js';
import { RoomManager } from '../rooms/roomManager.js';
import { authRoutes } from './authRoutes.js';
import { roomRoutes } from './roomRoutes.js';

export interface CreateServerOptions {
  config: AppConfig;
  rng: Rng;
  logger: Logger;
  /** Retry the initial database connection (used by the production entrypoint). */
  retryDb?: boolean;
}

export interface RunningServer {
  httpServer: HttpServer;
  ctx: AppContext;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

export async function createServer(opts: CreateServerOptions): Promise<RunningServer> {
  const { config, logger, rng } = opts;
  const pool: pg.Pool = opts.retryDb
    ? await createPoolWithRetry(config.db, config.dbSchema, logger)
    : await createPool(config.db, config.dbSchema, logger);
  await runMigrations(pool);

  const broadcasterRef: { current: Broadcaster } = { current: { roomChanged: () => undefined } };
  const broadcasterProxy: Broadcaster = {
    roomChanged: (roomId, userIds) => broadcasterRef.current.roomChanged(roomId, userIds),
  };
  const ctx: AppContext = {
    config,
    logger,
    rng,
    pool,
    users: new UserRepository(pool),
    sessions: new SessionStore(pool),
    rooms: new RoomManager({
      rng,
      onChessFinished: createChessSettler(pool, logger, broadcasterProxy),
      loadChips: (ids) => loadChipBalances(pool, ids),
      onPokerSettled: createPokerSettler(pool, logger),
      onPokerUpdate: (room) =>
        broadcasterProxy.roomChanged(
          room.id,
          room.members.map((m) => m.userId),
        ),
      pokerNextHandDelayMs: config.pokerNextHandDelayMs,
    }),
    broadcaster: broadcasterProxy,
  };

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db-unavailable' });
    }
  });

  app.use('/api', (req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      next(new AppError('UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.use(authRoutes(ctx));
  app.use(roomRoutes(ctx));

  app.use('/api', (_req, _res, next) => next(new AppError('ROOM_NOT_FOUND', '接口不存在')));

  if (existsSync(join(WEB_DIR, 'index.html'))) {
    app.use(express.static(WEB_DIR, { index: false }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.sendFile(join(WEB_DIR, 'index.html'));
    });
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ event: 'request_failed', code: err.code }, 'request failed');
      else logger.info({ event: 'request_rejected', code: err.code, userId: req.user?.id, path: req.path }, 'request rejected');
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e.type === 'entity.parse.failed' || e.type === 'entity.too.large' || e.status === 400 || e.status === 413) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: ERROR_MESSAGES.VALIDATION_FAILED } });
      return;
    }
    logger.error({ event: 'unhandled_error', err: (err as Error).message, path: req.path }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: ERROR_MESSAGES.INTERNAL_ERROR } });
  });

  const httpServer = createHttpServer(app);
  const { io, broadcaster } = attachRealtime(httpServer, ctx);
  broadcasterRef.current = broadcaster;

  return {
    httpServer,
    ctx,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await pool.end();
    },
  };
}
