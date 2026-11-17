import { useEffect, useMemo, useState } from 'react';

/** Accept stays off this long after a request appears or changes. */
export const APPROVAL_ACCEPT_DELAY_MS = 1000;

/**
 * Keeps an approval's Accept off for `delayMs` after the dialog appears,
 * after its request changes (`resetKey`), and after Hub comes back to the
 * screen or its window to the front. A click meant for something else (the
 * second click of a double click, the click that brings Hub's window to the
 * front, or a button an app placed where Accept appears) then can't approve
 * a request that just appeared.
 *
 * Returns true once Accept may be used.
 */
export function useAcceptDelay(
  active: boolean,
  resetKey: unknown,
  delayMs: number = APPROVAL_ACCEPT_DELAY_MS
): boolean {
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    // Hidden or shown again: start over, so the delay runs while visible.
    // The desktop app's page stays "visible" when covered or minimized, so
    // the window losing or getting the focus starts over too.
    const onVisibilityChange = () => setVisibilityEpoch((epoch) => epoch + 1);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    window.addEventListener('blur', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
      window.removeEventListener('blur', onVisibilityChange);
    };
  }, [active]);

  // A new object whenever anything restarts the delay. Comparing against it
  // turns Accept off in the very render that shows new content, not one
  // effect later.
  const token = useMemo(
    () => ({ active, resetKey, visibilityEpoch }),
    [active, resetKey, visibilityEpoch]
  );
  const [armedToken, setArmedToken] = useState<object | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    if (typeof document !== 'undefined' && document.hidden) return undefined;
    const timer = setTimeout(() => setArmedToken(token), Math.max(0, delayMs));
    return () => clearTimeout(timer);
  }, [active, delayMs, token]);

  return active && armedToken === token;
}
