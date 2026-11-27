import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  rating: number;
  chips_balance: number;
}

const COLUMNS = 'id, username, password_hash, rating, chips_balance::float8 AS chips_balance';

export class UsernameTakenError extends Error {}

export class UserRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(username: string, passwordHash: string): Promise<UserRow> {
    try {
      const res = await this.pool.query<UserRow>(
        `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [randomUUID(), username, passwordHash],
      );
      return res.rows[0] as UserRow;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new UsernameTakenError();
      throw err;
    }
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE username = $1`, [username]);
    return res.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }
}
