import { COLLECT_MS, DEAL_CARD_MS, REVEAL_MS } from './durations.js';

/** Animation phase exposed on the table as `data-anim` (testability contract). */
export type PokerAnimPhase = 'idle' | 'dealing' | 'collecting' | 'revealing';

const canAnimate = (el: Element): el is HTMLElement => typeof (el as HTMLElement).animate === 'function';

function centreOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Hole cards fly from the table centre to their seats, one card every DEAL_CARD_MS, round-robin
 * over the seats (TD-013). Returns the total duration.
 */
export function animateDeal(table: HTMLElement): number {
  const seats = [...table.querySelectorAll('[data-seat]')].map((s) => [...s.querySelectorAll('[data-anim-card="hole"]')]);
  const order: Element[] = [];
  const rounds = Math.max(0, ...seats.map((c) => c.length));
  for (let r = 0; r < rounds; r++) for (const cards of seats) if (cards[r]) order.push(cards[r] as Element);
  const c = centreOf(table);
  order.forEach((el, i) => {
    if (!canAnimate(el)) return;
    const p = centreOf(el);
    el.animate(
      [
        { transform: `translate(${c.x - p.x}px, ${c.y - p.y}px) scale(0.6)`, opacity: 0.6 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: DEAL_CARD_MS, delay: i * DEAL_CARD_MS, easing: 'ease-out', fill: 'backwards' },
    );
  });
  return order.length * DEAL_CARD_MS;
}

/** Each listed seat's bet chips fly from its bet spot to the pot (COLLECT_MS). Returns the duration. */
export function animateCollect(table: HTMLElement, seats: number[]): number {
  const pot = table.querySelector('[data-pot-anchor]');
  if (!pot || seats.length === 0) return 0;
  const t = table.getBoundingClientRect();
  const to = centreOf(pot);
  for (const seat of seats) {
    const spot = table.querySelector(`[data-bet-anchor="${seat}"]`);
    if (!spot) continue;
    const from = centreOf(spot);
    const chip = document.createElement('span');
    chip.className = 'poker-chip flying';
    chip.setAttribute('aria-hidden', 'true');
    chip.setAttribute('data-flying-chip', String(seat));
    chip.style.left = `${from.x - t.left}px`;
    chip.style.top = `${from.y - t.top}px`;
    table.appendChild(chip);
    if (typeof chip.animate !== 'function') {
      chip.remove();
      continue;
    }
    const a = chip.animate(
      [{ transform: 'translate(-50%, -50%)' }, { transform: `translate(calc(${to.x - from.x}px - 50%), calc(${to.y - from.y}px - 50%))` }],
      { duration: COLLECT_MS, easing: 'ease-in-out', fill: 'forwards' },
    );
    a.finished.then(
      () => chip.remove(),
      () => chip.remove(),
    );
  }
  return COLLECT_MS;
}

/** Newly dealt board cards turn face up one by one (REVEAL_MS each), starting after `delay`. Returns the duration. */
export function animateReveal(table: HTMLElement, cards: string[], delay: number): number {
  cards.forEach((card, i) => {
    const el = table.querySelector(`[data-anim-card="board"][data-card="${card}"]`);
    if (!el || !canAnimate(el)) return;
    el.animate(
      [
        { transform: 'translateY(-40%) rotateY(90deg)', opacity: 0.4 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: REVEAL_MS, delay: delay + i * REVEAL_MS, easing: 'ease-out', fill: 'backwards' },
    );
  });
  return cards.length * REVEAL_MS;
}
