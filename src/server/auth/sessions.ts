import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { SESSION_RENEW_BELOW_DAYS, SESSION_TTL_DAYS } from '../../shared/constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionStore {
  constructor(private readonly pool: pg.Pool) {}

  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()', [userId]);
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      hashToken(token),
      userId,
      expiresAt,
    ]);
    return { token, expiresAt };
  }

  /** Deletes the session for the token; returns its user id when one existed. */
  async revoke(token: string | undefined): Promise<string | null> {
    if (!token || token.length > 200) return null;
    const res = await this.pool.query<{ user_id: string }>('DELETE FROM sessions WHERE token_hash = $1 RETURNING user_id', [
      hashToken(token),
    ]);
    return res.rows[0]?.user_id ?? null;
  }

  /** Returns the user id for a valid token; renews the session when it is close to expiry. */
  async resolve(token: string | undefined): Promise<{ userId: string; renewedUntil: Date | null } | null> {
    if (!token || token.length > 200) return null;
    const res = await this.pool.query<{ user_id: string; expires_at: Date }>(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()',
      [hashToken(token)],
    );
    const row = res.rows[0];
    if (!row) return null;
    let renewedUntil: Date | null = null;
    if (row.expires_at.getTime() - Date.now() < SESSION_RENEW_BELOW_DAYS * DAY_MS) {
      renewedUntil = new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS);
      await this.pool.query('UPDATE sessions SET expires_at = $2 WHERE token_hash = $1', [hashToken(token), renewedUntil]);
    }
    return { userId: row.user_id, renewedUntil };
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}
