import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, startTestServer, uniqueName, type TestServer } from '../support/server.js';

let ts: TestServer;

beforeAll(async () => {
  ts = await startTestServer();
});

afterAll(async () => {
  await ts?.stop();
});

type UserBody = { user: { id: string; username: string; rating: number; chips: number; currentRoomId: string | null } };
type ErrBody = { error: { code: string; message: string } };

describe('register and login (AC-1, AC-2)', () => {
  it('registers a new user with 1000 rating and chips and logs them in', async () => {
    const c = new Client(ts.baseUrl);
    const username = uniqueName('alice');
    const res = await c.post<UserBody>('/api/auth/register', { username, password: 'pw-1' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username, rating: 1000, chips: 1000, currentRoomId: null });
    expect(res.setCookie).toMatch(/^dg_session=[^;]+;/);
    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/SameSite=Lax/i);
    const me = await c.get<UserBody>('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe(username);
  });

  it('logs in with the right password from a new client', async () => {
    const username = uniqueName('bob');
    await new Client(ts.baseUrl).register(username, 'right-pw');
    const c = new Client(ts.baseUrl);
    const res = await c.post<UserBody>('/api/auth/login', { username, password: 'right-pw' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username, rating: 1000, chips: 1000 });
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('rejects a wrong password or unknown user with the same message', async () => {
    const username = uniqueName('carol');
    await new Client(ts.baseUrl).register(username, 'right-pw');
    const wrong = await new Client(ts.baseUrl).post<ErrBody>('/api/auth/login', { username, password: 'wrong' });
    const unknown = await new Client(ts.baseUrl).post<ErrBody>('/api/auth/login', { username: uniqueName('nobody'), password: 'x' });
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
      expect(r.setCookie).toBeNull();
    }
  });

  it('rejects a taken username, including under concurrent registration', async () => {
    const username = uniqueName('dave');
    await new Client(ts.baseUrl).register(username);
    const again = await new Client(ts.baseUrl).post<ErrBody>('/api/auth/register', { username, password: 'other' });
    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({ code: 'USERNAME_TAKEN', message: '用户名已被占用' });

    const racer = uniqueName('race');
    const results = await Promise.all(
      [0, 1, 2].map(() => new Client(ts.baseUrl).post('/api/auth/register', { username: racer, password: 'pw' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it('treats usernames as case-sensitive', async () => {
    const username = uniqueName('Eve');
    await new Client(ts.baseUrl).register(username);
    const res = await new Client(ts.baseUrl).post('/api/auth/register', { username: username.toLowerCase(), password: 'pw' });
    expect(res.status).toBe(201);
  });

  it('requires username and password (blank after trimming)', async () => {
    const c = new Client(ts.baseUrl);
    const cases: [unknown, string][] = [
      [{ username: '', password: 'pw' }, '用户名为必填项'],
      [{ username: '   ', password: 'pw' }, '用户名为必填项'],
      [{ password: 'pw' }, '用户名为必填项'],
      [{ username: uniqueName('f'), password: '' }, '密码为必填项'],
      [{ username: uniqueName('f'), password: '  ' }, '密码为必填项'],
    ];
    for (const path of ['/api/auth/register', '/api/auth/login']) {
      for (const [body, message] of cases) {
        const res = await c.post<ErrBody>(path, body);
        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({ code: 'VALIDATION_FAILED', message });
      }
    }
    expect(c.cookie).toBeNull();
  });

  it('rejects non-JSON write requests and malformed bodies', async () => {
    const c = new Client(ts.baseUrl);
    const form = await c.req<ErrBody>('POST', '/api/auth/login', 'username=a&password=b', {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(415);
    expect(form.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const bad = await c.req<ErrBody>('POST', '/api/auth/login', '{not json');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const typed = await c.post<ErrBody>('/api/auth/login', { username: 1, password: 'x' });
    expect(typed.status).toBe(400);
  });

  it('names the over-long field, reporting the username first (AC-10)', async () => {
    const c = new Client(ts.baseUrl);
    const long = 'x'.repeat(201);
    const cases: [unknown, string][] = [
      [{ username: long, password: 'pw' }, '用户名不能超过 200 个字符'],
      [{ username: uniqueName('l'), password: long }, '密码不能超过 200 个字符'],
      [{ username: long, password: long }, '用户名不能超过 200 个字符'],
    ];
    for (const path of ['/api/auth/register', '/api/auth/login']) {
      for (const [body, message] of cases) {
        const res = await c.post<ErrBody>(path, body);
        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({ code: 'VALIDATION_FAILED', message });
      }
    }
  });

  it('logs out: clears the cookie and revokes the session (AC-4)', async () => {
    const c = new Client(ts.baseUrl);
    await c.register(uniqueName('out'));
    const oldCookie = c.cookie;
    const res = await c.post('/api/auth/logout', {});
    expect(res.status).toBe(204);
    expect(res.setCookie).toMatch(/^dg_session=;/);
    expect(res.setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect((await c.get('/api/me')).status).toBe(401);
    const replay = new Client(ts.baseUrl);
    replay.cookie = oldCookie;
    expect((await replay.get('/api/me')).status).toBe(401);
    expect((await new Client(ts.baseUrl).post('/api/auth/logout', {})).status).toBe(204);
  });

  it('reports activeRoomId only while the room is open (AC-1, AC-2)', async () => {
    const c = new Client(ts.baseUrl);
    await c.register(uniqueName('act'));
    type Me = { user: { activeRoomId: string | null; currentRoomId: string | null } };
    expect((await c.get<Me>('/api/me')).body.user.activeRoomId).toBeNull();
    const created = await c.post<{ room: { roomId: string } }>('/api/chess/ai-games', {});
    const roomId = created.body.room.roomId;
    expect((await c.get<Me>('/api/me')).body.user).toMatchObject({ activeRoomId: roomId, currentRoomId: roomId });
    await c.post(`/api/rooms/${roomId}/chess/resign`, {});
    expect((await c.get<Me>('/api/me')).body.user).toMatchObject({ activeRoomId: null, currentRoomId: roomId });
    await c.post(`/api/rooms/${roomId}/leave`);
    expect((await c.get<Me>('/api/me')).body.user.activeRoomId).toBeNull();
  });

  it('reports health', async () => {
    const res = await fetch(`${ts.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
