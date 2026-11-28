import { useEffect, useRef } from 'react';

/**
 * Calls `tick` immediately and then every `intervalMs` while the page is visible.
 * Hidden pages pause; becoming visible again triggers an immediate tick.
 */
export function usePolling(tick: () => Promise<void> | void, intervalMs: number): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (stopped || document.visibilityState === 'hidden') return;
      timer = setTimeout(run, intervalMs);
    };
    const run = async () => {
      if (stopped) return;
      try {
        await tickRef.current();
      } finally {
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run();
      else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
