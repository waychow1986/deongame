import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/shared/rng.js';
import { RoomManager, type Room } from '../../src/server/rooms/roomManager.js';
import { viewFor } from '../../src/server/rooms/view.js';

const alice = { userId: 'a', username: 'alice' };
const bob = { userId: 'b', username: 'bob' };

async function activeGame(settled: Room[] = []) {
  const rm = new RoomManager({
    rng: seededRng(5),
    onChessFinished: async (room) => {
      settled.push(room);
      if (room.chess?.result) room.chess.result.settled = true;
    },
  });
  const room = await rm.create(alice, 'chess');
  await rm.join(bob, room.id);
  return { rm, room };
}

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'none';
  } catch (err) {
    return (err as { code: string }).code;
  }
}

describe('chess view (DC-02)', () => {
  it('never exposes the identity of a covered piece, not even to its owner', async () => {
    const { room } = await activeGame();
    for (const viewer of ['a', 'b', 'x']) {
      const chess = viewFor(room, viewer).chess;
      expect(chess?.board).toHaveLength(32);
      const shown = chess?.board.filter((s) => s.piece !== 'hidden') ?? [];
      expect(shown.map((s) => s.pos).sort()).toEqual(['e0', 'e9']);
      const json = JSON.stringify(viewFor(room, viewer));
      for (const t of ['advisor', 'elephant', 'horse', 'rook', 'cannon', 'pawn']) expect(json).not.toContain(t);
    }
  });

  it('shows the revealed identity after a move, the same for both players', async () => {
    const { rm, room } = await activeGame();
    const actual = room.chess?.board.a3?.type;
    await rm.chessMove('a', room.id, 'a3', 'a4');
    for (const viewer of ['a', 'b']) {
      const chess = viewFor(room, viewer).chess;
      expect(chess?.board.find((s) => s.pos === 'a4')).toEqual({ pos: 'a4', side: 'red', piece: actual });
      expect(chess?.lastMove).toEqual({ from: 'a3', to: 'a4', side: 'red', revealed: actual });
      expect(chess?.turn).toBe('black');
    }
  });
});

describe('chess room actions', () => {
  it('rejects out-of-turn and illegal moves without changing state', async () => {
    const { rm, room } = await activeGame();
    const before = JSON.stringify(viewFor(room, 'a'));
    expect(await rejection(rm.chessMove('b', room.id, 'a6', 'a5'))).toBe('NOT_YOUR_TURN');
    expect(await rejection(rm.chessMove('a', room.id, 'a0', 'a4'))).toBe('ILLEGAL_MOVE');
    expect(await rejection(rm.chessMove('a', room.id, 'a6', 'a5'))).toBe('ILLEGAL_MOVE');
    expect(await rejection(rm.chessMove('x', room.id, 'a3', 'a4'))).toBe('NOT_IN_ROOM');
    expect(JSON.stringify(viewFor(room, 'a'))).toBe(before);
  });

  it('resign finishes the game, closes the room and settles once even when both resign concurrently', async () => {
    const settled: Room[] = [];
    const { rm, room } = await activeGame(settled);
    const results = await Promise.allSettled([rm.chessResign('a', room.id), rm.chessResign('b', room.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(room.chess?.status).toBe('finished');
    expect(room.chess?.result?.reason).toBe('resign');
    expect(rm.list()).toEqual([]);
    expect(rm.currentRoomId('a')).toBe(room.id);
    expect(await rejection(rm.chessMove('a', room.id, 'a3', 'a4'))).toBe('GAME_NOT_ACTIVE');
  });

  it('draw offers: single pending offer, only the opponent responds, decline clears it', async () => {
    const { rm, room } = await activeGame();
    await rm.chessDrawOffer('a', room.id);
    expect(await rejection(rm.chessDrawOffer('b', room.id))).toBe('DRAW_OFFER_PENDING');
    expect(await rejection(rm.chessDrawResponse('a', room.id, true))).toBe('NO_DRAW_OFFER');
    await rm.chessDrawResponse('b', room.id, false);
    expect(viewFor(room, 'a').chess?.drawOffer).toBeNull();
    expect(await rejection(rm.chessDrawResponse('b', room.id, true))).toBe('NO_DRAW_OFFER');
  });

  it('a declined offer is kept in the room state so the offerer sees it after a reload (FR-036)', async () => {
    const { rm, room } = await activeGame();
    await rm.chessDrawOffer('a', room.id);
    await rm.chessDrawResponse('b', room.id, false);
    // A fresh snapshot (page reload) still tells the offerer that red's offer was declined.
    expect(viewFor(room, 'a').chess?.drawDeclined).toEqual({ by: 'red' });
    expect(viewFor(room, 'b').chess?.drawDeclined).toEqual({ by: 'red' });
    expect(viewFor(room, 'a').chess).toMatchObject({ status: 'active', drawOffer: null, turn: 'red' });
    // The notice ends with the next move or a new offer.
    await rm.chessMove('a', room.id, 'a3', 'a4');
    expect(viewFor(room, 'a').chess?.drawDeclined).toBeNull();
    await rm.chessDrawOffer('b', room.id);
    await rm.chessDrawResponse('a', room.id, false);
    expect(viewFor(room, 'b').chess?.drawDeclined).toEqual({ by: 'black' });
    await rm.chessDrawOffer('b', room.id);
    expect(viewFor(room, 'b').chess?.drawDeclined).toBeNull();
  });

  it('a pending offer expires when the opponent moves; accepting ends in a draw', async () => {
    const { rm, room } = await activeGame();
    await rm.chessMove('a', room.id, 'a3', 'a4');
    await rm.chessDrawOffer('a', room.id);
    await rm.chessMove('b', room.id, 'a6', 'a5');
    expect(viewFor(room, 'a').chess?.drawOffer).toBeNull();
    await rm.chessDrawOffer('b', room.id);
    await rm.chessDrawResponse('a', room.id, true);
    expect(viewFor(room, 'a').chess?.result).toMatchObject({ outcome: 'draw', reason: 'draw_agreed' });
  });

  it('leaving an active game counts as resigning; leaving a finished game does not change the result', async () => {
    const settled: Room[] = [];
    const { rm, room } = await activeGame(settled);
    await rm.leave('b', room.id);
    expect(room.chess?.result).toMatchObject({ outcome: 'red_win', reason: 'resign' });
    await rm.leave('a', room.id);
    expect(room.chess?.result).toMatchObject({ outcome: 'red_win', reason: 'resign' });
    expect(settled).toHaveLength(1);
  });
});
