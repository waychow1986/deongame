import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { io as ioClient, type Socket } from 'socket.io-client';
import { parseConfig } from '../../src/server/config.js';
import { createServer, type RunningServer } from '../../src/server/http/app.js';
import { createLogger } from '../../src/server/logger.js';
import { seededRng } from '../../src/shared/rng.js';

export const RUN_ID = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

export interface TestServer {
  baseUrl: string;
  server: RunningServer;
  stop(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const worker = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';
  const schema = `it_${RUN_ID}_${worker}`.toLowerCase();
  const config = parseConfig({
    ...process.env,
    DB_SCHEMA: schema,
    COOKIE_SECURE: 'false',
    AI_MOVE_DELAY_MS: '0',
    POKER_BOT_DELAY_MS: '0',
    POKER_NEXT_HAND_DELAY_MS: '0',
    PORT: '0',
  });
  const logger = createLogger(process.env.TEST_LOG_LEVEL ?? 'silent');
  const server = await createServer({ config, rng: seededRng(42), logger });
  const port = await server.listen(0, '127.0.0.1');
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    async stop() {
      await server.close();
      const client = new pg.Client({ ...config.db });
      await client.connect();
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await client.end();
      }
    },
  };
}

export function uniqueName(label: string): string {
  return `qa_${RUN_ID}_${label}_${randomBytes(2).toString('hex')}`;
}

export interface HttpResult<T = unknown> {
  status: number;
  body: T;
  setCookie: string | null;
}

/** Minimal cookie-aware HTTP client for one simulated user. */
export class Client {
  cookie: string | null = null;
  constructor(readonly baseUrl: string) {}

  async req<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult<T>> {
    const h: Record<string, string> = { ...headers };
    if (body !== undefined && !('Content-Type' in h)) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? null;
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, setCookie };
  }

  get<T = Record<string, unknown>>(path: string) {
    return this.req<T>('GET', path);
  }

  post<T = Record<string, unknown>>(path: string, body: unknown = {}) {
    return this.req<T>('POST', path, body);
  }

  async register(username: string, password = 'pw-123456'): Promise<{ id: string; username: string }> {
    const res = await this.post<{ user: { id: string; username: string } }>('/api/auth/register', { username, password });
    if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
    return res.body.user;
  }

  socket(): Socket {
    return ioClient(this.baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: this.cookie ? { Cookie: this.cookie } : {},
    });
  }
}

export function waitForEvent<T>(socket: Socket, event: string, predicate: (v: T) => boolean = () => true, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (v: T) => {
      if (!predicate(v)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(v);
    };
    socket.on(event, handler);
  });
}
