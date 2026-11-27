import type pg from 'pg';
import { settlePokerHand } from '../db/pokerSettlements.js';
import type { Logger } from '../logger.js';
import { SETTLEMENT_RETRY_MS } from './chessSettlement.js';
import type { Room } from './roomManager.js';

type Deltas = { userId: string; delta: number }[];

/**
 * Persists the net chip changes of a hand (TD-011). Runs inside the room lock; on a DB failure the
 * write is retried in the background every 5 s and the primary key prevents double charging.
 */
export function createPokerSettler(
  pool: pg.Pool,
  logger: Logger,
): (room: Room, handId: string, deltas: Deltas) => Promise<void> {
  async function attempt(room: Room, handId: string, deltas: Deltas): Promise<boolean> {
    try {
      await settlePokerHand(pool, handId, deltas);
      logger.info({ event: 'poker_hand_settled', roomId: room.id, handId, count: deltas.length }, 'poker hand settled');
      return true;
    } catch (err) {
      logger.error(
        { event: 'settlement_failed', roomId: room.id, handId, err: (err as Error).message },
        'poker settlement failed',
      );
      return false;
    }
  }

  function scheduleRetry(room: Room, handId: string, deltas: Deltas): void {
    const timer = setTimeout(() => {
      void attempt(room, handId, deltas).then((ok) => {
        if (ok) logger.info({ event: 'settlement_retried_ok', roomId: room.id, handId }, 'settlement retried');
        else scheduleRetry(room, handId, deltas);
      });
    }, SETTLEMENT_RETRY_MS);
    timer.unref();
  }

  return async (room, handId, deltas) => {
    if (!(await attempt(room, handId, deltas))) scheduleRetry(room, handId, deltas);
  };
}
