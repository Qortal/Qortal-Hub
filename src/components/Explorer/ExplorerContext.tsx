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
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ActivitySettings } from '../../lib/explorer/activitySettings';
import type { ExplorerCache } from '../../lib/explorer/cache';
import type { ChainPreset } from '../../lib/explorer/chainTx';
import type { ReadSpec } from '../../lib/explorer/reads';
import type { AccessState } from './useExplorerAccess';

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
  /**
   * Whether it sees the detailed parts (the level 5+ rule,
   * lib/explorer/access.ts); read it through useExplorerAccess().
   */
  access: AccessState;
  /**
   * Open an account by its address or by one of its names (a transaction
   * signature opens that transaction).
   */
  openAccount: (who: string, options?: OpenAccountOptions) => void;
  /** Open one transaction, as a step from what is on screen. */
  openTransaction: (signature: string) => void;
  /** Open a name's whole history, as a step from what is on screen. */
  openName: (name: string) => void;
  /** Open Transactions on Qortal (the whole chain), as a step from what is on screen. */
  openChain: (preset?: ChainPreset) => void;
  /** Read what is about `scope` (an address, a signature) again from the node. */
  refresh: (scope: string) => void;
  /** Close the Explorer window. */
  close: () => void;
  /**
   * The Activity row of the settings (lib/explorer/activitySettings.ts):
   * how much the Overview reads first, and the milestones it leaves out.
   */
  activity: ActivitySettings;
  /** Open the Activity settings (for a viewer who sees the detailed parts). */
  openActivitySettings: () => void;
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
      // The state as it already is stays the same object: no render for nothing.
      if (!current) {
        setState((shown) =>
          shown.key === null && shown.status === 'idle'
            ? shown
            : { key: null, status: 'idle' }
        );
        return;
      }
      const kept = force ? undefined : cache.peek<T>(current.key);
      if (kept !== undefined) {
        setState((shown) =>
          shown.key === current.key &&
          shown.status === 'ready' &&
          shown.data === kept
            ? shown
            : { key: current.key, data: kept, status: 'ready' }
        );
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

/**
 * What the window's cache keeps for `key`, without ever reading it: for a
 * part that shows what another part read (the Overview's Direct links and
 * the Connections tab's Q-Asset trades). A new answer for it shows here too.
 */
export function useExplorerKept<T>(key: string | null): T | undefined {
  // The context changes on Refresh too, so this renders again then.
  const { cache } = useExplorer();
  const [, setSeen] = useState(0);
  useEffect(() => {
    if (key === null) return undefined;
    return cache.subscribe(key, () => setSeen((n) => n + 1));
  }, [cache, key]);
  return key === null ? undefined : cache.peek<T>(key);
}

// ---- Several reads at once ---------------------------------------------------------------

export interface ReadsState<T> {
  /** The answers read so far, by key. */
  data: ReadonlyMap<string, T>;
  /** The keys whose read failed: never an answer, each with Retry. */
  failed: readonly string[];
  /** Some are still being read. */
  loading: boolean;
  /** Read the failed ones again. */
  retry: () => void;
}

interface ReadsShown<T> {
  joined: string;
  data: Map<string, T>;
  failed: Set<string>;
  /** Answers kept from before while their keys are read again (`keep`). */
  stale: Set<string>;
}

/** How many keys `joined` holds. */
const keyCount = (joined: string) => (joined ? joined.split('\n').length : 0);

/**
 * Read several specs through the window's cache (null or none reads
 * nothing), at most `concurrency` at a time: the level-move recipients,
 * the levels and the names a list needs. Each answer shows as it comes,
 * one that is kept shows at once, and one read by another part (its
 * Retry) shows here too. Answers that come back after the keys changed,
 * the window refreshed, or the part went are dropped; a failure is kept
 * apart, never an answer.
 *
 * With `keep`, a Refresh or Retry of the same keys keeps each answer shown
 * before on screen while it is read again, and when that read fails (the
 * key is then in `failed` too, with Retry): what was read is never wiped
 * by a read that couldn't be made again.
 */
export function useExplorerReads<T>(
  specs: readonly ReadSpec<T>[] | null,
  {
    concurrency = Number.POSITIVE_INFINITY,
    keep = false,
  }: { concurrency?: number; keep?: boolean } = {}
): ReadsState<T> {
  const { cache, version } = useExplorer();
  const joined = (specs ?? []).map((spec) => spec.key).join('\n');
  const specsRef = useRef(specs);
  specsRef.current = specs;
  const run = useRef(0);
  const [shown, setShown] = useState<ReadsShown<T>>({
    joined: '',
    data: new Map(),
    failed: new Set(),
    stale: new Set(),
  });

  const start = useCallback(
    (forced: ReadonlySet<string>) => {
      const list = specsRef.current ?? [];
      const id = ++run.current;
      const keysOf = list.map((spec) => spec.key).join('\n');
      const data = new Map<string, T>();
      const todo: ReadSpec<T>[] = [];
      for (const spec of list) {
        const kept = forced.has(spec.key) ? undefined : cache.peek<T>(spec.key);
        if (kept !== undefined) data.set(spec.key, kept);
        else todo.push(spec);
      }
      setShown((was) => {
        const shownData = new Map(data);
        const stale = new Set<string>();
        // The same keys read again: what was shown stays until its new answer.
        if (keep && was.joined === keysOf)
          for (const spec of todo)
            if (was.data.has(spec.key)) {
              shownData.set(spec.key, was.data.get(spec.key) as T);
              stale.add(spec.key);
            }
        return { joined: keysOf, data: shownData, failed: new Set(), stale };
      });
      let next = 0;
      const settle = (patch: (was: ReadsShown<T>) => ReadsShown<T>) =>
        setShown((was) => (was.joined === keysOf ? patch(was) : was));
      const lane = async () => {
        while (next < todo.length) {
          const spec = todo[next++];
          try {
            const value = await cache.read(spec.key, spec.load, {
              ttlMs: spec.ttlMs,
              force: forced.has(spec.key),
            });
            if (run.current !== id) return;
            settle((was) => {
              if (was.data.get(spec.key) === value && !was.stale.has(spec.key))
                return was;
              const stale = new Set(was.stale);
              stale.delete(spec.key);
              return {
                ...was,
                data: new Map(was.data).set(spec.key, value),
                stale,
              };
            });
          } catch {
            if (run.current !== id) return;
            // An answer from before stays (with the failure said); a new one from another part wins.
            settle((was) =>
              was.data.has(spec.key) && !was.stale.has(spec.key)
                ? was
                : { ...was, failed: new Set(was.failed).add(spec.key) }
            );
          }
        }
      };
      const lanes = Math.min(Math.max(1, concurrency), todo.length);
      for (let lane_ = 0; lane_ < lanes; lane_++) void lane();
    },
    [cache, concurrency, keep]
  );

  useEffect(() => {
    start(new Set());
  }, [joined, version, start]);

  // A new answer for one of the keys, read by another part: show it here too.
  useEffect(() => {
    const keys = joined ? joined.split('\n') : [];
    const stops = keys.map((key) =>
      cache.subscribe(key, () => {
        const kept = cache.peek<T>(key);
        if (kept === undefined) return;
        setShown((was) => {
          if (was.joined !== joined || was.data.get(key) === kept) return was;
          const failed = new Set(was.failed);
          failed.delete(key);
          const stale = new Set(was.stale);
          stale.delete(key);
          return {
            ...was,
            data: new Map(was.data).set(key, kept),
            failed,
            stale,
          };
        });
      })
    );
    return () => stops.forEach((stop) => stop());
  }, [cache, joined]);

  // Anything still on its way when the part goes is dropped.
  useEffect(
    () => () => {
      run.current += 1;
    },
    []
  );

  const failedJoined =
    shown.joined === joined ? [...shown.failed].join('\n') : '';
  // The same list while the same keys failed: parts memoized on it stay put.
  const failedKeys = useMemo(
    () => (failedJoined ? failedJoined.split('\n') : []),
    [failedJoined]
  );
  const retry = useCallback(() => {
    if (failedJoined) start(new Set(failedJoined.split('\n')));
  }, [start, failedJoined]);

  if (shown.joined === joined) {
    // An answer kept from before, read again, isn't settled until its new answer or failure.
    let settled = shown.failed.size;
    for (const key of shown.data.keys())
      if (!shown.stale.has(key) && !shown.failed.has(key)) settled += 1;
    return {
      data: shown.data,
      failed: failedKeys,
      loading: settled < keyCount(joined),
      retry,
    };
  }
  // The keys changed and their reads haven't started yet: what the cache has.
  const data = new Map<string, T>();
  for (const spec of specs ?? []) {
    const kept = cache.peek<T>(spec.key);
    if (kept !== undefined) data.set(spec.key, kept);
  }
  return {
    data,
    failed: failedKeys,
    loading: data.size < (specs ?? []).length,
    retry,
  };
}

// ---- What a step of the history keeps ---------------------------------------------------

export type StepState = Readonly<Record<string, unknown>>;

interface StepContextValue {
  /** The step on screen: what it keeps belongs to it, wherever it is in the history. */
  stepId: number;
  state: StepState;
  setState: (stepId: number, key: string, value: unknown) => void;
}

export const ExplorerStepContext = createContext<StepContextValue | null>(null);

/**
 * A value the history step on screen keeps (the tab it shows, a filter):
 * changing it changes this step in place, never adds one, and Back and
 * Forward show each step as it was left.
 */
export function useStepState<T>(
  key: string,
  initial: T
): [T, (value: T) => void] {
  const step = useContext(ExplorerStepContext);
  if (!step) throw new Error('Explorer parts belong inside ExplorerWindow');
  const { stepId, state, setState } = step;
  const value = key in state ? (state[key] as T) : initial;
  const set = useCallback(
    (next: T) => setState(stepId, key, next),
    [setState, stepId, key]
  );
  return [value, set];
}

/**
 * True once `node` is near the screen (within `margin`), and from then on:
 * for reads a long list needs only for the rows someone looks at. Where the
 * browser can't tell, it is near at once.
 */
export function useNearScreen(node: Element | null, margin = '300px'): boolean {
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );
  useEffect(() => {
    if (near || !node || typeof IntersectionObserver === 'undefined')
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: margin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, node, margin]);
  return near;
}
