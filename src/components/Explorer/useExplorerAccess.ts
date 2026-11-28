/**
 * The level 5+ rule in the Explorer window (lib/explorer/access.ts):
 * whether the signed-in Hub account sees the detailed parts. This hides
 * parts of Hub's screen; it doesn't protect data (everything they show is
 * public on the chain).
 *
 * - Read when the window opens, through its cache (so the account page of
 *   one's own account, and every page's Dev Admin mark, share the reads).
 * - An answer is kept about a minute for its Hub account: reopening the
 *   window within it reads nothing again. A failed read is never kept.
 * - Another Hub account starts again: nothing kept for the last one counts
 *   for it, and an answer for the last one that arrives late is dropped.
 * - Until it is known, and after a failed read, the detailed parts stay
 *   out (fail closed), so nothing flashes and nothing says they exist.
 */
import { useEffect, useRef, useState } from 'react';
import { ACCESS_TTL_MS, readFullExplorer } from '../../lib/explorer/access';
import type { ExplorerCache } from '../../lib/explorer/cache';
import { exchangeName } from '../../lib/explorer/exchanges';
import { useExplorer } from './ExplorerContext';

/**
 * - `reading`: not known yet;
 * - `full`: it sees the detailed parts;
 * - `basic`: it doesn't (or no one is signed in);
 * - `unknown`: a read failed, so it doesn't for now.
 */
export type AccessState = 'reading' | 'full' | 'basic' | 'unknown';

interface Kept {
  viewer: string;
  full: boolean;
  at: number;
}

/**
 * The rule for `viewer`, run once by the window. The window replaces its
 * cache whenever it closes or the Hub account changes, so a new cache
 * (or the window opening) is when the rule is read again.
 */
export function useAccessRule(
  cache: ExplorerCache,
  viewer: string | null,
  open: boolean
): AccessState {
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const kept = useRef<Kept | null>(null);
  const [shown, setShown] = useState<{
    viewer: string | null;
    state: AccessState;
  }>({ viewer: null, state: 'basic' });

  useEffect(() => {
    const who = viewerRef.current;
    // Another Hub account: what was kept for the last one goes.
    if (kept.current && kept.current.viewer !== who) kept.current = null;
    if (!open) return undefined;
    if (!who) {
      setShown({ viewer: null, state: 'basic' });
      return undefined;
    }
    const known = kept.current;
    if (known && Date.now() - known.at < ACCESS_TTL_MS) {
      setShown({ viewer: who, state: known.full ? 'full' : 'basic' });
      return undefined;
    }
    let live = true;
    setShown({ viewer: who, state: 'reading' });
    readFullExplorer(who, cache).then(
      (full) => {
        if (!live || viewerRef.current !== who) return;
        kept.current = { viewer: who, full, at: Date.now() };
        setShown({ viewer: who, state: full ? 'full' : 'basic' });
      },
      () => {
        if (!live || viewerRef.current !== who) return;
        setShown({ viewer: who, state: 'unknown' });
      }
    );
    return () => {
      live = false;
    };
  }, [open, cache]);

  if (shown.viewer === viewer) return shown.state;
  // A Hub account whose answer isn't in yet: not known.
  return viewer ? 'reading' : 'basic';
}

/**
 * Whether the viewer sees the Explorer's detailed parts: true only once it
 * is known that it does. Every way to a detailed part checks it.
 */
export function useExplorerAccess(): boolean {
  return useExplorer().access === 'full';
}

/**
 * An exchange's name for its deposit account ("TradeOgre"), shown where
 * the account has no name of its own, for a viewer who sees the detailed
 * parts; null for anyone else and for any other account.
 */
export function useExchangeName(
  address: string | null | undefined
): string | null {
  return useExplorerAccess() ? exchangeName(address) : null;
}
