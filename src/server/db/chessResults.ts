import type pg from 'pg';
import type { ChessOutcome, ChessReason, RoomMode } from '../../shared/protocol.js';

export interface ChessSettlementInput {
  gameId: string;
  redUserId: string;
  blackUserId: string | null;
  mode: RoomMode;
  outcome: ChessOutcome;
  reason: ChessReason;
  /** Rating deltas for human players only. */
  deltas: { userId: string; delta: number }[];
}

export interface RatingChange {
  userId: string;
  delta: number;
  rating: number;
}

/**
 * Writes the result and rating changes in one transaction (TD-010). Returns null when the
 * game was already settled (primary-key conflict), so each game is scored at most once.
 */
export async function settleChessGame(pool: pg.Pool, input: ChessSettlementInput): Promise<RatingChange[] | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO chess_results (game_id, red_user_id, black_user_id, mode, outcome, reason)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (game_id) DO NOTHING`,
      [input.gameId, input.redUserId, input.blackUserId, input.mode, input.outcome, input.reason],
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const changes: RatingChange[] = [];
    for (const d of input.deltas) {
      const res = await client.query<{ rating: number }>(
        'UPDATE users SET rating = rating + $2 WHERE id = $1 RETURNING rating',
        [d.userId, d.delta],
      );
      changes.push({ userId: d.userId, delta: d.delta, rating: Number(res.rows[0]?.rating ?? 0) });
    }
    await client.query('COMMIT');
    return changes;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
