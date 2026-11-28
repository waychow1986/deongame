import { describe, expect, it } from 'vitest';
import type { ChessView, PokerSeatView, PokerView } from '../../src/shared/protocol.js';
import { diffChess, diffPoker, soundsFor } from '../../src/shared/ui/events.js';

function chess(over: Partial<ChessView> = {}): ChessView {
  return {
    gameId: 'g1',
    status: 'active',
    players: { red: null, black: null },
    yourColor: 'red',
    turn: 'red',
    inCheck: false,
    legalMoves: null,
    board: [],
    captured: [],
    lastMove: null,
    drawOffer: null,
    drawDeclined: null,
    result: null,
    ...over,
  };
}

function seat(seatNo: number, committedThisRound = 0): PokerSeatView {
  return {
    seat: seatNo,
    kind: 'human',
    name: `p${seatNo}`,
    chips: 1000,
    committedThisHand: committedThisRound,
    committedThisRound,
    inHand: true,
    folded: false,
    atCap: false,
    waitingNextHand: false,
    isDealer: seatNo === 0,
  } as PokerSeatView;
}

function poker(over: Partial<PokerView> = {}): PokerView {
  return {
    handId: 'h1',
    handNumber: 1,
    stage: 'preflop',
    blinds: { small: 5, big: 10 },
    handCommitCap: 500,
    board: [],
    pot: 15,
    currentBet: 10,
    toActSeat: 0,
    seats: [seat(0, 5), seat(1, 10)],
    actions: [
      { seat: 0, name: 'p0', type: 'small_blind', amount: 5 },
      { seat: 1, name: 'p1', type: 'big_blind', amount: 10 },
    ],
    showdown: [],
    winners: [],
    you: { seat: 0, legal: null },
    ...over,
  } as PokerView;
}

const chessSounds = (a: ChessView, b: ChessView) => soundsFor(diffChess(a, b));
const pokerSounds = (a: PokerView, b: PokerView) => soundsFor(diffPoker(a, b));

describe('chess events to sounds (DC-02, AC-31)', () => {
  const base = chess();
  it('a plain move of a revealed piece plays chess-move only', () => {
    expect(chessSounds(base, chess({ lastMove: { from: 'e0', to: 'e1', side: 'red' } }))).toEqual(['chess-move']);
  });
  it('moving a covered piece reveals it: chess-move and chess-flip', () => {
    const next = chess({ lastMove: { from: 'a3', to: 'a4', side: 'red', revealed: 'rook' } });
    expect(chessSounds(base, next)).toEqual(['chess-move', 'chess-flip']);
  });
  it('a capture plays chess-capture', () => {
    const next = chess({ lastMove: { from: 'b2', to: 'b9', side: 'red', captured: { side: 'black', piece: 'horse' } } });
    expect(chessSounds(base, next)).toEqual(['chess-move', 'chess-capture']);
  });
  it('a move by the opponent (or the computer) is detected the same way', () => {
    const prev = chess({ lastMove: { from: 'a3', to: 'a4', side: 'red', revealed: 'rook' } });
    const next = chess({ lastMove: { from: 'a6', to: 'a5', side: 'black', revealed: 'pawn' }, turn: 'red' });
    expect(chessSounds(prev, next)).toEqual(['chess-move', 'chess-flip']);
  });
  it('giving check plays chess-check once, not again while the check lasts', () => {
    const checked = chess({ inCheck: true, lastMove: { from: 'h2', to: 'h9', side: 'red' } });
    expect(chessSounds(base, checked)).toContain('chess-check');
    expect(chessSounds(checked, checked)).toEqual([]);
  });
  it.each(['red_win', 'black_win', 'draw'] as const)('the end of the game (%s) plays chess-end', (outcome) => {
    const next = chess({
      status: 'finished',
      result: { outcome, reason: 'resign', settled: false, ratingChanges: [] },
    });
    expect(chessSounds(base, next)).toEqual(['chess-end']);
  });
  it('produces nothing when nothing changed, for the first snapshot, or for a new game', () => {
    const moved = chess({ lastMove: { from: 'e0', to: 'e1', side: 'red' } });
    expect(diffChess(moved, moved)).toEqual([]);
    expect(diffChess(null, moved)).toEqual([]);
    expect(diffChess(moved, chess({ gameId: 'g2' }))).toEqual([]);
    expect(diffChess(base, chess({ drawOffer: { by: 'black' } }))).toEqual([]);
  });
});

describe('poker events to sounds (DC-02, AC-31)', () => {
  const start = poker();
  const withAction = (type: PokerView['actions'][number]['type'], over: Partial<PokerView> = {}) =>
    poker({ actions: [...start.actions, { seat: 0, name: 'p0', type, amount: 10 }], ...over });

  it('a new hand plays poker-deal (blinds included)', () => {
    const prev = poker({ handId: null, actions: [], seats: [seat(0), seat(1)], pot: 0 });
    expect(pokerSounds(prev, start)).toEqual(['poker-deal', 'poker-bet']);
  });
  it.each(['call', 'bet', 'raise'] as const)('%s plays poker-bet', (type) => {
    expect(pokerSounds(start, withAction(type))).toEqual(['poker-bet']);
  });
  it.each(['fold', 'leave_fold'] as const)('%s plays poker-fold', (type) => {
    expect(pokerSounds(start, withAction(type))).toEqual(['poker-fold']);
  });
  it('a check plays nothing', () => {
    expect(pokerSounds(start, withAction('check'))).toEqual([]);
  });
  it('winning the pot plays poker-win', () => {
    const next = poker({ winners: [{ seat: 1, name: 'p1', amount: 20 }] });
    expect(pokerSounds(start, next)).toEqual(['poker-win']);
    expect(diffPoker(next, next)).toEqual([]);
  });
  it('board cards and collecting chips are events without a sound', () => {
    const next = poker({ board: ['As', 'Kd', '2c'], seats: [seat(0), seat(1)], pot: 20, stage: 'flop' });
    expect(diffPoker(start, next)).toEqual(['board', 'collect']);
    expect(soundsFor(diffPoker(start, next))).toEqual([]);
  });
  it('a round closed by a check (pot unchanged) still collects the bets', () => {
    const called = poker({ seats: [seat(0, 10), seat(1, 10)], pot: 20 });
    const flop = poker({ board: ['As', 'Kd', '2c'], seats: [seat(0), seat(1)], pot: 20, stage: 'flop' });
    expect(diffPoker(called, flop)).toEqual(['board', 'collect']);
  });
  it('produces nothing when nothing changed', () => {
    expect(diffPoker(start, start)).toEqual([]);
    expect(diffPoker(null, start)).toEqual([]);
  });
});
