import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../../shared/protocol.js';
import { diffChess } from '../../shared/ui/events.js';
import { ANIM_WATCHDOG_MS } from '../anim/durations.js';

export interface FeedView {
  room: RoomSnapshot | null;
  prev: RoomSnapshot | null;
  /** True only when `room` directly follows `prev` (consecutive versions, no backlog). */
  animate: boolean;
}

/**
 * Snapshot queue (TD-014): only newer versions are accepted; while the board animates, later snapshots wait.
 * More than two waiting snapshots, or a gap in versions, are shown at once without animation.
 */
export function useRoomFeed(): FeedView & { push: (snap: RoomSnapshot) => void; animDone: () => void } {
  const [view, setView] = useState<FeedView>({ room: null, prev: null, animate: false });
  const queue = useRef<RoomSnapshot[]>([]);
  const latest = useRef(0);
  const current = useRef<RoomSnapshot | null>(null);
  const busy = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = useCallback(() => {
    if (busy.current || queue.current.length === 0) return;
    let next: RoomSnapshot;
    let animate: boolean;
    if (queue.current.length > 2) {
      next = queue.current[queue.current.length - 1] as RoomSnapshot;
      queue.current = [];
      animate = false;
    } else {
      next = queue.current.shift() as RoomSnapshot;
      animate = current.current !== null && next.version === current.current.version + 1;
    }
    const prev = current.current;
    current.current = next;
    if (animate && prev?.chess && next.chess && diffChess(prev.chess, next.chess).includes('move')) {
      busy.current = true;
      watchdog.current = setTimeout(() => {
        busy.current = false;
        advance();
      }, ANIM_WATCHDOG_MS);
    }
    setView({ room: next, prev, animate });
  }, []);

  const push = useCallback(
    (snap: RoomSnapshot) => {
      if (snap.version <= latest.current) return;
      latest.current = snap.version;
      queue.current.push(snap);
      advance();
    },
    [advance],
  );

  const animDone = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    busy.current = false;
    advance();
  }, [advance]);

  useEffect(
    () => () => {
      if (watchdog.current) clearTimeout(watchdog.current);
    },
    [],
  );

  return { ...view, push, animDone };
}
