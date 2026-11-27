import { useCallback, useEffect, useRef, useState } from 'react';

export const TOAST_MS = 2500;

/** One short message at a time; a new one replaces the old one (A-18). */
export function useToast(): { message: string | null; show: (msg: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { message, show };
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div role="status" aria-label="操作提示" className="toast" data-visible={message ? 'true' : 'false'}>
      {message ?? ''}
    </div>
  );
}
