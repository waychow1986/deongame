import { useState } from 'react';
import type { ChessColor, ChessPieceType, ChessView } from '../../shared/protocol.js';

const NAMES: Record<ChessColor, Record<ChessPieceType, string>> = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' },
};

const COLS = 'abcdefghi';

export function pieceLabel(side: ChessColor, piece: ChessPieceType | 'hidden'): string {
  const color = side === 'red' ? '红' : '黑';
  return piece === 'hidden' ? `${color}暗子` : `${color}${NAMES[side][piece]}`;
}

interface Props {
  chess: ChessView;
  onMove: (from: string, to: string) => void;
}

/** 9×10 board; the black player's view is rotated 180° while square names stay the same. */
export function ChessBoard({ chess, onMove }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const byPos = new Map(chess.board.map((s) => [s.pos, s]));
  const flipped = chess.yourColor === 'black';
  const canAct = chess.status === 'active' && chess.yourColor !== null && chess.turn === chess.yourColor;

  const rows = Array.from({ length: 10 }, (_, i) => (flipped ? i : 9 - i));
  const cols = Array.from({ length: 9 }, (_, i) => (flipped ? 8 - i : i));

  function click(pos: string) {
    if (!canAct) return;
    const sq = byPos.get(pos);
    if (sq && sq.side === chess.yourColor) {
      setSelected(selected === pos ? null : pos);
      return;
    }
    if (selected) {
      onMove(selected, pos);
      setSelected(null);
    }
  }

  return (
    <div role="group" aria-label="棋盘" className="chess-board">
      {rows.map((row) =>
        cols.map((col) => {
          const pos = `${COLS[col]}${row}`;
          const sq = byPos.get(pos);
          const content = sq ? pieceLabel(sq.side, sq.piece) : '空';
          const last = chess.lastMove && (chess.lastMove.from === pos || chess.lastMove.to === pos);
          const classes = ['sq', sq ? `piece ${sq.side}` : '', sq?.piece === 'hidden' ? 'covered' : '', last ? 'last' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={pos}
              type="button"
              className={classes}
              aria-label={`${pos} ${content}`}
              aria-pressed={selected === pos}
              onClick={() => click(pos)}
            >
              {sq ? (sq.piece === 'hidden' ? '暗' : NAMES[sq.side][sq.piece]) : ''}
            </button>
          );
        }),
      )}
    </div>
  );
}
