export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

const SUIT_LABEL: Record<string, string> = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };

export function fullDeck(): Card[] {
  const out: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}

export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as string) + 2;
}

/** Display / accessible name, e.g. "红桃A", "方块10". */
export function cardLabel(card: Card): string {
  const r = card[0] === 'T' ? '10' : (card[0] as string);
  return `${SUIT_LABEL[card[1] as string] ?? ''}${r}`;
}
