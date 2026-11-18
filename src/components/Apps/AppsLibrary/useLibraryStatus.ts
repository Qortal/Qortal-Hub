import { useEffect, useState } from 'react';
import { LOADING_GRACE_MS } from './libraryLayout';

export type LibraryStatus = 'loading' | 'ready' | 'empty';

/**
 * Whether the library is still loading or the node really has nothing. The
 * node's list gives no signal of its own, so an empty list counts as loading
 * for a while after the library opens, or until a refresh has finished. A
 * list that comes later still replaces the empty state.
 */
export const useLibraryStatus = (
  appCount: number,
  settledRefreshes: number
): LibraryStatus => {
  const [isGraceOver, setIsGraceOver] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setIsGraceOver(true),
      LOADING_GRACE_MS
    );
    return () => window.clearTimeout(timer);
  }, []);

  if (appCount > 0) return 'ready';
  return isGraceOver || settledRefreshes > 0 ? 'empty' : 'loading';
};
