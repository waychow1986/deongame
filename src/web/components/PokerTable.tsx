import { useEffect, useState } from 'react';
import type { PokerSeatView, PokerView } from '../../shared/protocol.js';
import { cardLabel } from '../../shared/poker/cards.js';

export interface PokerTableProps {
  poker: PokerView;
  isHost: boolean;
  onStart: () => void;
  onAction: (type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) => void;
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

function Cards({ cards }: { cards: string[] }) {
  return (
    <span className="cards">
      {cards.map((c) => (
        <span key={c} role="img" aria-label={cardLabel(c)} className={`playing-card ${'hd'.includes(c[1] ?? '') ? 'red' : ''}`}>
          {cardLabel(c)}
        </span>
      ))}
    </span>
  );
}

function seatStatus(s: PokerSeatView, poker: PokerView): string[] {
  const words: string[] = [];
  if (s.isDealer) words.push('庄家');
  if (s.isSmallBlind) words.push('小盲');
  if (s.isBigBlind) words.push('大盲');
  if (s.folded) words.push('已弃牌');
  if (poker.toActSeat === s.seat) words.push('行动中');
  if (s.atCap) words.push('已达上限');
  if (s.waitingNextHand) words.push('下一手加入');
  return words;
}

export function PokerTable({ poker, isHost, onStart, onAction }: PokerTableProps) {
  const legal = poker.you.legal;
  const [amount, setAmount] = useState<number>(legal?.minRaiseTo ?? poker.blinds.big);
  const handRunning = poker.toActSeat !== null;

  useEffect(() => {
    if (legal) setAmount(legal.minRaiseTo);
  }, [legal, legal?.minRaiseTo, poker.handId, poker.actions.length]);

  const mySeat = poker.seats.find((s) => s.seat === poker.you.seat);
  const showdownBySeat = new Map(poker.showdown.map((s) => [s.seat, s]));
  const winnerLines = poker.winners.map((w) => {
    const sd = showdownBySeat.get(w.seat);
    return sd ? `${w.name} ${sd.handLabel} 赢得 ${w.amount}` : `${w.name} 赢得 ${w.amount}`;
  });

  return (
    <>
      <section aria-label="牌桌" className="card poker-table">
        <div role="status" aria-label="底池">
          底池：{poker.pot}
        </div>
        <section aria-label="公共牌" className="board">
          <h2 className="sub">公共牌</h2>
          <Cards cards={poker.board} />
        </section>
        <ul className="seats">
          {poker.seats.map((s) => (
            <li key={s.seat}>
              <section aria-label={`座位 ${s.seat + 1}：${s.name}`} className={`seat ${poker.toActSeat === s.seat ? 'acting' : ''}`}>
                <strong>
                  座位 {s.seat + 1}：{s.name}
                </strong>
                {s.kind === 'bot' && <span> 电脑</span>}
                <div>筹码：{s.chips}</div>
                <div>本手投入：{s.committedThisHand}</div>
                {seatStatus(s, poker).length > 0 && <div className="muted">{seatStatus(s, poker).join(' ')}</div>}
                {s.seat !== poker.you.seat && s.holeCards && <Cards cards={s.holeCards} />}
              </section>
            </li>
          ))}
        </ul>
      </section>
      {mySeat?.holeCards && (
        <section aria-label="我的底牌" className="card">
          <h2 className="sub">我的底牌</h2>
          <Cards cards={mySeat.holeCards} />
        </section>
      )}
      <div className="actions">
        {isHost && (
          <button type="button" disabled={handRunning || poker.seats.length < 2} onClick={onStart}>
            开始牌局
          </button>
        )}
        <button type="button" disabled={!legal?.fold} onClick={() => onAction('fold')}>
          弃牌
        </button>
        <button type="button" disabled={!legal?.check} onClick={() => onAction('check')}>
          过牌
        </button>
        <button type="button" disabled={!legal?.call} onClick={() => onAction('call')}>
          {legal?.call ? `跟注 ${legal.callAmount}` : '跟注'}
        </button>
        <label>
          金额
          <input
            type="number"
            aria-label="金额"
            min={legal?.minRaiseTo}
            max={legal?.maxRaiseTo}
            step={1}
            value={amount}
            disabled={!legal || (!legal.bet && !legal.raise)}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>
        <button type="button" disabled={!legal?.bet} onClick={() => onAction('bet', amount)}>
          下注
        </button>
        <button type="button" disabled={!legal?.raise} onClick={() => onAction('raise', amount)}>
          加注
        </button>
      </div>
      <section className="card">
        <h2 className="sub">牌局记录</h2>
        <ol role="log" aria-label="牌局记录" className="poker-log">
          {poker.actions.map((a, i) => (
            <li key={i}>{logLine(a)}</li>
          ))}
          {winnerLines.map((line, i) => (
            <li key={`w${i}`}>{line}</li>
          ))}
        </ol>
      </section>
    </>
  );
}
