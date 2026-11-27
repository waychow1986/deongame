import type { ChessColor, ChessPieceType } from '../../shared/protocol.js';

export const PIECE_NAMES: Record<ChessColor, Record<ChessPieceType, string>> = {
  red: { king: '帅', advisor: '仕', elephant: '相', horse: '马', rook: '车', cannon: '炮', pawn: '兵' },
  black: { king: '将', advisor: '士', elephant: '象', horse: '马', rook: '车', cannon: '炮', pawn: '卒' },
};

interface Props {
  side: ChessColor;
  /** `hidden` draws the back: no character, only the side's colour and ring (FR-034). */
  piece: ChessPieceType | 'hidden';
  className?: string;
}

/** Round wooden piece (TD-012); purely visual, the cell button carries the accessible name. */
export function ChessPiece({ side, piece, className }: Props) {
  const covered = piece === 'hidden';
  return (
    <span aria-hidden="true" className={`xq-piece ${side} ${covered ? 'back' : 'face'}${className ? ` ${className}` : ''}`}>
      {!covered && <span className="xq-char">{PIECE_NAMES[side][piece]}</span>}
    </span>
  );
}
