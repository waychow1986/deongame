import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../../src/server/config.js';

const base = {
  AIDH_DEP_POSTGRES_ADDRESS: 'db.example:5432',
  AIDH_DEP_POSTGRES_DATABASE: 'app',
  AIDH_DEP_POSTGRES_USER: 'u',
  AIDH_DEP_POSTGRES_PASSWORD: 'p',
};

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig({ ...base });
    expect(c.port).toBe(8080);
    expect(c.db.host).toBe('db.example');
    expect(c.db.port).toBe(5432);
    expect(c.db.ssl).toBe(false);
    expect(c.dbSchema).toBe('public');
    expect(c.cookieSecure).toBe(false);
    expect(c.aiMoveDelayMs).toBe(600);
    expect(c.pokerBotDelayMs).toBe(800);
    expect(c.pokerNextHandDelayMs).toBe(4000);
  });

  it('enables secure cookies in production unless overridden', () => {
    expect(parseConfig({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    expect(parseConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
  });

  it('maps ssl modes', () => {
    expect(parseConfig({ ...base, AIDH_DEP_POSTGRES_SSLMODE: 'require' }).db.ssl).toEqual({ rejectUnauthorized: false });
    expect(parseConfig({ ...base, AIDH_DEP_POSTGRES_SSLMODE: 'verify-full' }).db.ssl).toBe(true);
    expect(() => parseConfig({ ...base, AIDH_DEP_POSTGRES_SSLMODE: 'prefer' })).toThrow(ConfigError);
  });

  it('rejects unsupported auth modes, bad addresses and bad numbers', () => {
    expect(() => parseConfig({ ...base, AIDH_DEP_POSTGRES_AUTH_MODE: 'managed-identity' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...base, AIDH_DEP_POSTGRES_ADDRESS: 'nohost' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...base, PORT: 'abc' })).toThrow(ConfigError);
    expect(() => parseConfig({ ...base, DB_SCHEMA: 'Bad;Schema' })).toThrow(ConfigError);
  });

  it('reads delay overrides', () => {
    const c = parseConfig({ ...base, AI_MOVE_DELAY_MS: '50', POKER_BOT_DELAY_MS: '50', POKER_NEXT_HAND_DELAY_MS: '500' });
    expect([c.aiMoveDelayMs, c.pokerBotDelayMs, c.pokerNextHandDelayMs]).toEqual([50, 50, 500]);
  });
});
