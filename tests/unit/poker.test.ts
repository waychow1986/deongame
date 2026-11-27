import { describe, expect, it } from 'vitest';
import {
  applyAction,
  distributePots,
  evaluateHand,
  compareScores,
  forceFold,
  legalActions,
  startHand,
  cardLabel,
  type HandState,
} from '../../src/shared/poker/index.js';
import { seededRng } from '../../src/shared/rng.js';

function score(cards: string) {
  return evaluateHand(cards.split(' ')).score;
}

function rankOf(cards: string) {
  return evaluateHand(cards.split(' ')).rank;
}

/** Deck whose first cards are dealt as hole cards (two per player in seat order from the small blind), then the board. */
function deck(cards: string): string[] {
  return cards.split(' ');
}

function act(h: HandState, seat: number, type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) {
  return applyAction(h, seat, amount === undefined ? { type } : { type, amount });
}

function ok(h: HandState, seat: number, type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) {
  const res = act(h, seat, type, amount);
  if (!res.ok) throw new Error(`${type} ${amount ?? ''} by seat ${seat} rejected: ${res.message}`);
}

function player(h: HandState, seat: number) {
  const p = h.players.find((x) => x.seat === seat);
  if (!p) throw new Error('no player');
  return p;
}

describe('poker hand evaluation (DC-07)', () => {
  it('orders the ten hand categories', () => {
    const hands = [
      ['2s 5h 9d Jc Kh 3c 4d', 'high_card'],
      ['2s 2h 9d Jc Kh 3c 7d', 'one_pair'],
      ['2s 2h 9d 9c Kh 3c 7d', 'two_pair'],
      ['2s 2h 2d 9c Kh 3c 7d', 'three_of_a_kind'],
      ['2s 3h 4d 5c 6h Jc Kd', 'straight'],
      ['2h 5h 9h Jh Kh 3c 4d', 'flush'],
      ['2s 2h 2d 9c 9h 3c 7d', 'full_house'],
      ['2s 2h 2d 2c Kh 3c 7d', 'four_of_a_kind'],
      ['5h 6h 7h 8h 9h 2c 2d', 'straight_flush'],
      ['Th Jh Qh Kh Ah 2c 2d', 'royal_flush'],
    ] as const;
    for (const [cards, rank] of hands) expect(rankOf(cards)).toBe(rank);
    for (let i = 1; i < hands.length; i++) {
      expect(compareScores(score(hands[i]![0]), score(hands[i - 1]![0]))).toBeGreaterThan(0);
    }
  });

  it('treats A-2-3-4-5 as the lowest straight and A-K-Q-J-T as the highest', () => {
    expect(rankOf('As 2h 3d 4c 5h 9c Kd')).toBe('straight');
    expect(compareScores(score('As 2h 3d 4c 5h 9c Kd'), score('2s 3h 4d 5c 6h 9c Kd'))).toBeLessThan(0);
    expect(compareScores(score('As Kh Qd Jc Th 2c 3d'), score('9s Kh Qd Jc Th 2c 3d'))).toBeGreaterThan(0);
    expect(rankOf('Ah 2h 3h 4h 5h 9c Kd')).toBe('straight_flush');
  });

  it('compares kickers within a category, ignores suits and ties identical hands', () => {
    expect(compareScores(score('As Ah Kd 7c 3h 2c 4d'), score('Ac Ad Qd 7c 3h 2c 4d'))).toBeGreaterThan(0);
    expect(compareScores(score('Ks Kh 7d 7c 2h 3c 4d'), score('Qs Qh Jd Jc 2h 3c 4d'))).toBeGreaterThan(0);
    expect(compareScores(score('2h 5h 9h Jh Kh 3c 4d'), score('2s 5s 9s Js Ks 3c 4d'))).toBe(0);
    // Board plays for both: exact tie.
    expect(compareScores(score('2c 3d As Ks Qs Js Ts'), score('4c 5d As Ks Qs Js Ts'))).toBe(0);
  });

  it('labels cards with Chinese suits, showing T as 10', () => {
    expect(cardLabel('Ah')).toBe('红桃A');
    expect(cardLabel('Td')).toBe('方块10');
    expect(cardLabel('2s')).toBe('黑桃2');
    expect(cardLabel('Kc')).toBe('梅花K');
  });
});

describe('poker pot distribution (DC-07)', () => {
  const strong = score('As Ah Ad Kc Kh 2c 3d');
  const mid = score('Qs Qh 9d 7c 5h 2c 3d');
  const weak = score('Js 9h 8d 6c 4h 2c 3d');

  it('splits main and side pots among eligible players only; folded chips stay in the pots', () => {
    const res = distributePots(
      [
        { seat: 0, committed: 100, folded: false, score: strong },
        { seat: 1, committed: 1000, folded: false, score: mid },
        { seat: 2, committed: 1000, folded: false, score: weak },
        { seat: 3, committed: 50, folded: true },
      ],
      3,
    );
    // Main pot 50*4 + 50*3 = 350 to seat 0; side pot 900*2 = 1800 to seat 1.
    expect(res).toEqual([
      { seat: 0, amount: 350 },
      { seat: 1, amount: 1800 },
    ]);
  });

  it('splits a tie evenly and gives the odd chip to the first winner left of the dealer', () => {
    const res = distributePots(
      [
        { seat: 0, committed: 15, folded: true },
        { seat: 2, committed: 20, folded: false, score: mid },
        { seat: 5, committed: 20, folded: false, score: mid },
      ],
      3,
    );
    // Pot 55: 27 each, odd chip to seat 5 (first winner clockwise from the dealer at seat 3).
    expect(res).toEqual([
      { seat: 2, amount: 27 },
      { seat: 5, amount: 28 },
    ]);
    const total = res.reduce((s, w) => s + w.amount, 0);
    expect(total).toBe(55);
  });
});

describe('poker betting rules (DC-08)', () => {
  it('posts blinds 5/10; heads-up the dealer posts the small blind and acts first preflop', () => {
    const h = startHand({ id: 'h', seats: [0, 4], dealerSeat: 0, rng: seededRng(1) });
    expect(h.sbSeat).toBe(0);
    expect(h.bbSeat).toBe(4);
    expect(player(h, 0).committed).toBe(5);
    expect(player(h, 4).committed).toBe(10);
    expect(h.toAct).toBe(0);
    expect(h.actions).toEqual([
      { seat: 0, type: 'small_blind', amount: 5 },
      { seat: 4, type: 'big_blind', amount: 10 },
    ]);
    expect(player(h, 0).hole).toHaveLength(2);
    expect(h.board).toEqual([]);
  });

  it('three-handed: blinds left of the dealer, first action left of the big blind', () => {
    const h = startHand({ id: 'h', seats: [1, 3, 6], dealerSeat: 3, rng: seededRng(1) });
    expect([h.sbSeat, h.bbSeat, h.toAct]).toEqual([6, 1, 3]);
  });

  it('rejects out-of-turn actions and a check facing a bet', () => {
    const h = startHand({ id: 'h', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    expect(act(h, 1, 'call')).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(act(h, 0, 'check')).toEqual({ ok: false, code: 'ILLEGAL_ACTION', message: '当前需要跟注，不能过牌' });
  });

  it('enforces the minimum raise increment (TS-33: 19/20 and 79/80)', () => {
    const h = startHand({ id: 'h', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    expect(legalActions(h, 0)).toMatchObject({ call: true, callAmount: 10, raise: true, bet: false, minRaiseTo: 20, maxRaiseTo: 1000 });
    expect(act(h, 0, 'raise', 19)).toEqual({ ok: false, code: 'ILLEGAL_ACTION', message: '加注额低于最小加注' });
    ok(h, 0, 'raise', 50);
    expect(legalActions(h, 1)).toMatchObject({ callAmount: 45, minRaiseTo: 90 });
    const h2 = startHand({ id: 'h2', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    ok(h2, 0, 'raise', 20);
    ok(h2, 1, 'raise', 50);
    expect(act(h2, 2, 'raise', 79)).toMatchObject({ ok: false, message: '加注额低于最小加注' });
    ok(h2, 2, 'raise', 80);
  });

  it('requires a minimum bet of the big blind after the flop', () => {
    const h = startHand({ id: 'h', seats: [0, 1], dealerSeat: 0, rng: seededRng(1) });
    ok(h, 0, 'call');
    ok(h, 1, 'check');
    expect(h.stage).toBe('flop');
    expect(h.board).toHaveLength(3);
    expect(h.toAct).toBe(1);
    expect(legalActions(h, 1)).toMatchObject({ check: true, call: false, bet: true, raise: false, minRaiseTo: 10, maxRaiseTo: 990 });
    expect(act(h, 1, 'bet', 9)).toMatchObject({ ok: false, message: '加注额低于最小加注' });
    expect(act(h, 1, 'raise', 20)).toMatchObject({ ok: false, message: '当前不能下注' });
    ok(h, 1, 'bet', 10);
  });

  it('caps each player at 1000 per hand including blinds: 1001 rejected, 1000 accepted, call capped', () => {
    const h = startHand({ id: 'h', seats: [0, 1], dealerSeat: 0, rng: seededRng(1) });
    expect(act(h, 0, 'raise', 1001)).toEqual({ ok: false, code: 'ILLEGAL_ACTION', message: '超出每手下注上限 1000' });
    const before = player(h, 0).committed;
    expect(before).toBe(5);
    ok(h, 0, 'raise', 999);
    expect(player(h, 0).committed).toBe(999);
    expect(legalActions(h, 1)).toMatchObject({ callAmount: 989, maxRaiseTo: 1000, minRaiseTo: 1000, raise: true });
    ok(h, 1, 'raise', 1000);
    expect(player(h, 1).committed).toBe(1000);
    // Seat 0 may call 1 more but may not re-raise past the cap.
    expect(legalActions(h, 0)).toMatchObject({ call: true, callAmount: 1, raise: false });
    ok(h, 0, 'call');
    expect(player(h, 0).committed).toBe(1000);
    // Everyone at the cap: the board runs out to showdown.
    expect(h.stage).toBe('showdown');
    expect(h.board).toHaveLength(5);
    expect(h.winners.reduce((s, w) => s + w.amount, 0)).toBe(2000);
  });

  it('allows an all-in to exactly the cap below a full raise without reopening raising', () => {
    const h = startHand({ id: 'h', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    ok(h, 0, 'raise', 400);
    ok(h, 1, 'raise', 990); // seat 1 (SB) raises by 590
    // Seat 2 (BB, 10 in) may go to 1000: increment 10 < 590 but it is an all-in to the cap.
    expect(legalActions(h, 2)).toMatchObject({ minRaiseTo: 1000, maxRaiseTo: 1000 });
    expect(act(h, 2, 'raise', 999)).toMatchObject({ ok: false, message: '加注额低于最小加注' });
    ok(h, 2, 'raise', 1000);
    expect(player(h, 2).committed).toBe(1000);
    expect(h.currentBet).toBe(1000);
    expect(legalActions(h, 0)).toMatchObject({ call: true, callAmount: 600, raise: false });
    ok(h, 0, 'call');
    // Seat 1 already acted and only faced a short all-in: call or fold only.
    expect(legalActions(h, 1)).toMatchObject({ call: true, callAmount: 10, raise: false });
    ok(h, 1, 'call');
    expect(h.stage).toBe('showdown');
  });

  it('keeps a player at the cap in the hand without further actions', () => {
    const h = startHand({ id: 'h', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    ok(h, 0, 'raise', 1000);
    ok(h, 1, 'call');
    ok(h, 2, 'fold');
    expect(player(h, 0).folded).toBe(false);
    expect(h.stage).toBe('showdown');
    expect(h.showdown.map((s) => s.seat).sort()).toEqual([0, 1]);
  });

  it('ends the hand immediately when everyone else folds, without dealing or revealing', () => {
    const h = startHand({ id: 'h', seats: [0, 1, 2], dealerSeat: 0, rng: seededRng(1) });
    ok(h, 0, 'raise', 40);
    ok(h, 1, 'fold');
    ok(h, 2, 'fold');
    expect(h.stage).toBe('complete');
    expect(h.board).toEqual([]);
    expect(h.showdown).toEqual([]);
    expect(h.winners).toEqual([{ seat: 0, amount: 55 }]);
    expect(h.toAct).toBeNull();
    expect(act(h, 0, 'check')).toMatchObject({ ok: false });
  });

  it('a player leaving out of turn is folded; the last remaining player wins', () => {
    const h = startHand({ id: 'h', seats: [0, 1], dealerSeat: 0, rng: seededRng(1) });
    forceFold(h, 1);
    expect(h.actions.at(-1)).toEqual({ seat: 1, type: 'leave_fold', amount: 0 });
    expect(h.stage).toBe('complete');
    expect(h.winners).toEqual([{ seat: 0, amount: 15 }]);
  });

  it('plays a full hand to showdown and distributes the pot by hand strength', () => {
    // Seat 0 (SB/dealer) gets As Ad, seat 1 gets 7c 2h; board Ks 9d 4h 3c 8s.
    const h = startHand({ id: 'h', seats: [0, 1], dealerSeat: 0, rng: seededRng(1), deck: deck('As Ad 7c 2h Ks 9d 4h 3c 8s') });
    ok(h, 0, 'call');
    ok(h, 1, 'check');
    ok(h, 1, 'bet', 20);
    ok(h, 0, 'call');
    expect(h.stage).toBe('turn');
    ok(h, 1, 'check');
    ok(h, 0, 'check');
    ok(h, 1, 'check');
    ok(h, 0, 'check');
    expect(h.stage).toBe('showdown');
    expect(h.board).toEqual(['Ks', '9d', '4h', '3c', '8s']);
    expect(h.showdown).toEqual([
      { seat: 0, holeCards: ['As', 'Ad'], handRank: 'one_pair' },
      { seat: 1, holeCards: ['7c', '2h'], handRank: 'high_card' },
    ]);
    expect(h.winners).toEqual([{ seat: 0, amount: 60 }]);
  });
});
