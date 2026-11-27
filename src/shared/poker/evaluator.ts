import { rankValue, type Card } from './cards.js';

export type HandRank =
  | 'high_card'
  | 'one_pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush'
  | 'royal_flush';

const CATEGORIES: HandRank[] = [
  'high_card',
  'one_pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
];

export const HAND_LABELS: Record<HandRank, string> = {
  high_card: '高牌',
  one_pair: '一对',
  two_pair: '两对',
  three_of_a_kind: '三条',
  straight: '顺子',
  flush: '同花',
  full_house: '葫芦',
  four_of_a_kind: '四条',
  straight_flush: '同花顺',
  royal_flush: '皇家同花顺',
};

/** Comparable score: [category, ...tie-breakers]. Suits never matter. */
export type Score = number[];

export function compareScores(a: Score, b: Score): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function straightHigh(values: number[]): number {
  const uniq = [...new Set(values)].sort((x, y) => y - x);
  if (uniq.length !== 5) return 0;
  if (uniq[0]! - uniq[4]! === 4) return uniq[0]!;
  // Wheel: A-2-3-4-5 counts as a five-high straight.
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return 0;
}

function score5(cards: Card[]): Score {
  const values = cards.map(rankValue);
  const flush = cards.every((c) => c[1] === cards[0]![1]);
  const high = straightHigh(values);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Groups sorted by size then value, e.g. full house [[13,3],[9,2]].
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  const sizes = groups.map((g) => g[1]).join('');
  if (high && flush) return [8, high];
  if (sizes === '41') return [7, ...byGroup];
  if (sizes === '32') return [6, ...byGroup];
  if (flush) return [5, ...byGroup];
  if (high) return [4, high];
  if (sizes === '311') return [3, ...byGroup];
  if (sizes === '221') return [2, ...byGroup];
  if (sizes === '2111') return [1, ...byGroup];
  return [0, ...byGroup];
}

export interface Evaluation {
  score: Score;
  rank: HandRank;
  best: Card[];
}

/** Best five-card hand out of 5–7 cards (enumerates every 5-card combination). */
export function evaluateHand(cards: Card[]): Evaluation {
  let best: Score | null = null;
  let bestCards: Card[] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            const s = score5(five);
            if (!best || compareScores(s, best) > 0) {
              best = s;
              bestCards = five;
            }
          }
  const score = best ?? [0];
  const rank: HandRank = score[0] === 8 && score[1] === 14 ? 'royal_flush' : (CATEGORIES[score[0] ?? 0] as HandRank);
  return { score, rank, best: bestCards };
}
