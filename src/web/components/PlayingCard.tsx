import { cardLabel } from '../../shared/poker/cards.js';
import { SuitIcon } from './SuitIcon.js';

export type CardSize = 'sm' | 'md' | 'board';

interface Props {
  /** Card code such as "Th"; omitted for a face-down card. */
  card?: string;
  size?: CardSize;
  highlight?: boolean;
  /** Animation hook: which group the card belongs to (hole / board). */
  animKey?: string;
}

/** A playing card drawn as a graphic (FR-072); its accessible name is the card label or "牌背". */
export function PlayingCard({ card, size = 'md', highlight = false, animKey }: Props) {
  if (!card) {
    return <span role="img" aria-label="牌背" className={`playing-card back ${size}`} data-anim-card={animKey} />;
  }
  const suit = card[1] ?? 's';
  const rank = card[0] === 'T' ? '10' : (card[0] ?? '');
  const red = suit === 'h' || suit === 'd';
  return (
    <span
      role="img"
      aria-label={cardLabel(card)}
      className={`playing-card face ${size} ${red ? 'red' : 'dark'}`}
      data-card={card}
      data-highlight={highlight ? 'true' : 'false'}
      data-anim-card={animKey}
    >
      <span className="pc-rank" aria-hidden="true">
        {rank}
      </span>
      <SuitIcon suit={suit} className="pc-suit-small" />
      <SuitIcon suit={suit} className="pc-suit" />
    </span>
  );
}
