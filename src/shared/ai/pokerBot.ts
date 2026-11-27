import { POKER_BIG_BLIND } from '../constants.js';
import { rankValue } from '../poker/cards.js';
import { evaluateHand } from '../poker/evaluator.js';
import { legalActions, type HandState, type PlayerAction } from '../poker/hand.js';

/**
 * Poker computer player (TD-015): a simple hand-strength rule set that only ever returns a legal action.
 * It reads its own hole cards and the public board only.
 */

const RAISE_LIMIT = 4 * POKER_BIG_BLIND;

type Strength = 'strong' | 'medium' | 'weak';

function preflopStrength(hole: string[]): Strength {
  const [a, b] = hole as [string, string];
  const ra = rankValue(a);
  const rb = rankValue(b);
  if (ra === rb || (ra >= 10 && rb >= 10)) return 'strong';
  const suited = a[1] === b[1];
  if ((suited && Math.abs(ra - rb) === 1) || ra === 14 || rb === 14) return 'medium';
  return 'weak';
}

export function chooseBotAction(hand: HandState, seat: number): PlayerAction {
  const legal = legalActions(hand, seat);
  if (!legal) throw new Error('bot is not to act');
  const me = hand.players.find((p) => p.seat === seat);
  if (!me) throw new Error('bot is not in the hand');
  const passive = (): PlayerAction => (legal.call ? { type: 'call' } : { type: 'check' });
  const checkOrFold = (): PlayerAction => (legal.check ? { type: 'check' } : { type: 'fold' });

  if (hand.board.length === 0) {
    const strength = preflopStrength(me.hole);
    // Raise at most once per round and only while the bet is small, so bot-only tables do not min-raise to the cap.
    if (strength === 'strong') {
      if (hand.currentBet <= RAISE_LIMIT && legal.raise) return { type: 'raise', amount: legal.minRaiseTo };
      if (hand.currentBet <= RAISE_LIMIT && legal.bet) return { type: 'bet', amount: legal.minRaiseTo };
      return passive();
    }
    if (strength === 'medium') return passive();
    return legal.callAmount > POKER_BIG_BLIND ? checkOrFold() : passive();
  }
  const made = evaluateHand([...me.hole, ...hand.board]).rank !== 'high_card';
  return made ? passive() : checkOrFold();
}
