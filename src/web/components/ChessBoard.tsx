import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChessColor, ChessPieceType, ChessView } from '../../shared/protocol.js';
import { displayOrder, MARK_POSITIONS, markerPath, orientationFor, toDisplay } from '../../shared/ui/board.js';
import { CAPTURE_MS, FLIP_MS, MOVE_MS } from '../anim/durations.js';
import { ChessPiece, PIECE_NAMES } from './ChessPiece.js';

export function pieceLabel(side: ChessColor, piece: ChessPieceType | 'hidden'): string {
  const color = side === 'red' ? '红' : '黑';
  return piece === 'hidden' ? `${color}暗子` : `${color}${PIECE_NAMES[side][piece]}`;
}

export type BoardAnim = 'idle' | 'moving' | 'flipping' | 'capturing';

interface Props {
  chess: ChessView;
  /** Whether the latest change may be animated (consecutive snapshot, TD-014). */
  animate: boolean;
  onMove: (from: string, to: string) => void;
  onAnimDone: () => void;
  onHint: (message: string) => void;
}

type Move = NonNullable<ChessView['lastMove']>;
const moveKey = (m: ChessView['lastMove']) => (m ? `${m.side}:${m.from}-${m.to}` : '');

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function play(el: Element | null | undefined, keyframes: Keyframe[], duration: number): Promise<void> {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return;
  await (el as HTMLElement)
    .animate(keyframes, { duration, easing: 'ease-in-out', fill: 'none' })
    .finished.catch(() => undefined);
}

/** SVG board lines in a 90×100 viewBox: intersections at cell centres (A-17). */
function BoardLines() {
  const h = Array.from({ length: 10 }, (_, r) => <line key={`h${r}`} x1={5} y1={5 + r * 10} x2={85} y2={5 + r * 10} />);
  const v = Array.from({ length: 9 }, (_, c) => {
    const x = 5 + c * 10;
    return c === 0 || c === 8 ? (
      <line key={`v${c}`} x1={x} y1={5} x2={x} y2={95} />
    ) : (
      <g key={`v${c}`}>
        <line x1={x} y1={5} x2={x} y2={45} />
        <line x1={x} y1={55} x2={x} y2={95} />
      </g>
    );
  });
  // Marker positions are symmetric, so the red-bottom layout serves both orientations.
  const marks = MARK_POSITIONS.map((p) => {
    const { c, r } = toDisplay(p, 'red-bottom');
    return <path key={p} d={markerPath(c, r)} />;
  });
  return (
    <svg className="xq-lines" viewBox="0 0 90 100" preserveAspectRatio="none" aria-hidden="true">
      {h}
      {v}
      <line x1={35} y1={5} x2={55} y2={25} />
      <line x1={55} y1={5} x2={35} y2={25} />
      <line x1={35} y1={75} x2={55} y2={95} />
      <line x1={55} y1={75} x2={35} y2={95} />
      {marks}
    </svg>
  );
}

/** 9×10 board; the black player's view is rotated 180° while position names stay the same. */
export function ChessBoard({ chess, animate, onMove, onAnimDone, onHint }: Props) {
  const orientation = orientationFor(chess.yourColor);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<BoardAnim>('idle');
  const [run, setRun] = useState<{ move: Move; id: number } | null>(null);
  /** Position still drawn as covered while its reveal has not been animated yet. */
  const [coverAt, setCoverAt] = useState<string | null>(null);
  const [flipShown, setFlipShown] = useState(false);
  const [ghost, setGhost] = useState<{ pos: string; side: ChessColor; piece: ChessPieceType } | null>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const lastKey = useRef(moveKey(chess.lastMove));
  const runCounter = useRef(0);
  const doneRef = useRef(onAnimDone);
  doneRef.current = onAnimDone;

  const byPos = new Map(chess.board.map((s) => [s.pos, s]));
  const mine = (pos: string) => chess.yourColor !== null && byPos.get(pos)?.side === chess.yourColor;
  const canAct = chess.status === 'active' && chess.yourColor !== null && chess.turn === chess.yourColor;
  const targets = new Set(selected ? (chess.legalMoves?.[selected] ?? []) : []);
  // Taps stay live during an animation (the snapshot is already current); dots appear once it ends.
  const showTargets = phase === 'idle';

  // Drop a selection that is no longer one of my pieces on my turn.
  const stale = selected !== null && (!canAct || !mine(selected));
  useEffect(() => {
    if (stale) setSelected(null);
  }, [stale]);

  useLayoutEffect(() => {
    const key = moveKey(chess.lastMove);
    if (key === lastKey.current) return;
    lastKey.current = key;
    setSelected(null);
    const m = chess.lastMove;
    if (!animate || !m) {
      setRun(null);
      setCoverAt(null);
      setGhost(null);
      setPhase('idle');
      doneRef.current();
      return;
    }
    runCounter.current += 1;
    setCoverAt(m.revealed ? m.to : null);
    setFlipShown(false);
    setGhost(m.captured ? { pos: m.to, ...m.captured } : null);
    setPhase('moving');
    setRun({ move: m, id: runCounter.current });
  }, [chess, animate]);

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const { move } = run;
    const pieceAt = (pos: string) => cells.current.get(pos)?.querySelector('.xq-piece.main');
    void (async () => {
      const fromCell = cells.current.get(move.from);
      const toCell = cells.current.get(move.to);
      if (fromCell && toCell) {
        const a = fromCell.getBoundingClientRect();
        const b = toCell.getBoundingClientRect();
        // FLIP: the piece is already at its destination and slides in from the origin.
        await play(
          pieceAt(move.to),
          [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'translate(0, 0)' }],
          MOVE_MS,
        );
      }
      if (cancelled) return;
      if (move.captured) {
        setPhase('capturing');
        await frame();
        await play(
          cells.current.get(move.to)?.querySelector('.xq-piece.ghost'),
          [
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(0.3)', opacity: 0 },
          ],
          CAPTURE_MS,
        );
        if (cancelled) return;
        setGhost(null);
      }
      if (move.revealed) {
        setPhase('flipping');
        await frame();
        await play(pieceAt(move.to), [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], FLIP_MS / 2);
        if (cancelled) return;
        setFlipShown(true);
        await frame();
        await play(pieceAt(move.to), [{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0deg)' }], FLIP_MS / 2);
        if (cancelled) return;
        setCoverAt(null);
      }
      setPhase('idle');
      setRun(null);
      doneRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  function click(pos: string) {
    if (chess.status !== 'active' || chess.yourColor === null) return;
    if (!canAct) {
      onHint('还没轮到你');
      return;
    }
    const sq = byPos.get(pos);
    if (sq && sq.side === chess.yourColor) {
      setSelected(selected === pos ? null : pos);
      return;
    }
    if (!selected) {
      if (sq) onHint('这是对方的棋子');
      return;
    }
    if (!targets.has(pos)) {
      onHint('这里不能走');
      return;
    }
    setSelected(null);
    onMove(selected, pos);
  }

  const busy = phase !== 'idle';
  return (
    <div
      role="group"
      aria-label="棋盘"
      className="xq-board"
      data-orientation={orientation}
      data-anim={phase}
      aria-busy={busy ? 'true' : 'false'}
    >
      <BoardLines />
      <div className="xq-river">
        <span>楚河</span>
        <span>汉界</span>
      </div>
      <div className="xq-grid">
        {displayOrder(orientation).map((pos) => {
          const sq = byPos.get(pos);
          const covered = !!sq && (sq.piece === 'hidden' || coverAt === pos);
          const content = sq ? pieceLabel(sq.side, covered ? 'hidden' : sq.piece) : '空';
          const marks: string[] = [];
          if (showTargets && targets.has(pos)) marks.push('target');
          if (chess.lastMove?.from === pos) marks.push('last-from');
          if (chess.lastMove?.to === pos) marks.push('last-to');
          // During the second half of the flip the face is drawn; the name changes once the flip is over.
          const drawPiece = sq ? (covered && !(coverAt === pos && flipShown) ? 'hidden' : sq.piece) : null;
          return (
            <button
              key={pos}
              ref={(el) => {
                if (el) cells.current.set(pos, el);
                else cells.current.delete(pos);
              }}
              type="button"
              className={`xq-cell${mine(pos) ? ' own' : ''}`}
              aria-label={`${pos} ${content}`}
              aria-pressed={selected === pos}
              data-pos={pos}
              data-marks={marks.length ? marks.join(' ') : undefined}
              data-face={sq ? (covered ? 'down' : 'up') : undefined}
              onClick={() => click(pos)}
            >
              {ghost?.pos === pos && <ChessPiece side={ghost.side} piece={ghost.piece} className="ghost" />}
              {sq && drawPiece && <ChessPiece side={sq.side} piece={drawPiece} className="main" />}
              {showTargets && targets.has(pos) && <span className="xq-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
