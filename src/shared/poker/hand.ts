import { POKER_BIG_BLIND, POKER_HAND_COMMIT_CAP, POKER_SMALL_BLIND } from '../constants.js';
import { shuffle, type Rng } from '../rng.js';
import { fullDeck, type Card } from './cards.js';
import { evaluateHand, type HandRank } from './evaluator.js';
import { distributePots } from './pots.js';

export type Stage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type PlayerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type ActionType = PlayerActionType | 'small_blind' | 'big_blind' | 'leave_fold';

export interface PlayerAction {
  type: PlayerActionType;
  /** For bet / raise: the total this player has bet in the current round after the action ("raise to"). */
  amount?: number;
}

export interface HandPlayer {
  seat: number;
  hole: Card[];
  committed: number;
  roundBet: number;
  folded: boolean;
  /** Has acted since the last full raise in this round. */
  acted: boolean;
  /** False once the player acted and no full raise reopened the betting since. */
  canRaise: boolean;
}

export interface HandState {
  id: string;
  stage: Stage;
  deck: Card[];
  board: Card[];
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  /** Ordered by seat. */
  players: HandPlayer[];
  currentBet: number;
  lastRaiseSize: number;
  toAct: number | null;
  actions: { seat: number; type: ActionType; amount: number; to?: number }[];
  showdown: { seat: number; holeCards: Card[]; handRank: HandRank }[];
  winners: { seat: number; amount: number }[];
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: boolean;
  callAmount: number;
  bet: boolean;
  raise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export type ActionResult = { ok: true } | { ok: false; code: 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION'; message: string };

export const ILLEGAL = {
  mustCall: '当前需要跟注，不能过牌',
  belowMinRaise: '加注额低于最小加注',
  overCap: `超出每手下注上限 ${POKER_HAND_COMMIT_CAP}`,
  cannotBet: '当前不能下注',
  nothingToCall: '当前没有需要跟注的下注',
  handOver: '本手牌已结束',
} as const;

export interface StartHandInput {
  id: string;
  /** Occupied seats taking part in the hand (at least 2). */
  seats: number[];
  dealerSeat: number;
  rng: Rng;
  /** Pre-arranged deck (tests only); otherwise a shuffled 52-card deck. */
  deck?: Card[];
}

function nextSeat(seats: number[], after: number): number {
  const sorted = [...seats].sort((a, b) => a - b);
  return sorted.find((s) => s > after) ?? (sorted[0] as number);
}

function commit(p: HandPlayer, amount: number): void {
  p.committed += amount;
  p.roundBet += amount;
}

export function isHandOver(h: HandState): boolean {
  return h.stage === 'showdown' || h.stage === 'complete';
}

export function potTotal(h: HandState): number {
  return h.players.reduce((s, p) => s + p.committed, 0);
}

const atCap = (p: HandPlayer) => p.committed >= POKER_HAND_COMMIT_CAP;

export function startHand(input: StartHandInput): HandState {
  const seats = [...new Set(input.seats)].sort((a, b) => a - b);
  if (seats.length < 2) throw new Error('at least two players');
  const dealerSeat = input.dealerSeat;
  // Heads-up the dealer posts the small blind (FR-051).
  const sbSeat = seats.length === 2 ? dealerSeat : nextSeat(seats, dealerSeat);
  const bbSeat = nextSeat(seats, sbSeat);
  const deck = input.deck ? [...input.deck] : shuffle(fullDeck(), input.rng);
  const players: HandPlayer[] = seats.map((seat) => ({
    seat,
    hole: [],
    committed: 0,
    roundBet: 0,
    folded: false,
    acted: false,
    canRaise: true,
  }));
  const h: HandState = {
    id: input.id,
    stage: 'preflop',
    deck,
    board: [],
    dealerSeat,
    sbSeat,
    bbSeat,
    players,
    currentBet: POKER_BIG_BLIND,
    lastRaiseSize: POKER_BIG_BLIND,
    toAct: null,
    actions: [],
    showdown: [],
    winners: [],
  };
  // Two cards per player, starting with the small blind and going clockwise.
  let seat = sbSeat;
  for (let i = 0; i < seats.length; i++) {
    const p = find(h, seat);
    p.hole = [h.deck.shift() as Card, h.deck.shift() as Card];
    seat = nextSeat(seats, seat);
  }
  commit(find(h, sbSeat), POKER_SMALL_BLIND);
  h.actions.push({ seat: sbSeat, type: 'small_blind', amount: POKER_SMALL_BLIND });
  commit(find(h, bbSeat), POKER_BIG_BLIND);
  h.actions.push({ seat: bbSeat, type: 'big_blind', amount: POKER_BIG_BLIND });
  h.toAct = nextSeat(seats, bbSeat);
  return h;
}

function find(h: HandState, seat: number): HandPlayer {
  const p = h.players.find((x) => x.seat === seat);
  if (!p) throw new Error(`seat ${seat} not in hand`);
  return p;
}

export function legalActions(h: HandState, seat: number): LegalActions | null {
  if (isHandOver(h) || h.toAct !== seat) return null;
  const p = find(h, seat);
  const remaining = POKER_HAND_COMMIT_CAP - p.committed;
  const toCall = Math.max(0, Math.min(h.currentBet - p.roundBet, remaining));
  const maxRaiseTo = p.roundBet + remaining;
  const canAggress = p.canRaise && maxRaiseTo > h.currentBet;
  const fullMin = h.currentBet === 0 ? POKER_BIG_BLIND : h.currentBet + h.lastRaiseSize;
  return {
    fold: true,
    check: h.currentBet <= p.roundBet,
    call: toCall > 0,
    callAmount: toCall,
    bet: h.currentBet === 0 && canAggress,
    raise: h.currentBet > 0 && canAggress,
    minRaiseTo: Math.min(fullMin, maxRaiseTo),
    maxRaiseTo,
  };
}

const illegal = (message: string): ActionResult => ({ ok: false, code: 'ILLEGAL_ACTION', message });

/** Applies a player's action if legal; otherwise leaves the state untouched. */
export function applyAction(h: HandState, seat: number, action: PlayerAction): ActionResult {
  if (isHandOver(h)) return illegal(ILLEGAL.handOver);
  const legal = legalActions(h, seat);
  if (!legal) return { ok: false, code: 'NOT_YOUR_TURN', message: '还没轮到你' };
  const p = find(h, seat);
  switch (action.type) {
    case 'fold':
      p.folded = true;
      h.actions.push({ seat, type: 'fold', amount: 0 });
      break;
    case 'check':
      if (!legal.check) return illegal(ILLEGAL.mustCall);
      h.actions.push({ seat, type: 'check', amount: 0 });
      break;
    case 'call':
      if (!legal.call) return illegal(ILLEGAL.nothingToCall);
      commit(p, legal.callAmount);
      h.actions.push({ seat, type: 'call', amount: legal.callAmount });
      break;
    case 'bet':
    case 'raise': {
      const amount = action.amount;
      const allowed = action.type === 'bet' ? legal.bet : legal.raise;
      if (!allowed || typeof amount !== 'number' || !Number.isInteger(amount)) return illegal(ILLEGAL.cannotBet);
      if (amount > legal.maxRaiseTo) return illegal(ILLEGAL.overCap);
      if (amount < legal.minRaiseTo) return illegal(ILLEGAL.belowMinRaise);
      const increment = amount - h.currentBet;
      const full = increment >= h.lastRaiseSize;
      const added = amount - p.roundBet;
      commit(p, added);
      h.currentBet = amount;
      for (const o of h.players) {
        if (o === p || o.folded) continue;
        o.acted = false;
        // A short all-in to the cap does not reopen raising for players who already acted.
        if (full) o.canRaise = true;
      }
      if (full) h.lastRaiseSize = increment;
      h.actions.push({ seat, type: action.type, amount: added, to: amount });
      break;
    }
    default:
      return illegal(ILLEGAL.cannotBet);
  }
  p.acted = true;
  p.canRaise = false;
  advance(h, seat);
  return { ok: true };
}

/** A player leaving mid-hand is folded immediately, in or out of turn (FR-093). */
export function forceFold(h: HandState, seat: number): void {
  if (isHandOver(h)) return;
  const p = h.players.find((x) => x.seat === seat);
  if (!p || p.folded) return;
  p.folded = true;
  h.actions.push({ seat, type: 'leave_fold', amount: 0 });
  const wasToAct = h.toAct === seat;
  const pending = h.toAct;
  if (wasToAct || pending === null) advance(h, seat);
  else advance(h, pending, true);
}

function advance(h: HandState, fromSeat: number, inclusive = false): void {
  const active = h.players.filter((p) => !p.folded);
  if (active.length === 1) {
    h.stage = 'complete';
    h.toAct = null;
    h.winners = [{ seat: (active[0] as HandPlayer).seat, amount: potTotal(h) }];
    return;
  }
  const actors = active.filter((p) => !atCap(p));
  const matched = (p: HandPlayer) => p.roundBet >= h.currentBet || atCap(p);
  let pending = actors.filter((p) => !p.acted || !matched(p));
  // Nobody left to bet against.
  if (actors.length === 1 && matched(actors[0] as HandPlayer)) pending = [];
  if (pending.length > 0) {
    const seats = pending.map((p) => p.seat);
    h.toAct = inclusive && seats.includes(fromSeat) ? fromSeat : nextSeat(seats, fromSeat);
    return;
  }
  endRound(h, actors.length);
}

function deal(h: HandState, n: number): void {
  for (let i = 0; i < n; i++) h.board.push(h.deck.shift() as Card);
}

function endRound(h: HandState, actorCount: number): void {
  if (h.stage === 'river' || actorCount <= 1) {
    deal(h, 5 - h.board.length);
    showdown(h);
    return;
  }
  h.stage = h.stage === 'preflop' ? 'flop' : h.stage === 'flop' ? 'turn' : 'river';
  deal(h, h.stage === 'flop' ? 3 : 1);
  for (const p of h.players) {
    p.roundBet = 0;
    p.acted = false;
    p.canRaise = true;
  }
  h.currentBet = 0;
  h.lastRaiseSize = POKER_BIG_BLIND;
  const actors = h.players.filter((p) => !p.folded && !atCap(p)).map((p) => p.seat);
  h.toAct = nextSeat(actors, h.dealerSeat);
}

function showdown(h: HandState): void {
  h.stage = 'showdown';
  h.toAct = null;
  const entrants = h.players.map((p) => {
    if (p.folded) return { seat: p.seat, committed: p.committed, folded: true };
    const ev = evaluateHand([...p.hole, ...h.board]);
    h.showdown.push({ seat: p.seat, holeCards: [...p.hole], handRank: ev.rank });
    return { seat: p.seat, committed: p.committed, folded: false, score: ev.score };
  });
  h.winners = distributePots(entrants, h.dealerSeat);
}

/** Net chip change per seat for a finished hand (won − committed). */
export function netResults(h: HandState): { seat: number; net: number }[] {
  return h.players.map((p) => ({
    seat: p.seat,
    net: (h.winners.find((w) => w.seat === p.seat)?.amount ?? 0) - p.committed,
  }));
}
