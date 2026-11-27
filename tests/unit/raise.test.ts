import { describe, expect, it } from 'vitest';
import type { PokerLegalActions } from '../../src/shared/protocol.js';
import { quickRaiseAmount, raiseRangeError, raiseSubmitType } from '../../src/shared/ui/raise.js';

function legal(over: Partial<PokerLegalActions> = {}): PokerLegalActions {
  return {
    fold: true,
    check: false,
    call: true,
    callAmount: 5,
    bet: false,
    raise: true,
    minRaiseTo: 20,
    maxRaiseTo: 1000,
    ...over,
  };
}

describe('quick raise amounts (TD-019, I14)', () => {
  it('targets round bet + call + round(ratio × (pot + call)) when inside the range', () => {
    // SB preflop: committed 5, call 5, pot 15 → half: 5 + 5 + round(0.5 × 20) = 20; full: 5 + 5 + 20 = 30.
    const ctx = { committedThisRound: 5, pot: 15, legal: legal({ minRaiseTo: 20 }) };
    expect(quickRaiseAmount(0.5, ctx)).toBe(20);
    expect(quickRaiseAmount(1, ctx)).toBe(30);
    // pot 50, call 30, committed 10: half = 10 + 30 + round(40) = 80; full = 10 + 30 + 80 = 120.
    const big = { committedThisRound: 10, pot: 50, legal: legal({ callAmount: 30, minRaiseTo: 70 }) };
    expect(quickRaiseAmount(0.5, big)).toBe(80);
    expect(quickRaiseAmount(1, big)).toBe(120);
  });

  it('rounds half up to an integer', () => {
    // 0 + 0 + round(0.5 × 45) = round(22.5) = 23.
    expect(quickRaiseAmount(0.5, { committedThisRound: 0, pot: 45, legal: legal({ callAmount: 0, minRaiseTo: 10 }) })).toBe(23);
  });

  it('clamps to the legal minimum and maximum', () => {
    expect(quickRaiseAmount(0.5, { committedThisRound: 0, pot: 10, legal: legal({ callAmount: 0, minRaiseTo: 10 }) })).toBe(10);
    expect(quickRaiseAmount(1, { committedThisRound: 0, pot: 900, legal: legal({ callAmount: 300, maxRaiseTo: 700 }) })).toBe(700);
  });

  it('uses the maximum for "最大"', () => {
    expect(quickRaiseAmount('max', { committedThisRound: 0, pot: 15, legal: legal({ maxRaiseTo: 995 }) })).toBe(995);
  });
});

describe('raise range validation and submit type (TD-019)', () => {
  it('rejects amounts outside [min, max] with the range message', () => {
    const l = legal({ minRaiseTo: 20, maxRaiseTo: 995 });
    expect(raiseRangeError(19, l)).toBe('加注金额须在 20～995 之间');
    expect(raiseRangeError(996, l)).toBe('加注金额须在 20～995 之间');
    expect(raiseRangeError(Number.NaN, l)).toBe('加注金额须在 20～995 之间');
    expect(raiseRangeError(20.5, l)).toBe('加注金额须在 20～995 之间');
    expect(raiseRangeError(20, l)).toBeNull();
    expect(raiseRangeError(995, l)).toBeNull();
  });

  it('submits bet when betting is legal, raise when raising is legal, nothing otherwise', () => {
    expect(raiseSubmitType(legal({ bet: true, raise: false }))).toBe('bet');
    expect(raiseSubmitType(legal({ bet: false, raise: true }))).toBe('raise');
    expect(raiseSubmitType(legal({ bet: false, raise: false }))).toBeNull();
    expect(raiseSubmitType(null)).toBeNull();
  });
});
