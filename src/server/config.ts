export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | true | { rejectUnauthorized: false };
}

export interface AppConfig {
  port: number;
  production: boolean;
  db: DbConfig;
  dbSchema: string;
  cookieSecure: boolean;
  aiMoveDelayMs: number;
  pokerBotDelayMs: number;
  pokerNextHandDelayMs: number;
  logLevel: string;
}

export class ConfigError extends Error {}

function intVar(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer`);
  return n;
}

function boolVar(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`${name} must be true or false`);
}

function sslFor(mode: string): DbConfig['ssl'] {
  switch (mode.toLowerCase()) {
    case '':
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full':
      return true;
    default:
      throw new ConfigError('AIDH_DEP_POSTGRES_SSLMODE must be disable, require or verify-full');
  }
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const production = env.NODE_ENV === 'production';
  const authMode = env.AIDH_DEP_POSTGRES_AUTH_MODE ?? 'credential';
  if (authMode !== '' && authMode !== 'credential') {
    throw new ConfigError('AIDH_DEP_POSTGRES_AUTH_MODE only supports credential');
  }
  const address = env.AIDH_DEP_POSTGRES_ADDRESS ?? '';
  const sep = address.lastIndexOf(':');
  const host = sep > 0 ? address.slice(0, sep) : '';
  const port = sep > 0 ? Number(address.slice(sep + 1)) : NaN;
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new ConfigError('AIDH_DEP_POSTGRES_ADDRESS must be host:port');
  }
  const dbSchema = env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(dbSchema)) {
    throw new ConfigError('DB_SCHEMA must be a lowercase identifier');
  }
  return {
    port: intVar(env, 'PORT', 8080),
    production,
    db: {
      host,
      port,
      database: env.AIDH_DEP_POSTGRES_DATABASE ?? '',
      user: env.AIDH_DEP_POSTGRES_USER ?? '',
      password: env.AIDH_DEP_POSTGRES_PASSWORD ?? '',
      ssl: sslFor(env.AIDH_DEP_POSTGRES_SSLMODE ?? 'disable'),
    },
    dbSchema,
    cookieSecure: boolVar(env, 'COOKIE_SECURE', production),
    aiMoveDelayMs: intVar(env, 'AI_MOVE_DELAY_MS', 600),
    pokerBotDelayMs: intVar(env, 'POKER_BOT_DELAY_MS', 800),
    pokerNextHandDelayMs: intVar(env, 'POKER_NEXT_HAND_DELAY_MS', 4000),
    logLevel: env.LOG_LEVEL || 'info',
  };
}
