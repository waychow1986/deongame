import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PokerView, RoomSnapshot, UserDto } from '../../src/shared/protocol.js';
import { Client, startTestServer, uniqueName, waitForEvent, type TestServer } from '../support/server.js';

let ts: TestServer;

beforeAll(async () => {
  ts = await startTestServer();
});

afterAll(async () => {
  await ts?.stop();
});

type ErrBody = { error: { code: string; message: string } };
type RoomBody = { room: RoomSnapshot };

interface Player {
  c: Client;
  id: string;
  name: string;
}

async function user(label: string): Promise<Player> {
  const c = new Client(ts.baseUrl);
  const name = uniqueName(label);
  const u = await c.register(name);
  return { c, id: u.id, name };
}

async function me(p: Player): Promise<UserDto> {
  return (await p.c.get<{ user: UserDto }>('/api/me')).body.user;
}

async function setChips(p: Player, chips: number): Promise<void> {
  await ts.server.ctx.pool.query('UPDATE users SET chips_balance = $2 WHERE id = $1', [p.id, chips]);
}

/** Host creates a poker room and the others join, in seat order. */
async function table(...players: Player[]): Promise<string> {
  const [host, ...rest] = players as [Player, ...Player[]];
  const roomId = (await host.c.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.roomId;
  for (const p of rest) expect((await p.c.post(`/api/rooms/${roomId}/join`)).status).toBe(200);
  return roomId;
}

async function start(host: Player, roomId: string): Promise<PokerView> {
  const res = await host.c.post<RoomBody>(`/api/rooms/${roomId}/poker/start`);
  expect(res.status).toBe(200);
  return res.body.room.poker as PokerView;
}

function act(p: Player, roomId: string, type: string, amount?: number) {
  return p.c.post<RoomBody & ErrBody>(`/api/rooms/${roomId}/poker/action`, amount === undefined ? { type } : { type, amount });
}

async function ok(p: Player, roomId: string, type: string, amount?: number): Promise<PokerView> {
  const res = await act(p, roomId, type, amount);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.room.poker as PokerView;
}

async function view(p: Player, roomId: string): Promise<PokerView> {
  return (await p.c.get<RoomBody>(`/api/rooms/${roomId}/state`)).body.room.poker as PokerView;
}

function seatOf(v: PokerView, p: Player) {
  return v.seats.find((s) => s.userId === p.id)!;
}

async function settlements(handId: string): Promise<Record<string, number>> {
  const res = await ts.server.ctx.pool.query<{ user_id: string; delta: string }>(
    'SELECT user_id, delta FROM poker_settlements WHERE hand_id = $1',
    [handId],
  );
  return Object.fromEntries(res.rows.map((r) => [r.user_id, Number(r.delta)]));
}

/** Everybody checks or calls until the hand is over; returns the final snapshot. */
async function checkDown(players: Player[], roomId: string, v: PokerView): Promise<PokerView> {
  let cur = v;
  for (let i = 0; i < 40 && cur.toActSeat !== null; i++) {
    const seat = cur.seats.find((s) => s.seat === cur.toActSeat)!;
    const p = players.find((x) => x.id === seat.userId)!;
    const mine = await view(p, roomId);
    cur = await ok(p, roomId, mine.you.legal?.check ? 'check' : 'call');
  }
  return cur;
}

describe('poker hands (AC-14)', () => {
  it('posts blinds left of the host dealer and deals two private hole cards (TS-31)', async () => {
    const [u1, u2, u3] = [await user('p1'), await user('p2'), await user('p3')];
    const roomId = await table(u1, u2, u3);
    const v = await start(u1, roomId);
    expect(v.stage).toBe('preflop');
    expect(v.pot).toBe(15);
    expect(v.board).toEqual([]);
    expect(seatOf(v, u1)).toMatchObject({ isDealer: true, chips: 1000, committedThisHand: 0 });
    expect(seatOf(v, u2)).toMatchObject({ isSmallBlind: true, chips: 995, committedThisHand: 5 });
    expect(seatOf(v, u3)).toMatchObject({ isBigBlind: true, chips: 990, committedThisHand: 10 });
    expect(v.toActSeat).toBe(seatOf(v, u1).seat);
    const seen: string[] = [];
    for (const p of [u1, u2, u3]) {
      const pv = await view(p, roomId);
      for (const s of pv.seats) {
        if (s.userId === p.id) expect(s.holeCards).toHaveLength(2);
        else expect(s.holeCards).toBeUndefined();
      }
      seen.push(...(seatOf(pv, p).holeCards ?? []));
    }
    expect(new Set(seen).size).toBe(6);

    // Heads-up: the dealer (host) posts the small blind and acts first.
    const [u4, u5] = [await user('p4'), await user('p5')];
    const hu = await start(u4, await table(u4, u5));
    expect(seatOf(hu, u4)).toMatchObject({ isDealer: true, isSmallBlind: true, chips: 995 });
    expect(seatOf(hu, u5)).toMatchObject({ isBigBlind: true, chips: 990 });
    expect(hu.toActSeat).toBe(seatOf(hu, u4).seat);
  });

  it('enforces turn, call, minimum bet/raise rules and ignores a duplicate call (TS-32, TS-33)', async () => {
    const [a, b] = [await user('a'), await user('b')];
    const roomId = await table(a, b);
    await start(a, roomId);
    const before = await view(a, roomId);
    const outOfTurn = await act(b, roomId, 'fold');
    expect(outOfTurn.status).toBe(409);
    expect(outOfTurn.body.error.code).toBe('NOT_YOUR_TURN');
    const check = await act(a, roomId, 'check');
    expect(check.body.error).toEqual({ code: 'ILLEGAL_ACTION', message: '当前需要跟注，不能过牌' });
    expect(await view(a, roomId)).toEqual(before);
    await ok(a, roomId, 'call');
    let v = await ok(b, roomId, 'check');
    expect(v.stage).toBe('flop');
    expect(v.board).toHaveLength(3);
    expect(v.toActSeat).toBe(seatOf(v, b).seat);
    expect((await act(b, roomId, 'bet', 9)).body.error.message).toBe('加注额低于最小加注');
    await ok(b, roomId, 'bet', 10);
    expect((await act(a, roomId, 'raise', 19)).status).toBe(409);
    await ok(a, roomId, 'raise', 20);
    await ok(b, roomId, 'raise', 50);
    expect((await act(a, roomId, 'raise', 79)).body.error.code).toBe('ILLEGAL_ACTION');
    v = await ok(a, roomId, 'raise', 80);
    expect(v.actions.at(-1)).toMatchObject({ type: 'raise', amount: 60, to: 80 });
    expect(seatOf(v, a)).toMatchObject({ chips: 910, committedThisHand: 90 });
    expect(v.pot).toBe(150);
    v = await ok(b, roomId, 'call');
    expect(v.stage).toBe('turn');
    expect(v.board).toHaveLength(4);
    await ok(b, roomId, 'check');
    await ok(a, roomId, 'bet', 10);
    const results = await Promise.all([act(b, roomId, 'call'), act(b, roomId, 'call')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    v = await view(b, roomId);
    expect(v.stage).toBe('river');
    expect(seatOf(v, b)).toMatchObject({ chips: 900, committedThisHand: 100 });
  });

  it('pushes each action to the other players in real time (AC-16)', async () => {
    const [a, b] = [await user('rt1'), await user('rt2')];
    const roomId = await table(a, b);
    await start(a, roomId);
    const sock = b.c.socket();
    try {
      await waitForEvent(sock, 'room:state');
      const pushed = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => (s.poker?.actions.length ?? 0) > 2);
      await ok(a, roomId, 'raise', 30);
      const v = (await pushed).poker as PokerView;
      expect(v.actions.at(-1)).toMatchObject({ name: a.name, type: 'raise', to: 30 });
      expect(v.pot).toBe(40);
      expect(seatOf(v, a).chips).toBe(970);
      expect(v.toActSeat).toBe(seatOf(v, b).seat);
      expect(seatOf(v, a).holeCards).toBeUndefined();
    } finally {
      sock.disconnect();
    }
  });

  it('ends a hand folded to one without dealing or revealing, settles once and starts the next hand (TS-35, TS-47)', async () => {
    const [a, b, c] = [await user('f1'), await user('f2'), await user('f3')];
    const roomId = await table(a, b, c);
    const first = await start(a, roomId);
    await ok(a, roomId, 'raise', 30);
    await ok(b, roomId, 'fold');
    const v = await ok(c, roomId, 'fold');
    expect(v.stage).toBe('complete');
    expect(v.board).toEqual([]);
    expect(v.showdown).toEqual([]);
    expect(v.winners).toEqual([{ seat: seatOf(v, a).seat, name: a.name, amount: 45 }]);
    expect(v.seats.filter((s) => s.userId !== c.id && s.holeCards)).toEqual([]);
    expect(await settlements(first.handId!)).toEqual({ [a.id]: 15, [b.id]: -5, [c.id]: -10 });
    expect(await me(a)).toMatchObject({ chips: 1015, rating: 1000 });
    expect((await me(b)).chips).toBe(995);

    // The next hand starts on its own with the dealer moved one seat clockwise.
    let next = await view(a, roomId);
    for (let i = 0; i < 50 && next.handNumber < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
      next = await view(a, roomId);
    }
    expect(next.handNumber).toBe(2);
    expect(seatOf(next, b)).toMatchObject({ isDealer: true, chips: 995 });
    expect(seatOf(next, c)).toMatchObject({ isSmallBlind: true, chips: 985 });
    expect(seatOf(next, a)).toMatchObject({ isBigBlind: true, chips: 1005 });
  });

  it('reveals showdown hands to everybody and distributes exactly the pot (TS-34)', async () => {
    const [a, b] = [await user('s1'), await user('s2')];
    const roomId = await table(a, b);
    const first = await start(a, roomId);
    const v = await checkDown([a, b], roomId, first);
    expect(v.stage).toBe('showdown');
    expect(v.board).toHaveLength(5);
    expect(v.showdown).toHaveLength(2);
    for (const s of v.showdown) expect(seatOf(v, a).seat === s.seat || seatOf(v, b).seat === s.seat).toBe(true);
    expect(v.winners.reduce((sum, w) => sum + w.amount, 0)).toBe(20);
    expect(v.seats.every((s) => s.holeCards?.length === 2)).toBe(true);
    const rows = await settlements(first.handId!);
    for (const p of [a, b]) {
      const won = v.winners.find((w) => w.seat === seatOf(v, p).seat)?.amount ?? 0;
      expect(rows[p.id]).toBe(won - 10);
      expect((await me(p)).chips).toBe(1000 + won - 10);
    }
  });

  it('a player joining mid-hand waits for the next hand without seeing hole cards (TS-37)', async () => {
    const [a, b, d] = [await user('j1'), await user('j2'), await user('j3')];
    const roomId = await table(a, b);
    await start(a, roomId);
    await ok(a, roomId, 'call');
    const joined = (await d.c.post<RoomBody>(`/api/rooms/${roomId}/join`)).body.room.poker as PokerView;
    expect(seatOf(joined, d)).toMatchObject({ inHand: false, waitingNextHand: true, chips: 1000 });
    expect(joined.seats.filter((s) => s.holeCards)).toEqual([]);
    expect(joined.you.legal).toBeNull();
    expect((await act(d, roomId, 'check')).body.error.code).toBe('NOT_YOUR_TURN');
  });

  it('leaving mid-hand folds the player and keeps what they put in (TS-38)', async () => {
    const [a, b, c] = [await user('l1'), await user('l2'), await user('l3')];
    const roomId = await table(a, b, c);
    const first = await start(a, roomId);
    await ok(a, roomId, 'call');
    await ok(b, roomId, 'call');
    expect((await c.c.post(`/api/rooms/${roomId}/leave`)).status).toBe(200);
    const v = await view(a, roomId);
    expect(v.seats.map((s) => s.userId)).toEqual([a.id, b.id]);
    expect(v.actions.at(-1)).toMatchObject({ name: c.name, type: 'leave_fold' });
    expect(v.stage).toBe('flop');
    expect(v.pot).toBe(30);
    expect((await me(c)).chips).toBe(990);
    expect(await settlements(first.handId!)).toEqual({ [c.id]: -10 });
  });
});

describe('poker chips (AC-15)', () => {
  it('lets balances at and below zero keep playing and go negative; caps a hand at 1000 (TS-39, TS-41)', async () => {
    const [a, b] = [await user('n1'), await user('n2')];
    await setChips(a, 0);
    await setChips(b, 3);
    const roomId = await table(a, b);
    const first = await start(a, roomId);
    expect(seatOf(first, b)).toMatchObject({ isBigBlind: true, chips: -7 });
    expect(seatOf(first, a).chips).toBe(-5);
    const over = await act(a, roomId, 'raise', 1001);
    expect(over.body.error).toEqual({ code: 'ILLEGAL_ACTION', message: '超出每手下注上限 1000' });
    await ok(a, roomId, 'raise', 999);
    const v = await ok(b, roomId, 'raise', 1000);
    expect(seatOf(v, b)).toMatchObject({ chips: -997, committedThisHand: 1000, atCap: true });
    const end = await ok(a, roomId, 'call');
    expect(end.stage).toBe('showdown');
    expect(end.board).toHaveLength(5);
    expect(end.winners.reduce((s, w) => s + w.amount, 0)).toBe(2000);
    const rows = await settlements(first.handId!);
    expect(rows[a.id]! + rows[b.id]!).toBe(0);
    expect((await me(a)).chips).toBe(rows[a.id]);
    expect((await me(b)).chips).toBe(3 + rows[b.id]!);
    // Unless the pot was split, the loser's stored balance is now negative.
    if (rows[a.id] !== 0) expect(Math.min((await me(a)).chips, (await me(b)).chips)).toBeLessThan(-990);
    // Both are dealt into the next hand regardless of their balance (FR-063).
    const next = await view(a, roomId);
    expect(next.handNumber).toBe(2);
    expect([seatOf(next, a).inHand, seatOf(next, b).inHand]).toEqual([true, true]);
  });

  it('keeps chips across rooms and logins, independent of rating (TS-42)', async () => {
    const [a, b] = [await user('k1'), await user('k2')];
    const roomId = await table(a, b);
    await start(a, roomId);
    await ok(a, roomId, 'fold');
    expect(await me(a)).toMatchObject({ chips: 995, rating: 1000 });
    // The next hand has already started (no delay in tests); leaving it forfeits the big blind posted there.
    await a.c.post(`/api/rooms/${roomId}/leave`);
    const balance = (await me(a)).chips;
    expect(balance).toBe(985);
    const r2 = (await a.c.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.poker as PokerView;
    expect(seatOf(r2, a).chips).toBe(balance);
    const again = new Client(ts.baseUrl);
    expect((await again.post('/api/auth/login', { username: a.name, password: 'pw-123456' })).status).toBe(200);
    expect((await again.get<{ user: UserDto }>('/api/me')).body.user).toMatchObject({ chips: balance, rating: 1000 });
  });

  it('rejects starting by a non-host, alone, or while a hand runs, and malformed actions', async () => {
    const [a, b] = [await user('e1'), await user('e2')];
    const roomId = (await a.c.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.roomId;
    const alone = await a.c.post<ErrBody>(`/api/rooms/${roomId}/poker/start`);
    expect([alone.status, alone.body.error.code]).toEqual([409, 'NOT_ENOUGH_PLAYERS']);
    await b.c.post(`/api/rooms/${roomId}/join`);
    const notHost = await b.c.post<ErrBody>(`/api/rooms/${roomId}/poker/start`);
    expect([notHost.status, notHost.body.error.code]).toEqual([403, 'NOT_HOST']);
    expect((await act(a, roomId, 'call')).body.error.code).toBe('GAME_NOT_ACTIVE');
    await start(a, roomId);
    const twice = await a.c.post<ErrBody>(`/api/rooms/${roomId}/poker/start`);
    expect([twice.status, twice.body.error.code]).toEqual([409, 'HAND_IN_PROGRESS']);
    expect((await act(a, roomId, 'shove')).status).toBe(400);
    expect((await act(a, roomId, 'raise', 25.5)).status).toBe(400);
    const lobby = (await b.c.get<{ rooms: { id: string; status: string }[] }>('/api/rooms')).body.rooms;
    expect(lobby.find((r) => r.id === roomId)?.status).toBe('playing');
  });
});
