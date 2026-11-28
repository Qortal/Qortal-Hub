/**
 * What every part of one Explorer window shares: its cache, the account
 * that is looking (Hub's signed-in account), how to open another account
 * or the start page, and Refresh. Only the window provides it: a part used
 * outside the window throws instead of quietly doing nothing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ExplorerCache } from '../../lib/explorer/cache';
import type { ReadSpec } from '../../lib/explorer/reads';

export interface OpenAccountOptions {
  /**
   * Opened from inside the Explorer (a link, a crumb): one more step on the
   * trail. Otherwise (a search, a way in from elsewhere in Hub) the trail
   * starts again with it.
   */
  fromExplorer?: boolean;
}

export interface ExplorerContextValue {
  cache: ExplorerCache;
  /** Changes on Refresh: every read checks the cache again. */
  version: number;
  /** The signed-in Hub account's address, or null. */
  viewer: string | null;
  /** Open an account by its address or by one of its names. */
  openAccount: (who: string, options?: OpenAccountOptions) => void;
  /** Read `address` again from the node. */
  refresh: (address: string) => void;
  /** Close the Explorer window. */
  close: () => void;
}

export const ExplorerContext = createContext<ExplorerContextValue | null>(null);

export function useExplorer(): ExplorerContextValue {
  const value = useContext(ExplorerContext);
  if (!value) throw new Error('Explorer parts belong inside ExplorerWindow');
  return value;
}

export interface ReadState<T> {
  /** The answer, once read. */
  data: T | undefined;
  error: unknown;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Read again from the node. */
  retry: () => void;
}

interface Settled<T> {
  key: string | null;
  data?: T;
  error?: unknown;
  status: ReadState<T>['status'];
}

/**
 * Read `spec` through the window's cache (null reads nothing). An answer
 * is shown only while it is still the one asked for: one that comes back
 * after the key changed, the window refreshed, or the part unmounted is
 * dropped. A failure is a state of its own, with Retry; it never becomes
 * an empty answer.
 */
export function useExplorerRead<T>(spec: ReadSpec<T> | null): ReadState<T> {
  const { cache, version } = useExplorer();
  const key = spec?.key ?? null;
  const specRef = useRef(spec);
  specRef.current = spec;
  const run = useRef(0);
  const [state, setState] = useState<Settled<T>>({ key: null, status: 'idle' });

  const read = useCallback(
    (force: boolean) => {
      const current = specRef.current;
      const id = ++run.current;
      if (!current) {
        setState({ key: null, status: 'idle' });
        return;
      }
      const kept = force ? undefined : cache.peek<T>(current.key);
      if (kept !== undefined) {
        setState({ key: current.key, data: kept, status: 'ready' });
        return;
      }
      // Read again for the same key (Refresh, Retry): what is shown stays until the answer.
      setState((shown) => ({
        key: current.key,
        data: shown.key === current.key ? shown.data : undefined,
        status: 'loading',
      }));
      cache
        .read(current.key, current.load, { ttlMs: current.ttlMs, force })
        .then(
          (data) => {
            if (run.current === id)
              setState({ key: current.key, data, status: 'ready' });
          },
          (error) => {
            if (run.current === id)
              setState({ key: current.key, error, status: 'error' });
          }
        );
    },
    [cache]
  );

  useEffect(() => {
    read(false);
  }, [key, version, read]);

  // A new answer for this key, read by another part (its Retry): show it here too.
  useEffect(() => {
    if (key === null) return undefined;
    return cache.subscribe(key, () => {
      const kept = cache.peek<T>(key);
      if (kept === undefined) return;
      run.current += 1;
      setState({ key, data: kept, status: 'ready' });
    });
  }, [cache, key]);

  // Anything still on its way when the part goes is dropped.
  useEffect(
    () => () => {
      run.current += 1;
    },
    []
  );

  const retry = useCallback(() => read(true), [read]);

  if (state.key === key)
    return {
      data: state.data,
      error: state.error,
      status: state.status,
      retry,
    };
  // The key changed and its read hasn't started yet: show what the cache has.
  const kept = key === null ? undefined : cache.peek<T>(key);
  return {
    data: kept,
    error: undefined,
    status: key === null ? 'idle' : kept !== undefined ? 'ready' : 'loading',
    retry,
  };
}
