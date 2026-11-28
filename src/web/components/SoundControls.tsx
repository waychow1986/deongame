import { useSyncExternalStore } from 'react';
import { isMuted, setMuted, subscribeMuted } from '../audio/sound.js';

export function useMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, isMuted);
}

export function MuteButton() {
  const muted = useMuted();
  return (
    <button
      type="button"
      className="secondary mute-button"
      aria-label="静音"
      aria-pressed={muted}
      title={muted ? '已静音，点按恢复声音' : '点按静音'}
      onClick={() => setMuted(!muted)}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}

const MOBILE_QUERY = '(pointer: coarse) and (hover: none)';

function isMobile(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

/** Fixed hint on phones while sound is on (Q3, FR-094). */
export function MobileSoundHint() {
  const muted = useMuted();
  if (muted || !isMobile()) return null;
  return <p className="sound-hint">听不到声音？请关闭手机静音模式</p>;
}
