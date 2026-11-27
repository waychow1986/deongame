import type pg from 'pg';

/**
 * Writes the net chip change of each user for one hand in one transaction (TD-011). The
 * (hand_id, user_id) primary key makes the write idempotent: a user is charged at most once per hand.
 */
export async function settlePokerHand(
  pool: pg.Pool,
  handId: string,
  deltas: { userId: string; delta: number }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const d of deltas) {
      const ins = await client.query(
        `INSERT INTO poker_settlements (hand_id, user_id, delta) VALUES ($1, $2, $3)
         ON CONFLICT (hand_id, user_id) DO NOTHING`,
        [handId, d.userId, d.delta],
      );
      if (ins.rowCount === 0) continue;
      await client.query('UPDATE users SET chips_balance = chips_balance + $2 WHERE id = $1', [d.userId, d.delta]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function loadChipBalances(pool: pg.Pool, userIds: string[]): Promise<Map<string, number>> {
  const res = await pool.query<{ id: string; chips_balance: number }>(
    'SELECT id, chips_balance::float8 AS chips_balance FROM users WHERE id = ANY($1::uuid[])',
    [userIds],
  );
  return new Map(res.rows.map((r) => [r.id, Number(r.chips_balance)]));
}
