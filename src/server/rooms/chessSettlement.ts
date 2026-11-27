import type pg from 'pg';
import type { Broadcaster } from '../context.js';
import { settleChessGame } from '../db/chessResults.js';
import type { Logger } from '../logger.js';
import type { Room } from './roomManager.js';

export const SETTLEMENT_RETRY_MS = 5_000;

const DELTA = { win: 10, loss: -10, draw: 0 } as const;

/**
 * Persists a finished chess game (TD-010). Runs inside the room lock. On a DB failure the result
 * stays `settled=false` and is retried in the background every 5 s; the primary key prevents double scoring.
 */
export function createChessSettler(
  pool: pg.Pool,
  logger: Logger,
  broadcaster: Broadcaster,
): (room: Room) => Promise<void> {
  async function attempt(room: Room): Promise<boolean> {
    const chess = room.chess;
    if (!chess?.result || chess.result.settled) return true;
    const { outcome, reason } = chess.result;
    const deltas: { userId: string; delta: number }[] = [];
    for (const color of ['red', 'black'] as const) {
      const p = chess.players[color];
      if (!p) continue;
      const won = (outcome === 'red_win' && color === 'red') || (outcome === 'black_win' && color === 'black');
      deltas.push({ userId: p.userId, delta: outcome === 'draw' ? DELTA.draw : won ? DELTA.win : DELTA.loss });
    }
    try {
      const changes = await settleChessGame(pool, {
        gameId: chess.id,
        redUserId: chess.players.red?.userId as string,
        blackUserId: chess.players.black?.userId ?? null,
        mode: room.mode,
        outcome,
        reason,
        deltas,
      });
      chess.result.settled = true;
      if (changes) chess.result.ratingChanges = changes;
      logger.info({ event: 'chess_finished', roomId: room.id, gameId: chess.id, code: reason }, 'chess game settled');
      return true;
    } catch (err) {
      logger.error(
        { event: 'settlement_failed', roomId: room.id, gameId: chess.id, err: (err as Error).message },
        'chess settlement failed',
      );
      return false;
    }
  }

  function scheduleRetry(room: Room): void {
    const timer = setTimeout(() => {
      void room.lock.run(async () => {
        if (await attempt(room)) {
          room.version += 1;
          logger.info({ event: 'settlement_retried_ok', roomId: room.id, gameId: room.chess?.id }, 'settlement retried');
          broadcaster.roomChanged(
            room.id,
            room.members.map((m) => m.userId),
          );
        } else scheduleRetry(room);
      });
    }, SETTLEMENT_RETRY_MS);
    timer.unref();
  }

  return async (room) => {
    if (!(await attempt(room))) scheduleRetry(room);
  };
}
