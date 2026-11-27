import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PokerView, RoomSnapshot, UserDto } from '../../src/shared/protocol.js';
import { Client, startTestServer, uniqueName, type TestServer } from '../support/server.js';

let ts: TestServer;

beforeAll(async () => {
  ts = await startTestServer();
});

afterAll(async () => {
  await ts?.stop();
});

type ErrBody = { error: { code: string; message: string } };
type RoomBody = { room: RoomSnapshot };

async function user(label: string): Promise<{ c: Client; id: string }> {
  const c = new Client(ts.baseUrl);
  const u = await c.register(uniqueName(label));
  return { c, id: u.id };
}

async function waitState(c: Client, roomId: string, done: (room: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const res = await c.get<RoomBody>(`/api/rooms/${roomId}/state`);
    if (res.status === 200 && done(res.body.room)) return res.body.room;
    if (Date.now() > deadline) throw new Error(`timed out waiting for room state: ${JSON.stringify(res.body)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('POST /api/chess/ai-games', () => {
  it('creates an unlisted active game against the computer that nobody else can join', async () => {
    const u = await user('aiu');
    const res = await u.c.post<RoomBody>('/api/chess/ai-games', {});
    expect(res.status).toBe(201);
    const room = res.body.room;
    expect(room.mode).toBe('ai');
    expect(room.chess!.status).toBe('active');
    expect(room.chess!.yourColor).toBe('red');
    expect(room.chess!.players.black).toEqual({ computer: true, username: '电脑' });

    const lobby = await u.c.get<{ rooms: { id: string }[] }>('/api/rooms');
    expect(lobby.body.rooms.map((r) => r.id)).not.toContain(room.roomId);

    const other = await user('aio');
    const join = await other.c.post<ErrBody>(`/api/rooms/${room.roomId}/join`);
    expect(join.status).toBe(404);
    expect(join.body.error.code).toBe('ROOM_NOT_FOUND');

    expect((await u.c.post('/api/rooms', { game: 'chess' })).status).toBe(409);
    expect((await u.c.post('/api/chess/ai-games', {})).status).toBe(409);
  });

  it('requires login', async () => {
    const res = await new Client(ts.baseUrl).post<ErrBody>('/api/chess/ai-games', {});
    expect(res.status).toBe(401);
  });

  it('the computer replies automatically, accepts draws and settles without a black user', async () => {
    const u = await user('aip');
    const roomId = (await u.c.post<RoomBody>('/api/chess/ai-games', {})).body.room.roomId;
    const moved = await u.c.post<RoomBody>(`/api/rooms/${roomId}/chess/move`, { from: 'a3', to: 'a4' });
    expect(moved.status).toBe(200);
    const after = await waitState(u.c, roomId, (r) => r.chess!.lastMove?.side === 'black');
    expect(after.chess!.turn).toBe('red');

    const draw = await u.c.post<RoomBody>(`/api/rooms/${roomId}/chess/draw-offer`);
    expect(draw.status).toBe(200);
    expect(draw.body.room.chess!.status).toBe('finished');
    expect(draw.body.room.chess!.result?.outcome).toBe('draw');
    expect((await u.c.get<{ user: UserDto }>('/api/me')).body.user.rating).toBe(1000);
    await u.c.post(`/api/rooms/${roomId}/leave`);

    const second = (await u.c.post<RoomBody>('/api/chess/ai-games', {})).body.room;
    const resign = await u.c.post<RoomBody>(`/api/rooms/${second.roomId}/chess/resign`);
    expect(resign.status).toBe(200);
    expect((await u.c.get<{ user: UserDto }>('/api/me')).body.user.rating).toBe(990);
    const row = await ts.server.ctx.pool.query('SELECT black_user_id, mode FROM chess_results WHERE game_id = $1', [
      second.chess!.gameId,
    ]);
    expect(row.rows).toEqual([{ black_user_id: null, mode: 'ai' }]);
  });
});

describe('POST /api/rooms/:id/poker/bots', () => {
  it('lets only the host add bots between hands, up to the table size', async () => {
    const host = await user('pbh');
    const guest = await user('pbg');
    const roomId = (await host.c.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.roomId;
    expect((await guest.c.post(`/api/rooms/${roomId}/join`)).status).toBe(200);

    const denied = await guest.c.post<ErrBody>(`/api/rooms/${roomId}/poker/bots`, {});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('NOT_HOST');

    const added = await host.c.post<RoomBody>(`/api/rooms/${roomId}/poker/bots`, {});
    expect(added.status).toBe(201);
    const bot = added.body.room.poker!.seats.find((s) => s.kind === 'bot');
    expect(bot).toMatchObject({ name: '电脑 1', chips: 1000 });

    const lobby = await host.c.get<{ rooms: { id: string; players: number }[] }>('/api/rooms');
    expect(lobby.body.rooms.find((r) => r.id === roomId)).toMatchObject({ players: 3 });

    for (let i = 0; i < 6; i++) expect((await host.c.post(`/api/rooms/${roomId}/poker/bots`, {})).status).toBe(201);
    const full = await host.c.post<ErrBody>(`/api/rooms/${roomId}/poker/bots`, {});
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('ROOM_FULL');
  });

  it('a lone host can play against a bot that acts by itself; adding during a hand is rejected', async () => {
    const host = await user('pbs');
    const roomId = (await host.c.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.roomId;
    expect((await host.c.post(`/api/rooms/${roomId}/poker/start`)).status).toBe(409);
    expect((await host.c.post(`/api/rooms/${roomId}/poker/bots`, {})).status).toBe(201);
    const started = await host.c.post<RoomBody>(`/api/rooms/${roomId}/poker/start`);
    expect(started.status).toBe(200);

    const during = await host.c.post<ErrBody>(`/api/rooms/${roomId}/poker/bots`, {});
    expect(during.status).toBe(409);
    expect(during.body.error.code).toBe('HAND_IN_PROGRESS');

    const view = (r: RoomSnapshot) => r.poker as PokerView;
    const botSeat = view(started.body.room).seats.find((s) => s.kind === 'bot')!.seat;
    // Heads-up the dealer (the host) acts first preflop.
    expect(view(started.body.room).toActSeat).not.toBe(botSeat);
    expect((await host.c.post(`/api/rooms/${roomId}/poker/action`, { type: 'call' })).status).toBe(200);
    const room = await waitState(host.c, roomId, (r) =>
      view(r).actions.some((a) => a.seat === botSeat && !['small_blind', 'big_blind'].includes(a.type)),
    );
    expect(view(room).actions.length).toBeGreaterThan(2);
  });
});
