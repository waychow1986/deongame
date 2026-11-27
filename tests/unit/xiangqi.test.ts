import { describe, expect, it } from 'vitest';
import type { ChessPieceType } from '../../src/shared/protocol.js';
import { seededRng } from '../../src/shared/rng.js';
import {
  applyMove,
  createBoard,
  detectEnd,
  isInCheck,
  legalMoves,
  openingPositions,
  type Board,
  type Piece,
} from '../../src/shared/xiangqi/index.js';

const r = (type: ChessPieceType, revealed = true): Piece => ({ side: 'red', type, revealed });
const k = (type: ChessPieceType, revealed = true): Piece => ({ side: 'black', type, revealed });

function sorted(xs: string[]): string[] {
  return [...xs].sort();
}

describe('createBoard (DC-01)', () => {
  it('shuffles each side only among its own squares with the standard identity set', () => {
    const board = createBoard(seededRng(7));
    for (const side of ['red', 'black'] as const) {
      const squares = Object.entries(board).filter(([, p]) => p.side === side);
      expect(squares).toHaveLength(16);
      expect(sorted(squares.map(([pos]) => pos))).toEqual(sorted(openingPositions(side)));
      const kingSquare = side === 'red' ? 'e0' : 'e9';
      expect(board[kingSquare]).toEqual({ side, type: 'king', revealed: true });
      const covered = squares.filter(([pos]) => pos !== kingSquare).map(([, p]) => p);
      expect(covered.every((p) => !p.revealed)).toBe(true);
      const counts: Record<string, number> = {};
      for (const p of covered) counts[p.type] = (counts[p.type] ?? 0) + 1;
      expect(counts).toEqual({ rook: 2, horse: 2, elephant: 2, advisor: 2, cannon: 2, pawn: 5 });
    }
  });

  it('different seeds give different layouts', () => {
    const layout = (seed: number) =>
      JSON.stringify(Object.entries(createBoard(seededRng(seed))).sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(layout(1)).not.toEqual(layout(2));
    expect(layout(3)).toEqual(layout(3));
  });
});

describe('covered pieces move by their opening square type (DC-03, TS-14)', () => {
  const board = createBoard(seededRng(11));
  const ok = (side: 'red' | 'black', from: string, to: string) => applyMove(board, side, from, to).ok;

  it.each([
    ['red', 'a0', 'a4', false],
    ['red', 'a0', 'a2', true],
    ['red', 'b0', 'd1', false],
    ['red', 'b0', 'c2', true],
    ['red', 'c0', 'e2', true],
    ['red', 'd0', 'c1', false],
    ['red', 'd0', 'e1', true],
    ['red', 'b2', 'b8', false],
    ['red', 'b2', 'b7', false],
    ['red', 'b2', 'b9', true],
    ['red', 'a3', 'b3', false],
    ['red', 'a3', 'a5', false],
    ['red', 'a3', 'a2', false],
    ['red', 'a3', 'a4', true],
    ['black', 'a6', 'a4', false],
    ['black', 'a6', 'a7', false],
    ['black', 'a6', 'a5', true],
  ] as const)('%s %s→%s legal=%s', (side, from, to, expected) => {
    expect(ok(side, from, to)).toBe(expected);
  });

  it("rejects moving the opponent's piece or an empty square", () => {
    expect(applyMove(board, 'red', 'a6', 'a5')).toEqual({ ok: false, code: 'ILLEGAL_MOVE' });
    expect(applyMove(board, 'red', 'a1', 'a2')).toEqual({ ok: false, code: 'ILLEGAL_MOVE' });
  });

  it('reveals the moved piece and exposes the identity of a captured covered piece', () => {
    const res = applyMove(board, 'red', 'b2', 'b9');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.board.b9).toEqual({ ...(board.b2 as Piece), revealed: true });
    expect(res.move.revealed).toBe(board.b2?.type);
    expect(res.move.captured).toEqual({ side: 'black', piece: board.b9?.type });
    expect(res.board.b2).toBeUndefined();
  });
});

describe('king and revealed pieces (DC-03, TS-21)', () => {
  it('king walks inside the palace only', () => {
    let board = createBoard(seededRng(3));
    let res = applyMove(board, 'red', 'e0', 'e1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    board = res.board;
    res = applyMove(board, 'red', 'e1', 'e2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(applyMove(res.board, 'red', 'e2', 'e3').ok).toBe(false);
  });

  it('revealed elephant may cross the river but respects the eye', () => {
    const board: Board = { d0: r('king'), f9: k('king'), c4: r('elephant'), a4: r('pawn') };
    expect(legalMoves(board, 'c4')).toContain('e6');
    expect(legalMoves(board, 'c4')).toContain('a6');
    expect(legalMoves({ ...board, d5: k('pawn') }, 'c4')).not.toContain('e6');
  });

  it('revealed advisor may leave the palace', () => {
    const board: Board = { d0: r('king'), f9: k('king'), e4: r('advisor') };
    expect(sorted(legalMoves(board, 'e4'))).toEqual(['d3', 'd5', 'f3', 'f5']);
  });

  it('revealed pawn moves sideways only after crossing the river and never backwards', () => {
    const board: Board = { d0: r('king'), f9: k('king'), a1: r('pawn'), c5: r('pawn') };
    expect(legalMoves(board, 'a1')).toEqual(['a2']);
    expect(sorted(legalMoves(board, 'c5'))).toEqual(['b5', 'c6', 'd5']);
  });

  it('rejects moves that let the kings face each other or leave the own king in check', () => {
    const facing: Board = { e0: r('king'), e9: k('king'), e5: r('rook') };
    expect(legalMoves(facing, 'e5').every((to) => to.startsWith('e'))).toBe(true);
    const pinned: Board = { e0: r('king'), d9: k('king'), e3: r('horse'), e8: k('rook') };
    expect(legalMoves(pinned, 'e3')).toEqual([]);
    expect(applyMove(pinned, 'red', 'e3', 'd5').ok).toBe(false);
  });

  it('treats covered pieces by their square type when looking for check', () => {
    // A covered black rook on e6 (a pawn square) only moves like a pawn, so it does not check e0.
    const board: Board = { e0: r('king'), d9: k('king'), e6: k('rook', false) };
    expect(isInCheck(board, 'red')).toBe(false);
    expect(isInCheck({ ...board, e6: k('rook') }, 'red')).toBe(true);
  });
});

describe('game end detection (DC-05, DC-06)', () => {
  it('checkmate: side to move in check with no legal moves loses', () => {
    const board: Board = { e0: r('king'), e9: k('king'), a1: k('rook'), b0: k('rook') };
    expect(detectEnd(board, 'red')).toEqual({ outcome: 'black_win', reason: 'checkmate' });
  });

  it('stalemate: no legal moves while not in check also loses', () => {
    const board: Board = { d0: r('king'), f9: k('king'), a1: k('rook'), e5: k('rook') };
    expect(detectEnd(board, 'red')).toEqual({ outcome: 'black_win', reason: 'stalemate' });
  });

  it('draws only when both sides have only the king left', () => {
    const bare: Board = { d0: r('king'), f9: k('king') };
    expect(detectEnd(bare, 'red')).toEqual({ outcome: 'draw', reason: 'bare_kings' });
    const oneSide: Board = { d0: r('king'), f9: k('king'), a3: k('pawn') };
    expect(detectEnd(oneSide, 'red')).toBeNull();
  });

  it('applyMove reports the end when capturing the last piece leaves bare kings', () => {
    const board: Board = { d0: r('king'), f9: k('king'), d1: k('pawn') };
    const res = applyMove(board, 'red', 'd0', 'd1');
    expect(res.ok && res.end).toEqual({ outcome: 'draw', reason: 'bare_kings' });
  });
});
