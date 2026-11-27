import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChessGameState } from '../../src/server/rooms/roomManager.js';
import type { ChessView, RoomSnapshot, UserDto } from '../../src/shared/protocol.js';
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

async function user(label: string): Promise<Client> {
  const c = new Client(ts.baseUrl);
  await c.register(uniqueName(label));
  return c;
}

async function me(c: Client): Promise<UserDto> {
  return (await c.get<{ user: UserDto }>('/api/me')).body.user;
}

/** Red (host) and black (joiner) in an active online chess game. */
async function game(): Promise<{ red: Client; black: Client; roomId: string; base: string }> {
  const red = await user('red');
  const black = await user('black');
  const created = await red.post<RoomBody>('/api/rooms', { game: 'chess' });
  const roomId = created.body.room.roomId;
  const joined = await black.post<RoomBody>(`/api/rooms/${roomId}/join`);
  expect(joined.body.room.chess?.status).toBe('active');
  return { red, black, roomId, base: `/api/rooms/${roomId}/chess` };
}

async function chessResults(gameId: string): Promise<number> {
  const res = await ts.server.ctx.pool.query('SELECT 1 FROM chess_results WHERE game_id = $1', [gameId]);
  return res.rowCount ?? 0;
}

describe('online chess (AC-6, AC-7, AC-8, AC-9, AC-10)', () => {
  it('pushes a move with the revealed identity to the opponent; covered pieces stay hidden', async () => {
    const { red, black, roomId, base } = await game();
    const sock = black.socket();
    try {
      await waitForEvent(sock, 'room:state');
      const pushed = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => s.chess?.lastMove != null);
      const res = await red.post<RoomBody>(`${base}/move`, { from: 'b2', to: 'b9' });
      expect(res.status).toBe(200);
      const chess = (await pushed).chess as ChessView;
      expect(chess.turn).toBe('black');
      expect(chess.lastMove).toMatchObject({ from: 'b2', to: 'b9', side: 'red' });
      expect(chess.lastMove?.revealed).toBeTruthy();
      expect(chess.lastMove?.captured?.side).toBe('black');
      expect(chess.captured).toEqual([chess.lastMove?.captured]);
      expect(chess.board.find((s) => s.pos === 'b9')).toEqual({ pos: 'b9', side: 'red', piece: chess.lastMove?.revealed });
      const hidden = chess.board.filter((s) => s.piece === 'hidden');
      expect(hidden).toHaveLength(28);
      expect(res.body.room.chess?.board).toEqual(chess.board);
    } finally {
      sock.close();
      await red.post(`/api/rooms/${roomId}/leave`);
      await black.post(`/api/rooms/${roomId}/leave`);
    }
  });

  it('rejects illegal, out-of-turn, malformed and non-member requests without changing the board', async () => {
    const { red, black, roomId, base } = await game();
    const outsider = await user('out');
    const before = (await red.get<RoomBody>(`/api/rooms/${roomId}/state`)).body.room;
    const illegal = await red.post<ErrBody>(`${base}/move`, { from: 'a0', to: 'a4' });
    expect(illegal.status).toBe(409);
    expect(illegal.body.error).toEqual({ code: 'ILLEGAL_MOVE', message: '走法不合规' });
    expect((await black.post<ErrBody>(`${base}/move`, { from: 'a6', to: 'a5' })).body.error.code).toBe('NOT_YOUR_TURN');
    expect((await red.post<ErrBody>(`${base}/move`, { from: 'z9', to: 'a1' })).status).toBe(400);
    expect((await red.post<ErrBody>(`${base}/draw-response`, { accept: 'yes' })).status).toBe(400);
    expect((await outsider.post<ErrBody>(`${base}/move`, { from: 'a3', to: 'a4' })).status).toBe(403);
    const after = (await red.get<RoomBody>(`/api/rooms/${roomId}/state`)).body.room;
    expect(after.version).toBe(before.version);
    expect(after.chess?.board).toEqual(before.chess?.board);
    await red.post(`/api/rooms/${roomId}/leave`);
    await black.post(`/api/rooms/${roomId}/leave`);
  });

  it('resign settles +10/−10 exactly once, even when both resign at the same time', async () => {
    const { red, black, roomId, base } = await game();
    const [r1, r2] = await Promise.all([red.post<RoomBody>(`${base}/resign`), black.post<RoomBody>(`${base}/resign`)]);
    const ok = [r1, r2].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect([r1, r2].find((r) => r.status !== 200)?.status).toBe(409);
    const result = ok[0]?.body.room.chess?.result;
    expect(result?.reason).toBe('resign');
    expect(result?.settled).toBe(true);
    const winner = result?.outcome === 'red_win' ? red : black;
    const loser = winner === red ? black : red;
    expect((await me(winner)).rating).toBe(1010);
    expect((await me(loser)).rating).toBe(990);
    expect(result?.ratingChanges.map((c) => c.delta).sort()).toEqual([-10, 10]);
    expect(await chessResults(ok[0]?.body.room.chess?.gameId as string)).toBe(1);
    expect((await me(red)).currentRoomId).toBe(roomId);
    const lobby = await red.get<{ rooms: { id: string }[] }>('/api/rooms');
    expect(lobby.body.rooms.some((r) => r.id === roomId)).toBe(false);
    await red.post(`/api/rooms/${roomId}/leave`);
    await black.post(`/api/rooms/${roomId}/leave`);
    expect((await me(red)).rating).toBe(winner === red ? 1010 : 990);
  });

  it('leaving an active game counts as resigning and the opponent is told', async () => {
    const { red, black, roomId } = await game();
    const sock = red.socket();
    try {
      await waitForEvent(sock, 'room:state');
      const pushed = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => s.chess?.status === 'finished');
      expect((await black.post(`/api/rooms/${roomId}/leave`)).status).toBe(200);
      const result = (await pushed).chess?.result;
      expect(result).toMatchObject({ outcome: 'red_win', reason: 'resign', settled: true });
      expect((await me(red)).rating).toBe(1010);
      expect((await me(black)).rating).toBe(990);
    } finally {
      sock.close();
      await red.post(`/api/rooms/${roomId}/leave`);
    }
  });

  it('a move leaving only the two kings ends the game as a draw through the move API (DC-06)', async () => {
    const { red, black, roomId, base } = await game();
    const chess = ts.server.ctx.rooms.get(roomId)?.chess as ChessGameState;
    chess.board = {
      d0: { side: 'red', type: 'king', revealed: true },
      f9: { side: 'black', type: 'king', revealed: true },
      d1: { side: 'black', type: 'pawn', revealed: true },
    };
    const sock = black.socket();
    try {
      await waitForEvent(sock, 'room:state');
      const pushed = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => s.chess?.status === 'finished');
      const res = await red.post<RoomBody>(`${base}/move`, { from: 'd0', to: 'd1' });
      expect(res.status).toBe(200);
      const expected = { outcome: 'draw', reason: 'bare_kings', settled: true };
      expect(res.body.room.chess?.result).toMatchObject(expected);
      expect((await pushed).chess?.result).toMatchObject(expected);
      expect((await me(red)).rating).toBe(1000);
      expect((await me(black)).rating).toBe(1000);
      expect(await chessResults(res.body.room.chess?.gameId as string)).toBe(1);
      const lobby = await red.get<{ rooms: { id: string }[] }>('/api/rooms');
      expect(lobby.body.rooms.some((r) => r.id === roomId)).toBe(false);
    } finally {
      sock.close();
      await red.post(`/api/rooms/${roomId}/leave`);
      await black.post(`/api/rooms/${roomId}/leave`);
    }
  });

  it('a checkmating move ends the game through the move API: winner +10, loser −10 (DC-05)', async () => {
    const { red, black, roomId, base } = await game();
    const chess = ts.server.ctx.rooms.get(roomId)?.chess as ChessGameState;
    chess.board = {
      d0: { side: 'red', type: 'king', revealed: true },
      a8: { side: 'red', type: 'rook', revealed: true },
      b0: { side: 'red', type: 'rook', revealed: true },
      e9: { side: 'black', type: 'king', revealed: true },
    };
    const sock = black.socket();
    try {
      await waitForEvent(sock, 'room:state');
      const pushed = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => s.chess?.status === 'finished');
      const res = await red.post<RoomBody>(`${base}/move`, { from: 'b0', to: 'b9' });
      expect(res.status).toBe(200);
      const expected = { outcome: 'red_win', reason: 'checkmate', settled: true };
      expect(res.body.room.chess?.result).toMatchObject(expected);
      expect((await pushed).chess?.result).toMatchObject(expected);
      expect((await me(red)).rating).toBe(1010);
      expect((await me(black)).rating).toBe(990);
      expect(await chessResults(res.body.room.chess?.gameId as string)).toBe(1);
      const lobby = await red.get<{ rooms: { id: string }[] }>('/api/rooms');
      expect(lobby.body.rooms.some((r) => r.id === roomId)).toBe(false);
    } finally {
      sock.close();
      await red.post(`/api/rooms/${roomId}/leave`);
      await black.post(`/api/rooms/${roomId}/leave`);
    }
  });

  it('a declined draw offer reaches the offerer by push and after a reload (FR-036)', async () => {
    const { red, black, roomId, base } = await game();
    const sock = red.socket();
    try {
      await waitForEvent(sock, 'room:state');
      expect((await red.post(`${base}/draw-offer`)).status).toBe(200);
      const pushed = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => s.chess?.drawDeclined?.by === 'red');
      expect((await black.post(`${base}/draw-response`, { accept: false })).status).toBe(200);
      expect((await pushed).chess).toMatchObject({ status: 'active', drawOffer: null, turn: 'red' });
      // Reloading the page fetches a fresh snapshot, which still carries the declined notice.
      const reloaded = await red.get<RoomBody>(`/api/rooms/${roomId}/state`);
      expect(reloaded.body.room.chess).toMatchObject({ status: 'active', drawOffer: null, drawDeclined: { by: 'red' } });
      const moved = await red.post<RoomBody>(`${base}/move`, { from: 'a3', to: 'a4' });
      expect(moved.body.room.chess?.drawDeclined).toBeNull();
    } finally {
      sock.close();
      await red.post(`/api/rooms/${roomId}/leave`);
      await black.post(`/api/rooms/${roomId}/leave`);
    }
  });

  it('draw offer: decline and expiry keep the game going; accepting draws with ratings unchanged', async () => {
    const { red, black, roomId, base } = await game();
    const sock = black.socket();
    try {
      await waitForEvent(sock, 'room:state');
      const offered = waitForEvent<RoomSnapshot>(sock, 'room:state', (s) => s.chess?.drawOffer?.by === 'red');
      expect((await red.post(`${base}/draw-offer`)).status).toBe(200);
      await offered;
      expect((await red.post<ErrBody>(`${base}/draw-offer`)).body.error.code).toBe('DRAW_OFFER_PENDING');
      expect((await red.post<ErrBody>(`${base}/draw-response`, { accept: true })).body.error.code).toBe('NO_DRAW_OFFER');
      const declined = await black.post<RoomBody>(`${base}/draw-response`, { accept: false });
      expect(declined.body.room.chess).toMatchObject({ status: 'active', drawOffer: null });

      await red.post(`${base}/move`, { from: 'a3', to: 'a4' });
      await red.post(`${base}/draw-offer`);
      const moved = await black.post<RoomBody>(`${base}/move`, { from: 'a6', to: 'a5' });
      expect(moved.body.room.chess?.drawOffer).toBeNull();

      await black.post(`${base}/draw-offer`);
      const accepted = await red.post<RoomBody>(`${base}/draw-response`, { accept: true });
      expect(accepted.body.room.chess?.result).toMatchObject({ outcome: 'draw', reason: 'draw_agreed', settled: true });
      expect((await me(red)).rating).toBe(1000);
      expect((await me(black)).rating).toBe(1000);
      expect(await chessResults(accepted.body.room.chess?.gameId as string)).toBe(1);
    } finally {
      sock.close();
      await red.post(`/api/rooms/${roomId}/leave`);
      await black.post(`/api/rooms/${roomId}/leave`);
    }
  });
});
