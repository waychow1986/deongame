import type { ChessColor, ChessPieceType } from '../protocol.js';
import type { Rng } from '../rng.js';
import { detectEnd, isInCheck, legalMoves, openingType, parsePos, pseudoMoves, type Board, type Piece } from '../xiangqi/index.js';

/**
 * Chess computer opponent (TD-015): 2-ply minimax on the public position only. Covered pieces are
 * masked before searching, so the hidden identities are never read.
 */

export interface ChessAiInput {
  board: Board;
  side: ChessColor;
  /** Captured pieces so far (public: identities are shown when taken). */
  captured: readonly { side: ChessColor; piece: ChessPieceType }[];
  rng: Rng;
}

const VALUE: Record<ChessPieceType, number> = {
  king: 0,
  rook: 9,
  cannon: 4.5,
  horse: 4,
  elephant: 2,
  advisor: 2,
  pawn: 1,
};

const FULL_SET: ChessPieceType[] = [
  ...(['rook', 'horse', 'elephant', 'advisor', 'cannon'] as const).flatMap((t) => [t, t]),
  ...Array.from({ length: 5 }, () => 'pawn' as const),
];

const WIN = 10_000;

/** A masked piece: `unknown` marks a piece whose identity is not public (covered, or moved during the search). */
interface PublicPiece extends Piece {
  unknown?: boolean;
}
type PublicBoard = Record<string, PublicPiece>;

const other = (s: ChessColor): ChessColor => (s === 'red' ? 'black' : 'red');

function mask(board: Board): PublicBoard {
  const out: PublicBoard = {};
  for (const [p, piece] of Object.entries(board)) {
    out[p] = piece.revealed
      ? { side: piece.side, type: piece.type, revealed: true }
      : { side: piece.side, type: openingType(p)?.type ?? 'pawn', revealed: false, unknown: true };
  }
  return out;
}

/** Average value of the identities a side has not revealed yet (full set − revealed − captured). */
function hiddenAverage(board: PublicBoard, captured: ChessAiInput['captured'], side: ChessColor): number {
  const pool = [...FULL_SET];
  const drop = (t: ChessPieceType) => {
    const i = pool.indexOf(t);
    if (i >= 0) pool.splice(i, 1);
  };
  for (const piece of Object.values(board)) if (piece.side === side && !piece.unknown && piece.type !== 'king') drop(piece.type);
  for (const c of captured) if (c.side === side) drop(c.piece);
  if (pool.length === 0) return 0;
  return pool.reduce((s, t) => s + VALUE[t], 0) / pool.length;
}

function pieceValue(p: string, piece: PublicPiece, avg: Record<ChessColor, number>): number {
  if (piece.unknown) return avg[piece.side];
  if (piece.type === 'pawn') {
    const row = parsePos(p)?.[1] ?? 0;
    const crossed = piece.side === 'red' ? row >= 5 : row <= 4;
    return crossed ? 2 : 1;
  }
  return VALUE[piece.type];
}

function material(board: PublicBoard, me: ChessColor, avg: Record<ChessColor, number>): number {
  let score = 0;
  for (const [p, piece] of Object.entries(board)) {
    const v = pieceValue(p, piece, avg);
    score += piece.side === me ? v : -v;
  }
  return score;
}

function movesOf(board: PublicBoard, side: ChessColor): [string, string][] {
  const out: [string, string][] = [];
  for (const [from, piece] of Object.entries(board)) {
    if (piece.side !== side) continue;
    for (const to of legalMoves(board, from)) out.push([from, to]);
  }
  return out;
}

/**
 * Plays a move on the public board. A moved covered piece keeps an unknown identity: in the search it
 * moves as its former position type and is valued at the side's hidden average.
 */
function play(board: PublicBoard, from: string, to: string): PublicBoard {
  const next = { ...board };
  const piece = next[from] as PublicPiece;
  next[to] = piece.revealed ? piece : { ...piece, revealed: true };
  delete next[from];
  return next;
}

function kingSquare(board: PublicBoard, side: ChessColor): [number, number] | null {
  for (const [p, piece] of Object.entries(board)) if (piece.side === side && piece.type === 'king') return parsePos(p);
  return null;
}

/**
 * Whether a move from `from` to `to` can give check to a king that was not in check: a new attack needs the
 * moved piece or an opened/closed line on the king's file or rank, or a square within two steps of the king
 * (horse, elephant, advisor, pawn attacks and their blocking squares).
 */
function mayCheck([kc, kr]: [number, number], from: string, to: string): boolean {
  return [from, to].some((s) => {
    const [c, r] = parsePos(s) as [number, number];
    return c === kc || r === kr || (Math.abs(c - kc) <= 2 && Math.abs(r - kr) <= 2);
  });
}

/** Score from `me`'s point of view if the game is over with `toMove` to play, else null. */
function terminal(board: PublicBoard, toMove: ChessColor, me: ChessColor): number | null {
  const end = detectEnd(board, toMove);
  if (!end) return null;
  if (end.outcome === 'draw') return 0;
  return (end.outcome === 'red_win') === (me === 'red') ? WIN : -WIN;
}

/** Picks one of the side's legal moves (null when there is none); equal scores are broken by `rng`. */
export function chooseChessMove(input: ChessAiInput): { from: string; to: string } | null {
  const me = input.side;
  const opp = other(me);
  const board = mask(input.board);
  const avg = { red: hiddenAverage(board, input.captured, 'red'), black: hiddenAverage(board, input.captured, 'black') };
  const mine = movesOf(board, me);
  if (mine.length === 0) return null;
  let best = -Infinity;
  let bestMoves: [string, string][] = [];
  for (const [from, to] of mine) {
    const after = play(board, from, to);
    let score = terminal(after, opp, me);
    if (score === null) {
      const base = material(after, me, avg);
      const king = kingSquare(after, me);
      let worst = Infinity;
      for (const [of, piece] of Object.entries(after)) {
        if (piece.side !== opp) continue;
        let legal: string[] | null = null;
        const moved: PublicPiece = piece.revealed ? piece : { ...piece, revealed: true };
        for (const ot of pseudoMoves(after, of)) {
          const target = after[ot];
          let v = base - (pieceValue(ot, moved, avg) - pieceValue(of, piece, avg));
          if (target) v -= pieceValue(ot, target, avg);
          if (v >= worst && !(king && mayCheck(king, of, ot))) continue;
          const reply = play(after, of, ot);
          // Mate needs a check; a stalemate after the reply is not searched.
          if (king && mayCheck(king, of, ot) && isInCheck(reply, me)) v = terminal(reply, me, me) ?? v;
          // Legality is only verified for replies that would lower the score.
          if (v < worst && (legal ??= legalMoves(after, of)).includes(ot)) worst = v;
        }
      }
      score = worst;
    }
    if (score > best) {
      best = score;
      bestMoves = [[from, to]];
    } else if (score === best) bestMoves.push([from, to]);
  }
  const [from, to] = bestMoves[input.rng.int(bestMoves.length)] as [string, string];
  return { from, to };
}
