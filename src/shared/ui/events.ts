import type { ChessView, PokerView } from '../protocol.js';

/** UI events derived from two consecutive snapshots (TD-015). */
export type ChessEvent = 'move' | 'flip' | 'capture' | 'check' | 'end';
export type PokerEvent = 'deal' | 'bet' | 'fold' | 'board' | 'collect' | 'win';

export type SoundName =
  | 'chess-move'
  | 'chess-flip'
  | 'chess-capture'
  | 'chess-check'
  | 'chess-end'
  | 'poker-deal'
  | 'poker-bet'
  | 'poker-fold'
  | 'poker-win';

const sameMove = (a: ChessView['lastMove'], b: ChessView['lastMove']) =>
  (a === null && b === null) || (!!a && !!b && a.from === b.from && a.to === b.to && a.side === b.side);

export function diffChess(prev: ChessView | null | undefined, next: ChessView): ChessEvent[] {
  if (!prev || prev.gameId !== next.gameId) return [];
  const out: ChessEvent[] = [];
  const moved = !!next.lastMove && !sameMove(prev.lastMove, next.lastMove);
  if (moved && next.lastMove) {
    out.push('move');
    if (next.lastMove.revealed) out.push('flip');
    if (next.lastMove.captured) out.push('capture');
  }
  if (!prev.inCheck && next.inCheck) out.push('check');
  if (!prev.result && next.result) out.push('end');
  return out;
}

const BET_TYPES = new Set(['small_blind', 'big_blind', 'call', 'bet', 'raise']);
const FOLD_TYPES = new Set(['fold', 'leave_fold']);

const roundSum = (v: PokerView) => v.seats.reduce((s, x) => s + x.committedThisRound, 0);

export function diffPoker(prev: PokerView | null | undefined, next: PokerView): PokerEvent[] {
  if (!prev) return [];
  const out: PokerEvent[] = [];
  const newHand = !!next.handId && next.handId !== prev.handId;
  if (newHand) out.push('deal');
  const fresh = newHand ? next.actions : next.actions.slice(prev.actions.length);
  if (fresh.some((a) => BET_TYPES.has(a.type))) out.push('bet');
  if (fresh.some((a) => FOLD_TYPES.has(a.type))) out.push('fold');
  if (!newHand && next.board.length > prev.board.length) out.push('board');
  if (!newHand && roundSum(prev) > 0 && roundSum(next) === 0 && next.pot >= prev.pot) out.push('collect');
  if (prev.winners.length === 0 && next.winners.length > 0) out.push('win');
  return out;
}

const SOUND: Partial<Record<ChessEvent | PokerEvent, SoundName>> = {
  move: 'chess-move',
  flip: 'chess-flip',
  capture: 'chess-capture',
  check: 'chess-check',
  end: 'chess-end',
  deal: 'poker-deal',
  bet: 'poker-bet',
  fold: 'poker-fold',
  win: 'poker-win',
};

/** Sound names for a set of events; board and collect are animated but silent. */
export function soundsFor(events: (ChessEvent | PokerEvent)[]): SoundName[] {
  return events.flatMap((e) => (SOUND[e] ? [SOUND[e] as SoundName] : []));
}
