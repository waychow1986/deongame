import { useEffect, useState } from 'react';
import type { PokerLegalActions } from '../../shared/protocol.js';
import { quickRaiseAmount, raiseRangeError, raiseSubmitType } from '../../shared/ui/raise.js';

export type PokerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

interface Props {
  /** Server-provided legal actions; null when it is not the viewer's turn. */
  legal: PokerLegalActions | null;
  /** Viewer's bet in the current round. */
  committedThisRound: number;
  /** Pot as displayed on the table. */
  pot: number;
  /** Fallback slider range when nothing can be raised. */
  bigBlind: number;
  cap: number;
  /** Changes whenever a new decision starts, so the amount resets to the minimum. */
  turnKey: string;
  onAction: (type: PokerActionType, amount?: number) => void;
}

/** Fold / check / call / raise controls with slider, input and quick amounts (FR-080～FR-083, TD-019). */
export function PokerActionBar({ legal, committedThisRound, pot, bigBlind, cap, turnKey, onAction }: Props) {
  const submitType = raiseSubmitType(legal);
  const [text, setText] = useState(String(legal?.minRaiseTo ?? bigBlind));

  useEffect(() => {
    if (legal) setText(String(legal.minRaiseTo));
    // Only a new decision point resets the amount; re-renders of the same turn keep the user's input.
  }, [turnKey]);

  const amount = Number(text);
  const error = legal && submitType ? raiseRangeError(text.trim() === '' ? Number.NaN : amount, legal) : null;
  const canRaise = !!legal && !!submitType;
  const min = canRaise ? legal.minRaiseTo : bigBlind;
  const max = canRaise ? legal.maxRaiseTo : cap;
  const sliderValue = Number.isFinite(amount) ? Math.min(max, Math.max(min, amount)) : min;
  const quick = (ratio: number | 'max') => {
    if (!legal) return;
    setText(String(quickRaiseAmount(ratio, { committedThisRound, pot, legal })));
  };
  const callLabel = legal?.call && legal.callAmount > 0 ? `跟注 ${legal.callAmount}` : '跟注';

  return (
    <section aria-label="操作区" className="card poker-actions" data-active={legal ? 'true' : 'false'}>
      <div className="poker-actions-main">
        <button type="button" className="secondary" disabled={!legal?.fold} onClick={() => onAction('fold')}>
          弃牌
        </button>
        <button type="button" disabled={!legal?.check} onClick={() => onAction('check')}>
          过牌
        </button>
        <button type="button" disabled={!legal?.call} onClick={() => onAction('call')}>
          {callLabel}
        </button>
        <button
          type="button"
          disabled={!canRaise || !!error}
          onClick={() => submitType && !error && onAction(submitType, amount)}
        >
          加注
        </button>
      </div>
      <div className="poker-raise">
        <input
          type="range"
          aria-label="加注金额"
          min={min}
          max={max}
          step={1}
          value={sliderValue}
          disabled={!canRaise}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="poker-amount">
          <span>金额</span>
          <input
            type="number"
            aria-label="金额"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={text}
            disabled={!canRaise}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      <div className="poker-quick">
        <button type="button" className="secondary" disabled={!canRaise} onClick={() => quick(0.5)}>
          半个底池
        </button>
        <button type="button" className="secondary" disabled={!canRaise} onClick={() => quick(1)}>
          一个底池
        </button>
        <button type="button" className="secondary" disabled={!canRaise} onClick={() => quick('max')}>
          最大
        </button>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
    </section>
  );
}
