/**
 * What one Explorer window has read, so moving between accounts and back
 * doesn't ask the node again. The window makes its own cache and drops it
 * when it closes or the Hub account changes, so nothing here outlives the
 * window that read it.
 *
 * - A read already on its way is shared by everyone who asks for it.
 * - An answer is kept for its `ttlMs`; a failed read is never kept, so the
 *   next ask (and Retry) reads again.
 * - `force` reads again even when an answer is kept; when two reads of one
 *   key overlap, the one started last is the one kept.
 * - After `clear` or `forget`, a read started before it isn't kept.
 * - Every part showing a key hears of a new answer for it (`subscribe`),
 *   so Retry pressed in one place fixes the others too.
 */

export interface ExplorerReadOptions {
  /** How long an answer is kept. */
  ttlMs?: number;
  /** Read again, even when an answer is kept. */
  force?: boolean;
}

export interface ExplorerCache {
  read<T>(
    key: string,
    load: () => Promise<T>,
    options?: ExplorerReadOptions
  ): Promise<T>;
  /** The kept answer for `key`, if it is still fresh. */
  peek<T>(key: string): T | undefined;
  /** Be told when a new answer for `key` is kept; returns the way to stop. */
  subscribe(key: string, listener: () => void): () => void;
  /** Drop the answers whose key `matches` (Refresh on one account). */
  forget(matches: (key: string) => boolean): void;
  /** Drop everything. */
  clear(): void;
}

const DEFAULT_TTL_MS = 5 * 60_000;

interface Kept {
  value: unknown;
  at: number;
  ttlMs: number;
}

export function createExplorerCache(
  now: () => number = Date.now
): ExplorerCache {
  const kept = new Map<string, Kept>();
  const pending = new Map<string, Promise<unknown>>();
  /** The newest read of each key; an older one finishing later isn't kept. */
  const latest = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  let reads = 0;

  const fresh = (key: string): Kept | undefined => {
    const entry = kept.get(key);
    if (!entry) return undefined;
    if (now() - entry.at < entry.ttlMs) return entry;
    kept.delete(key);
    return undefined;
  };

  return {
    read<T>(
      key: string,
      load: () => Promise<T>,
      { ttlMs = DEFAULT_TTL_MS, force = false }: ExplorerReadOptions = {}
    ): Promise<T> {
      if (!force) {
        const entry = fresh(key);
        if (entry) return Promise.resolve(entry.value as T);
        const running = pending.get(key);
        if (running) return running as Promise<T>;
      }
      const id = ++reads;
      latest.set(key, id);
      const settle = () => {
        if (latest.get(key) !== id) return false;
        latest.delete(key);
        pending.delete(key);
        return true;
      };
      const promise = Promise.resolve()
        .then(load)
        .then(
          (value) => {
            if (settle()) {
              kept.set(key, { value, at: now(), ttlMs });
              for (const listener of [...(listeners.get(key) ?? [])])
                listener();
            }
            return value;
          },
          (error) => {
            settle();
            throw error;
          }
        );
      pending.set(key, promise);
      return promise;
    },

    peek<T>(key: string): T | undefined {
      return fresh(key)?.value as T | undefined;
    },

    subscribe(key: string, listener: () => void) {
      const set = listeners.get(key) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(key, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },

    forget(matches: (key: string) => boolean) {
      for (const key of [...kept.keys()]) if (matches(key)) kept.delete(key);
      for (const key of [...pending.keys()]) {
        if (!matches(key)) continue;
        pending.delete(key);
        latest.delete(key);
      }
    },

    clear() {
      kept.clear();
      pending.clear();
      latest.clear();
    },
  };
}
