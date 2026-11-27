import type { ChessColor, ChessOutcome, ChessPieceType, ChessReason } from '../protocol.js';
import { shuffle, type Rng } from '../rng.js';

/** Blind-chess (揭棋) rules engine: pure functions, randomness injected (TD-005). */

export interface Piece {
  side: ChessColor;
  type: ChessPieceType;
  revealed: boolean;
}

export type Board = Record<string, Piece>;

export interface MoveRecord {
  from: string;
  to: string;
  side: ChessColor;
  revealed?: ChessPieceType;
  captured?: { side: ChessColor; piece: ChessPieceType };
}

export interface GameEnd {
  outcome: ChessOutcome;
  reason: ChessReason;
}

export const COLS = 'abcdefghi';

export function pos(col: number, row: number): string {
  return `${COLS[col]}${row}`;
}

export function parsePos(p: string): [number, number] | null {
  if (!/^[a-i][0-9]$/.test(p)) return null;
  return [COLS.indexOf(p[0] as string), Number(p[1])];
}

const BACK_ROW: ChessPieceType[] = ['rook', 'horse', 'elephant', 'advisor', 'king', 'advisor', 'elephant', 'horse', 'rook'];

/** Opening layout by position type (what a covered piece on that square moves as). */
export function openingType(p: string): { side: ChessColor; type: ChessPieceType } | null {
  const c = parsePos(p);
  if (!c) return null;
  const [col, row] = c;
  const side: ChessColor = row <= 4 ? 'red' : 'black';
  const rel = side === 'red' ? row : 9 - row;
  if (rel === 0) return { side, type: BACK_ROW[col] as ChessPieceType };
  if (rel === 2 && (col === 1 || col === 7)) return { side, type: 'cannon' };
  if (rel === 3 && col % 2 === 0) return { side, type: 'pawn' };
  return null;
}

export function openingPositions(side: ChessColor): string[] {
  const out: string[] = [];
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++) {
      const p = pos(col, row);
      if (openingType(p)?.side === side) out.push(p);
    }
  return out;
}

/** Shuffles each side's 15 non-king pieces among that side's own opening squares; kings stay revealed. */
export function createBoard(rng: Rng): Board {
  const board: Board = {};
  for (const side of ['red', 'black'] as const) {
    const squares = openingPositions(side).filter((p) => openingType(p)?.type !== 'king');
    const identities = shuffle(
      squares.map((p) => openingType(p)?.type as ChessPieceType),
      rng,
    );
    squares.forEach((p, i) => {
      board[p] = { side, type: identities[i] as ChessPieceType, revealed: false };
    });
    board[side === 'red' ? 'e0' : 'e9'] = { side, type: 'king', revealed: true };
  }
  return board;
}

function effectiveType(board: Board, p: string): ChessPieceType {
  const piece = board[p] as Piece;
  if (piece.revealed) return piece.type;
  return openingType(p)?.type ?? piece.type;
}

function inPalace(side: ChessColor, col: number, row: number): boolean {
  if (col < 3 || col > 5) return false;
  return side === 'red' ? row >= 0 && row <= 2 : row >= 7 && row <= 9;
}

function onOwnHalf(side: ChessColor, row: number): boolean {
  return side === 'red' ? row <= 4 : row >= 5;
}

function onBoard(col: number, row: number): boolean {
  return col >= 0 && col < 9 && row >= 0 && row < 10;
}

const ORTHO: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG: [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Target squares reachable by movement rules only (ignores self-check and flying kings). */
export function pseudoMoves(board: Board, from: string): string[] {
  const piece = board[from];
  const c = parsePos(from);
  if (!piece || !c) return [];
  const [col, row] = c;
  const side = piece.side;
  const type = effectiveType(board, from);
  const covered = !piece.revealed;
  const out: string[] = [];
  const occ = (cc: number, rr: number) => board[pos(cc, rr)];
  const add = (cc: number, rr: number) => {
    if (!onBoard(cc, rr)) return;
    const t = occ(cc, rr);
    if (!t || t.side !== side) out.push(pos(cc, rr));
  };
  switch (type) {
    case 'king':
      for (const [dc, dr] of ORTHO) if (inPalace(side, col + dc, row + dr)) add(col + dc, row + dr);
      break;
    case 'advisor':
      for (const [dc, dr] of DIAG) {
        if (covered && !inPalace(side, col + dc, row + dr)) continue;
        add(col + dc, row + dr);
      }
      break;
    case 'elephant':
      for (const [dc, dr] of DIAG) {
        const tc = col + 2 * dc;
        const tr = row + 2 * dr;
        if (!onBoard(tc, tr) || occ(col + dc, row + dr)) continue;
        if (covered && !onOwnHalf(side, tr)) continue;
        add(tc, tr);
      }
      break;
    case 'horse':
      for (const [dc, dr] of ORTHO) {
        const lc = col + dc;
        const lr = row + dr;
        if (!onBoard(lc, lr) || occ(lc, lr)) continue;
        if (dc === 0) {
          add(col + 1, row + 2 * dr);
          add(col - 1, row + 2 * dr);
        } else {
          add(col + 2 * dc, row + 1);
          add(col + 2 * dc, row - 1);
        }
      }
      break;
    case 'rook':
      for (const [dc, dr] of ORTHO) {
        let cc = col + dc;
        let rr = row + dr;
        while (onBoard(cc, rr)) {
          add(cc, rr);
          if (occ(cc, rr)) break;
          cc += dc;
          rr += dr;
        }
      }
      break;
    case 'cannon':
      for (const [dc, dr] of ORTHO) {
        let cc = col + dc;
        let rr = row + dr;
        let screened = false;
        while (onBoard(cc, rr)) {
          const t = occ(cc, rr);
          if (!screened) {
            if (t) screened = true;
            else out.push(pos(cc, rr));
          } else if (t) {
            if (t.side !== side) out.push(pos(cc, rr));
            break;
          }
          cc += dc;
          rr += dr;
        }
      }
      break;
    case 'pawn': {
      const fwd = side === 'red' ? 1 : -1;
      add(col, row + fwd);
      if (!covered && !onOwnHalf(side, row)) {
        add(col + 1, row);
        add(col - 1, row);
      }
      break;
    }
  }
  return out;
}

function kingPos(board: Board, side: ChessColor): string | null {
  for (const [p, piece] of Object.entries(board)) if (piece.side === side && piece.type === 'king') return p;
  return null;
}

function kingsFacing(board: Board): boolean {
  const r = kingPos(board, 'red');
  const b = kingPos(board, 'black');
  if (!r || !b || r[0] !== b[0]) return false;
  const col = COLS.indexOf(r[0] as string);
  const lo = Math.min(Number(r[1]), Number(b[1]));
  const hi = Math.max(Number(r[1]), Number(b[1]));
  for (let row = lo + 1; row < hi; row++) if (board[pos(col, row)]) return false;
  return true;
}

export function isInCheck(board: Board, side: ChessColor): boolean {
  const k = kingPos(board, side);
  if (!k) return false;
  for (const [p, piece] of Object.entries(board)) {
    if (piece.side === side) continue;
    if (pseudoMoves(board, p).includes(k)) return true;
  }
  return false;
}

function simulate(board: Board, from: string, to: string): Board {
  const next = { ...board };
  next[to] = next[from] as Piece;
  delete next[from];
  return next;
}

export function legalMoves(board: Board, from: string): string[] {
  const piece = board[from];
  if (!piece) return [];
  return pseudoMoves(board, from).filter((to) => {
    const next = simulate(board, from, to);
    return !kingsFacing(next) && !isInCheck(next, piece.side);
  });
}

export function hasAnyLegalMove(board: Board, side: ChessColor): boolean {
  return Object.entries(board).some(([p, piece]) => piece.side === side && legalMoves(board, p).length > 0);
}

export type MoveResult =
  | { ok: true; board: Board; move: MoveRecord; end: GameEnd | null }
  | { ok: false; code: 'ILLEGAL_MOVE' };

/** Applies a move for `side`; turn order is checked by the caller. Returns a new board. */
export function applyMove(board: Board, side: ChessColor, from: string, to: string): MoveResult {
  const piece = board[from];
  if (!piece || piece.side !== side || !parsePos(to) || !legalMoves(board, from).includes(to)) {
    return { ok: false, code: 'ILLEGAL_MOVE' };
  }
  const target = board[to];
  const next = simulate(board, from, to);
  const move: MoveRecord = { from, to, side };
  if (!piece.revealed) {
    next[to] = { ...piece, revealed: true };
    move.revealed = piece.type;
  }
  if (target) move.captured = { side: target.side, piece: target.type };
  return { ok: true, board: next, move, end: detectEnd(next, side === 'red' ? 'black' : 'red') };
}

/** Bare kings first, then no legal move for the side to move (checkmate and stalemate both lose). */
export function detectEnd(board: Board, toMove: ChessColor): GameEnd | null {
  const pieces = Object.values(board);
  if (pieces.length === 2 && pieces.every((p) => p.type === 'king')) return { outcome: 'draw', reason: 'bare_kings' };
  if (!hasAnyLegalMove(board, toMove)) {
    return {
      outcome: toMove === 'red' ? 'black_win' : 'red_win',
      reason: isInCheck(board, toMove) ? 'checkmate' : 'stalemate',
    };
  }
  return null;
}
