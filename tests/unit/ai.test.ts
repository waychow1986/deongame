import { describe, expect, it } from 'vitest';
import { chooseBotAction, chooseChessMove } from '../../src/shared/ai/index.js';
import type { ChessColor } from '../../src/shared/protocol.js';
import { applyAction, isHandOver, legalActions, startHand, type HandState } from '../../src/shared/poker/index.js';
import { seededRng } from '../../src/shared/rng.js';
import { applyMove, createBoard, legalMoves, type Board, type Piece } from '../../src/shared/xiangqi/index.js';

const p = (side: ChessColor, type: Piece['type'], revealed = true): Piece => ({ side, type, revealed });

function allLegal(board: Board, side: ChessColor): string[] {
  return Object.entries(board).flatMap(([from, piece]) =>
    piece.side === side ? legalMoves(board, from).map((to) => `${from}-${to}`) : [],
  );
}

describe('电脑对手只产生合规着法/行动 (DC-04)', () => {
  it('chess AI picks a legal move in many mixed covered/revealed positions and stops when none exists', () => {
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const rng = seededRng(seed);
      let board = createBoard(rng);
      let side: ChessColor = 'red';
      const captured: { side: ChessColor; piece: Piece['type'] }[] = [];
      for (let ply = 0; ply < 40; ply++) {
        const legal = allLegal(board, side);
        const choice = chooseChessMove({ board, side, captured, rng });
        if (legal.length === 0) {
          expect(choice).toBeNull();
          break;
        }
        expect(choice).not.toBeNull();
        expect(legal).toContain(`${choice!.from}-${choice!.to}`);
        checked += 1;
        // Alternate AI moves with random legal moves so positions vary.
        const [from, to] = (ply % 2 === 0 ? `${choice!.from}-${choice!.to}` : (legal[rng.int(legal.length)] as string)).split('-') as [string, string];
        const res = applyMove(board, side, from, to);
        if (!res.ok) throw new Error('engine rejected a legal move');
        board = res.board;
        if (res.move.captured) captured.push(res.move.captured);
        if (res.end) break;
        side = side === 'red' ? 'black' : 'red';
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 30_000);

  it('chess AI escapes check using only the few legal moves', () => {
    const board: Board = {
      e0: p('red', 'king'),
      e5: p('red', 'rook'),
      e9: p('black', 'king'),
      d9: p('black', 'horse', false),
      a6: p('black', 'pawn', false),
    };
    const legal = allLegal(board, 'black');
    for (let seed = 1; seed <= 20; seed++) {
      const m = chooseChessMove({ board, side: 'black', captured: [], rng: seededRng(seed) });
      expect(legal).toContain(`${m!.from}-${m!.to}`);
      expect(m!.from).not.toBe('a6');
    }
  });

  it('chess AI returns null when it has no legal move', () => {
    // Black king mated: d9/f9 covered by the rooks on d1/f1, taking e8 would face the red king.
    const board: Board = {
      e0: p('red', 'king'),
      d1: p('red', 'rook'),
      f1: p('red', 'rook'),
      e8: p('red', 'rook'),
      e9: p('black', 'king'),
    };
    expect(allLegal(board, 'black')).toEqual([]);
    expect(chooseChessMove({ board, side: 'black', captured: [], rng: seededRng(1) })).toBeNull();
  });

  it('chess AI takes a free piece (2-ply material search)', () => {
    const board: Board = {
      e0: p('red', 'king'),
      a5: p('red', 'rook'),
      d9: p('black', 'king'),
      a9: p('black', 'rook'),
      i6: p('black', 'pawn', false),
    };
    expect(chooseChessMove({ board, side: 'black', captured: [], rng: seededRng(3) })).toEqual({ from: 'a9', to: 'a5' });
  });

  it('chess AI never reads covered identities: same public position, same choice', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const a = createBoard(seededRng(seed));
      const b = createBoard(seededRng(seed + 100));
      // Same public view (all non-king pieces covered on the same squares), different hidden identities.
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      const differs = Object.keys(a).some((k) => a[k]!.type !== b[k]!.type);
      expect(differs).toBe(true);
      for (const side of ['red', 'black'] as const) {
        const ma = chooseChessMove({ board: a, side, captured: [], rng: seededRng(seed) });
        const mb = chooseChessMove({ board: b, side, captured: [], rng: seededRng(seed) });
        expect(ma).toEqual(mb);
      }
    }
  });

  it('poker bot only chooses legal actions and every hand runs to completion', () => {
    let actions = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const rng = seededRng(seed);
      const n = 2 + (seed % 8);
      const seats = Array.from({ length: n }, (_, i) => i);
      const hand: HandState = startHand({ id: `h${seed}`, seats, dealerSeat: seed % n, rng });
      for (let step = 0; step < 200 && !isHandOver(hand); step++) {
        const seat = hand.toAct as number;
        expect(legalActions(hand, seat)).not.toBeNull();
        const action = chooseBotAction(hand, seat);
        const res = applyAction(hand, seat, action);
        expect(res, JSON.stringify(action)).toEqual({ ok: true });
        actions += 1;
      }
      expect(isHandOver(hand)).toBe(true);
    }
    expect(actions).toBeGreaterThan(300);
  });

  it('poker bot follows the hand-strength strategy', () => {
    const hand = startHand({ id: 'x', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    // Seat 0 (dealer) acts first preflop with 3 players and faces the big blind.
    const seat = hand.toAct as number;
    const me = hand.players.find((x) => x.seat === seat)!;
    me.hole = ['As', 'Ad'];
    expect(chooseBotAction(hand, seat)).toEqual({ type: 'raise', amount: legalActions(hand, seat)!.minRaiseTo });
    me.hole = ['Ah', '7c'];
    expect(chooseBotAction(hand, seat)).toEqual({ type: 'call' });
    me.hole = ['2h', '7c'];
    // Calling the big blind is not more than the big blind: weak hands still call it.
    expect(chooseBotAction(hand, seat)).toEqual({ type: 'call' });
    applyAction(hand, seat, { type: 'raise', amount: 40 });
    const next = hand.toAct as number;
    hand.players.find((x) => x.seat === next)!.hole = ['2h', '7c'];
    expect(chooseBotAction(hand, next)).toEqual({ type: 'fold' });
  });
});
