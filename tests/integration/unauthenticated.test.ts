import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, startTestServer, uniqueName, type TestServer } from '../support/server.js';

let ts: TestServer;

beforeAll(async () => {
  ts = await startTestServer();
});

afterAll(async () => {
  await ts?.stop();
});

const UNAUTH = { error: { code: 'UNAUTHENTICATED', message: '请先登录' } };

describe('unauthenticated access is rejected (AC-3)', () => {
  it('rejects protected REST endpoints without a session', async () => {
    const c = new Client(ts.baseUrl);
    const someId = '00000000-0000-4000-8000-000000000000';
    const calls = [
      c.get('/api/me'),
      c.get('/api/rooms'),
      c.post('/api/rooms', { game: 'chess' }),
      c.post(`/api/rooms/${someId}/join`),
      c.post(`/api/rooms/${someId}/leave`),
      c.get(`/api/rooms/${someId}/state`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTH);
    }
  });

  it('rejects a forged session cookie', async () => {
    const c = new Client(ts.baseUrl);
    c.cookie = 'dg_session=forged-token-value';
    const res = await c.get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTH);
  });

  it('rejects the socket handshake without a valid session and accepts it with one', async () => {
    const anon = new Client(ts.baseUrl).socket();
    const err = await new Promise<Error>((resolve) => anon.on('connect_error', resolve));
    expect(err.message).toMatch(/unauthorized|websocket error|xhr poll error/i);
    expect(anon.connected).toBe(false);
    anon.close();

    const forged = new Client(ts.baseUrl);
    forged.cookie = 'dg_session=forged';
    const fs = forged.socket();
    await new Promise((resolve) => fs.on('connect_error', resolve));
    expect(fs.connected).toBe(false);
    fs.close();

    const user = new Client(ts.baseUrl);
    await user.register(uniqueName('sock'));
    const ok = user.socket();
    await new Promise<void>((resolve, reject) => {
      ok.on('connect', () => resolve());
      ok.on('connect_error', reject);
    });
    expect(ok.connected).toBe(true);
    ok.close();
  });

  it('rejects polling handshakes without a session with "unauthorized"', async () => {
    const res = await fetch(`${ts.baseUrl}/socket.io/?EIO=4&transport=polling`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('unauthorized');
  });
});
