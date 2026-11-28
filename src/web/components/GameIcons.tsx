export function ChessIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="中国象棋图标">
      <circle cx="32" cy="32" r="28" fill="#fbf3e0" stroke="#b23a2b" strokeWidth="4" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#b23a2b" strokeWidth="1.5" />
      <text x="32" y="42" textAnchor="middle" fontSize="28" fontWeight="700" fill="#b23a2b" fontFamily="serif">
        帅
      </text>
    </svg>
  );
}

export function PokerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="德州扑克图标">
      <rect x="8" y="10" width="30" height="42" rx="4" fill="#fff" stroke="#2b2118" strokeWidth="2" transform="rotate(-12 23 31)" />
      <rect x="24" y="10" width="30" height="42" rx="4" fill="#fff" stroke="#2b2118" strokeWidth="2" transform="rotate(10 39 31)" />
      <path d="M40 24c-4-6-12-2-8 5l8 9 8-9c4-7-4-11-8-5z" fill="#d63031" transform="rotate(10 39 31)" />
    </svg>
  );
}
