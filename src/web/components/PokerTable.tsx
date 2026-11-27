import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { PokerSeatView, PokerView } from '../../shared/protocol.js';
import { diffPoker } from '../../shared/ui/events.js';
import { seatLayout, tableShape } from '../../shared/ui/seatLayout.js';
import { animateCollect, animateDeal, animateReveal, type PokerAnimPhase } from '../anim/pokerAnim.js';
import { PlayingCard } from './PlayingCard.js';
import { PokerActionBar, type PokerActionType } from './PokerActionBar.js';

export interface PokerTableProps {
  poker: PokerView;
  isHost: boolean;
  /** Number of seats at the table. */
  capacity: number;
  onStart: () => void;
  onAddBot: () => void;
  onAction: (type: PokerActionType, amount?: number) => void;
}

const ACTION_TEXT = {
  fold: '弃牌',
  check: '过牌',
  leave_fold: '离开（弃牌）',
} as const;

function logLine(a: PokerView['actions'][number]): string {
  switch (a.type) {
    case 'small_blind':
      return `${a.name} 小盲 ${a.amount}`;
    case 'big_blind':
      return `${a.name} 大盲 ${a.amount}`;
    case 'call':
      return `${a.name} 跟注 ${a.amount}`;
    case 'bet':
      return `${a.name} 下注 ${a.to ?? a.amount}`;
    case 'raise':
      return `${a.name} 加注到 ${a.to ?? a.amount}`;
    default:
      return `${a.name} ${ACTION_TEXT[a.type]}`;
  }
}

function seatStatus(s: PokerSeatView, poker: PokerView): string | null {
  if (s.waitingNextHand) return '等待下一手';
  if (s.folded) return '弃牌';
  if (poker.toActSeat === s.seat) return '行动中';
  if (s.atCap) return '全下';
  return null;
}

/** Result lines kept until the next hand starts (FR-085～FR-087). */
export function resultLines(poker: PokerView): string[] {
  const shown = new Map(poker.showdown.map((s) => [s.seat, s]));
  return poker.winners.map((w) => {
    const sd = shown.get(w.seat);
    return sd ? `${w.name} ${sd.handLabel} 赢得 ${w.amount}` : `${w.name} 赢得底池 ${w.amount}`;
  });
}

function useTableShape(): 'landscape' | 'portrait' {
  const [shape, setShape] = useState(() => tableShape(window.innerWidth));
  useEffect(() => {
    const onResize = () => setShape(tableShape(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return shape;
}

const pct = (n: number) => `${n.toFixed(3)}%`;
/** Bet chips sit on the way from the seat to the pot. */
const BET_RADIUS = 0.6;

/** Runs the deal / collect / reveal animations for a new snapshot and reports the phase (TD-013). */
function usePokerAnimation(poker: PokerView, tableRef: RefObject<HTMLElement | null>): PokerAnimPhase {
  const [phase, setPhase] = useState<PokerAnimPhase>('idle');
  const prevRef = useRef<PokerView | null>(null);
  const timers = useRef<number[]>([]);

  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = poker;
    const table = tableRef.current;
    if (!prev || !table) return;
    const events = diffPoker(prev, poker);
    const steps: { phase: PokerAnimPhase; at: number }[] = [];
    let t = 0;
    if (events.includes('deal')) {
      steps.push({ phase: 'dealing', at: t });
      t += animateDeal(table);
    }
    if (events.includes('collect')) {
      const before = new Map(prev.seats.map((s) => [s.seat, s]));
      const seats = poker.seats
        .filter((s) => {
          const p = before.get(s.seat);
          return !!p && p.committedThisRound + (s.committedThisHand - p.committedThisHand) > 0;
        })
        .map((s) => s.seat);
      const d = animateCollect(table, seats);
      if (d > 0) {
        steps.push({ phase: 'collecting', at: t });
        t += d;
      }
    }
    if (events.includes('board')) {
      const fresh = poker.board.slice(prev.board.length);
      steps.push({ phase: 'revealing', at: t });
      t += animateReveal(table, fresh, t);
    }
    if (steps.length === 0) return;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setPhase(steps[0]!.phase);
    for (const s of steps.slice(1)) timers.current.push(window.setTimeout(() => setPhase(s.phase), s.at));
    timers.current.push(window.setTimeout(() => setPhase('idle'), t));
  }, [poker, tableRef]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );
  return phase;
}

export function PokerTable({ poker, isHost, capacity, onStart, onAddBot, onAction }: PokerTableProps) {
  const tableRef = useRef<HTMLElement | null>(null);
  const shape = useTableShape();
  const phase = usePokerAnimation(poker, tableRef);
  const legal = poker.you.legal;
  const handRunning = poker.toActSeat !== null;
  const mySeat = poker.seats.find((s) => s.seat === poker.you.seat);
  const positions = new Map(seatLayout(capacity, poker.you.seat).map((p) => [p.seat, p]));
  const winners = new Set(poker.winners.map((w) => w.seat));
  const highlighted = new Set(poker.showdown.filter((s) => winners.has(s.seat)).flatMap((s) => s.bestCards));
  const lines = resultLines(poker);

  return (
    <>
      <div className="poker-table-wrap" data-shape={shape}>
        <section
          ref={tableRef}
          aria-label="牌桌"
          className="poker-table"
          data-anim={phase}
          data-shape={shape}
          data-seats={capacity}
        >
          <div role="status" aria-label="底池" className="poker-pot" data-pot-anchor="">
            底池：{poker.pot}
          </div>
          <section aria-label="公共牌" className="poker-board">
            {poker.board.map((c) => (
              <PlayingCard key={c} card={c} size="board" highlight={highlighted.has(c)} animKey="board" />
            ))}
          </section>
          {poker.seats.map((s) => {
            const p = positions.get(s.seat) ?? { x: 50, y: 50 };
            const bx = 50 + (p.x - 50) * BET_RADIUS;
            const by = 50 + (p.y - 50) * BET_RADIUS;
            return (
              <div
                key={`bet-${s.seat}`}
                className="poker-bet"
                data-bet-anchor={s.seat}
                aria-hidden="true"
                style={{ left: pct(bx), top: pct(by) }}
              >
                {s.committedThisRound > 0 && (
                  <>
                    <span className="poker-chip" />
                    <span className="poker-bet-amount">{s.committedThisRound}</span>
                  </>
                )}
              </div>
            );
          })}
          {poker.seats.map((s) => (
            <Seat
              key={s.seat}
              seat={s}
              poker={poker}
              me={s.seat === poker.you.seat}
              highlighted={highlighted}
              style={{ left: pct(positions.get(s.seat)?.x ?? 50), top: pct(positions.get(s.seat)?.y ?? 50) }}
            />
          ))}
        </section>
      </div>
      {lines.length > 0 && (
        <div role="status" aria-label="本手结果" className="card poker-result">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      {isHost && (
        <div className="actions poker-host">
          <button type="button" disabled={handRunning || poker.seats.length < 2} onClick={onStart}>
            开始牌局
          </button>
          <button type="button" className="secondary" disabled={handRunning || poker.seats.length >= capacity} onClick={onAddBot}>
            添加电脑玩家
          </button>
        </div>
      )}
      <PokerActionBar
        legal={legal}
        committedThisRound={mySeat?.committedThisRound ?? 0}
        pot={poker.pot}
        bigBlind={poker.blinds.big}
        cap={poker.handCommitCap}
        turnKey={`${poker.handId}:${poker.actions.length}:${legal ? 'me' : '-'}`}
        onAction={onAction}
      />
      <section className="card">
        <h2 className="sub">牌局记录</h2>
        <ol role="log" aria-label="牌局记录" className="poker-log">
          {poker.actions.map((a, i) => (
            <li key={i}>{logLine(a)}</li>
          ))}
          {lines.map((line, i) => (
            <li key={`w${i}`}>{line}</li>
          ))}
        </ol>
      </section>
    </>
  );
}

interface SeatProps {
  seat: PokerSeatView;
  poker: PokerView;
  me: boolean;
  highlighted: Set<string>;
  style: CSSProperties;
}

function Seat({ seat: s, poker, me, highlighted, style }: SeatProps) {
  const status = seatStatus(s, poker);
  const acting = poker.toActSeat === s.seat;
  const showCards = !!poker.handId && s.inHand && !s.folded;
  const hole = s.holeCards ?? [];
  return (
    <section
      aria-label={`座位 ${s.seat + 1}：${s.name}`}
      className="poker-seat"
      data-seat={s.seat}
      data-me={me ? 'true' : 'false'}
      data-acting={acting ? 'true' : 'false'}
      style={style}
    >
      {showCards && (
        <div className="seat-cards">
          {hole.length > 0
            ? hole.map((c) => (
                <PlayingCard key={`${poker.handId}-${c}`} card={c} size={me ? 'md' : 'sm'} highlight={highlighted.has(c)} animKey="hole" />
              ))
            : [0, 1].map((i) => <PlayingCard key={`${poker.handId}-${i}`} size="sm" animKey="hole" />)}
        </div>
      )}
      <div className="seat-info">
        <div className="seat-line">
          {s.isDealer && (
            <span role="img" aria-label="庄家" className="seat-marker dealer">
              庄
            </span>
          )}
          {s.isSmallBlind && (
            <span role="img" aria-label="小盲" className="seat-marker blind">
              小
            </span>
          )}
          {s.isBigBlind && (
            <span role="img" aria-label="大盲" className="seat-marker blind">
              大
            </span>
          )}
          <span className="seat-name">{s.name}</span>
          {s.kind === 'bot' && <span className="seat-bot">电脑</span>}
        </div>
        <div className="seat-line">
          <span className={`seat-chips${s.chips < 0 ? ' negative' : ''}`} data-negative={s.chips < 0 ? 'true' : 'false'}>
            筹码 {s.chips}
          </span>
          <span className="seat-bet">本轮下注 {s.committedThisRound}</span>
          {status && <span className="seat-status">{status}</span>}
        </div>
      </div>
    </section>
  );
}
