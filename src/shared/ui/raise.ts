import type { PokerLegalActions } from '../protocol.js';

/** Inputs for a quick amount: the viewer's bet this round, the displayed pot and the server's legal range. */
export interface QuickRaiseContext {
  committedThisRound: number;
  pot: number;
  legal: PokerLegalActions;
}

export function clampRaise(amount: number, legal: PokerLegalActions): number {
  return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, amount));
}

/** TD-019: round bet + call + round(ratio × (pot + call)), clamped to [minRaiseTo, maxRaiseTo]; "max" is maxRaiseTo. */
export function quickRaiseAmount(ratio: number | 'max', ctx: QuickRaiseContext): number {
  const { legal } = ctx;
  if (ratio === 'max') return legal.maxRaiseTo;
  const call = legal.callAmount;
  return clampRaise(ctx.committedThisRound + call + Math.round(ratio * (ctx.pot + call)), legal);
}

/** Error text when the entered round total is not a whole number inside the legal range, otherwise null. */
export function raiseRangeError(amount: number, legal: PokerLegalActions): string | null {
  const okAmount = Number.isInteger(amount) && amount >= legal.minRaiseTo && amount <= legal.maxRaiseTo;
  return okAmount ? null : `加注金额须在 ${legal.minRaiseTo}～${legal.maxRaiseTo} 之间`;
}

export function raiseSubmitType(legal: PokerLegalActions | null): 'bet' | 'raise' | null {
  if (!legal) return null;
  if (legal.bet) return 'bet';
  return legal.raise ? 'raise' : null;
}
