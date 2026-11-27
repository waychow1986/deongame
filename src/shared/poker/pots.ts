import { POKER_CAPACITY } from '../constants.js';
import { compareScores, type Score } from './evaluator.js';

export interface PotEntrant {
  seat: number;
  committed: number;
  folded: boolean;
  /** Required for players still in the hand. */
  score?: Score;
}

/**
 * Splits the pot into layers by commitment (main pot + side pots). Folded players' chips stay in the
 * layers they reached but they are not eligible. Ties split evenly; the odd chips of each pot go to the
 * first winner clockwise from the dealer (A-15). Returns winnings per seat, ordered by seat.
 */
export function distributePots(entrants: PotEntrant[], dealerSeat: number): { seat: number; amount: number }[] {
  const order = (seat: number) => (seat - dealerSeat - 1 + POKER_CAPACITY) % POKER_CAPACITY;
  const levels = [...new Set(entrants.map((e) => e.committed).filter((c) => c > 0))].sort((a, b) => a - b);
  const won = new Map<number, number>();
  let prev = 0;
  let carry = 0;
  let lastWinners: PotEntrant[] = [];
  const award = (amount: number, winners: PotEntrant[]) => {
    const sorted = [...winners].sort((a, b) => order(a.seat) - order(b.seat));
    const share = Math.floor(amount / sorted.length);
    const odd = amount - share * sorted.length;
    sorted.forEach((w, i) => won.set(w.seat, (won.get(w.seat) ?? 0) + share + (i === 0 ? odd : 0)));
  };
  for (const level of levels) {
    let amount = carry;
    for (const e of entrants) amount += Math.min(e.committed, level) - Math.min(e.committed, prev);
    prev = level;
    const eligible = entrants.filter((e) => !e.folded && e.committed >= level && e.score);
    if (eligible.length === 0) {
      carry = amount;
      continue;
    }
    carry = 0;
    let best: Score | null = null;
    for (const e of eligible) if (!best || compareScores(e.score as Score, best) > 0) best = e.score as Score;
    lastWinners = eligible.filter((e) => compareScores(e.score as Score, best as Score) === 0);
    award(amount, lastWinners);
  }
  // Chips above every eligible player's level (cannot normally happen) go to the last pot's winners.
  if (carry > 0 && lastWinners.length > 0) award(carry, lastWinners);
  return [...won.entries()].sort((a, b) => a[0] - b[0]).map(([seat, amount]) => ({ seat, amount }));
}
