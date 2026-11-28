import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/shared/rng.js';
import { RoomManager, type Room } from '../../src/server/rooms/roomManager.js';
import { viewFor } from '../../src/server/rooms/view.js';
import { legalMoves, type Board } from '../../src/shared/xiangqi/index.js';

const alice = { userId: 'a', username: 'alice' };
const bob = { userId: 'b', username: 'bob' };

async function activeGame(seed = 5): Promise<{ rm: RoomManager; room: Room }> {
  const rm = new RoomManager({
    rng: seededRng(seed),
    onChessFinished: async (room) => {
      if (room.chess?.result) room.chess.result.settled = true;
    },
  });
  const room = await rm.create(alice, 'chess');
  await rm.join(bob, room.id);
  return { rm, room };
}

const sorted = (m: Record<string, string[]> | null | undefined) =>
  m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]).sort()) : m;

/** Reassigns the identities of the covered pieces of one side (a different hidden deal). */
function shuffleHidden(board: Board, side: 'red' | 'black'): Board {
  const next: Board = {};
  for (const [p, piece] of Object.entries(board)) next[p] = { ...piece };
  const hidden = Object.keys(next).filter((p) => next[p]?.side === side && !next[p]?.revealed);
  const types = hidden.map((p) => next[p]?.type);
  types.reverse();
  hidden.forEach((p, i) => {
    (next[p] as { type: string }).type = types[i] as string;
  });
  return next;
}

describe('ChessView.legalMoves (DC-01, AC-16)', () => {
  it('is given only to the side to move, never to the waiting side or spectators', async () => {
    const { rm, room } = await activeGame();
    expect(viewFor(room, 'a').chess?.legalMoves).not.toBeNull();
    expect(viewFor(room, 'b').chess?.legalMoves).toBeNull();
    expect(viewFor(room, 'x').chess?.legalMoves).toBeNull();
    await rm.chessMove('a', room.id, 'a3', 'a4');
    expect(viewFor(room, 'a').chess?.legalMoves).toBeNull();
    expect(viewFor(room, 'b').chess?.legalMoves).not.toBeNull();
  });

  it('is null before the game starts and after it ends', async () => {
    const rm = new RoomManager({ rng: seededRng(1) });
    const room = await rm.create(alice, 'chess');
    expect(viewFor(room, 'a').chess?.legalMoves).toBeNull();
    const g = await activeGame();
    await g.rm.chessResign('a', g.room.id);
    expect(viewFor(g.room, 'a').chess?.legalMoves).toBeNull();
    expect(viewFor(g.room, 'b').chess?.legalMoves).toBeNull();
  });

  it('covered pieces move as the opening piece of their square (rook, horse, elephant, advisor, cannon, pawn)', async () => {
    const { room } = await activeGame();
    const lm = sorted(viewFor(room, 'a').chess?.legalMoves) as Record<string, string[]>;
    expect(lm.a0).toEqual(['a1', 'a2']);
    expect(lm.b0).toEqual(['a2', 'c2']);
    expect(lm.c0).toEqual(['a2', 'e2']);
    expect(lm.d0).toEqual(['e1']);
    expect(lm.e0).toEqual(['e1']);
    expect(lm.b2).toEqual(['a2', 'b1', 'b3', 'b4', 'b5', 'b6', 'b9', 'c2', 'd2', 'e2', 'f2', 'g2']);
    expect(lm.a3).toEqual(['a4']);
    expect(lm.e3).toEqual(['e4']);
  });

  it('lists every piece with moves exactly as the rules allow, for revealed and covered pieces', async () => {
    const { rm, room } = await activeGame(11);
    const moves: [string, string, string][] = [
      ['a', 'b2', 'b9'],
      ['b', 'a9', 'b9'],
      ['a', 'h2', 'h9'],
      ['b', 'i9', 'h9'],
      ['a', 'e3', 'e4'],
      ['b', 'e6', 'e5'],
    ];
    for (const [who, from, to] of moves) {
      const viewer = room.chess?.turn === 'red' ? 'a' : 'b';
      const view = viewFor(room, viewer).chess;
      const board = room.chess?.board as Board;
      const side = room.chess?.turn;
      const expected: Record<string, string[]> = {};
      for (const [p, piece] of Object.entries(board)) {
        if (piece.side !== side) continue;
        const l = legalMoves(board, p);
        if (l.length) expected[p] = l;
      }
      expect(sorted(view?.legalMoves)).toEqual(sorted(expected));
      try {
        await rm.chessMove(who, room.id, from, to);
      } catch {
        break;
      }
    }
  });

  it('does not depend on the identities of covered pieces', async () => {
    for (const seed of [2, 3, 4]) {
      const { room } = await activeGame(seed);
      const chess = room.chess as NonNullable<Room['chess']>;
      const before = sorted(viewFor(room, 'a').chess?.legalMoves);
      chess.board = shuffleHidden(chess.board, 'red');
      chess.board = shuffleHidden(chess.board, 'black');
      expect(sorted(viewFor(room, 'a').chess?.legalMoves)).toEqual(before);
    }
  });

  it('omits moves that would leave the own king in check or kings facing', async () => {
    const { room } = await activeGame();
    const chess = room.chess as NonNullable<Room['chess']>;
    chess.board = {
      e0: { side: 'red', type: 'king', revealed: true },
      e1: { side: 'red', type: 'rook', revealed: true },
      e9: { side: 'black', type: 'king', revealed: true },
      e8: { side: 'black', type: 'rook', revealed: true },
      a3: { side: 'red', type: 'pawn', revealed: false },
    };
    const lm = sorted(viewFor(room, 'a').chess?.legalMoves) as Record<string, string[]>;
    // The pinned rook may only stay on the e-file.
    expect(lm.e1).toEqual(['e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
    expect(lm.e0).toEqual(['d0', 'f0']);
    expect(lm.a3).toEqual(['a4']);
  });
});
