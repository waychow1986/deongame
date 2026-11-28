const PATHS: Record<string, string> = {
  s: 'M12 2C9 6 3 9.5 3 14a4.5 4.5 0 0 0 7.6 3.2L9 22h6l-1.6-4.8A4.5 4.5 0 0 0 21 14c0-4.5-6-8-9-12z',
  h: 'M12 21C7 16.5 2 12.6 2 8.2A5 5 0 0 1 12 6a5 5 0 0 1 10 2.2C22 12.6 17 16.5 12 21z',
  d: 'M12 2l8 10-8 10-8-10z',
  c: 'M12 2.5a4.3 4.3 0 0 0-3.6 6.7A4.3 4.3 0 1 0 10.6 17L9 22h6l-1.6-5a4.3 4.3 0 1 0 2.2-7.8A4.3 4.3 0 0 0 12 2.5z',
};

/** Suit glyph drawn as SVG; colour comes from the card (currentColor). */
export function SuitIcon({ suit, className }: { suit: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d={PATHS[suit] ?? PATHS.s} fill="currentColor" />
    </svg>
  );
}
