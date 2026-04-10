/**
 * Refcounted fanout helper (unit-tested). Main process uses a simple `Set` per channel; for
 * `gcall` full-stream subscribe, preload refcounts `groupCall.onEvent` so group + DM can share
 * one window without one hook's unsubscribe dropping the other (see `preload.ts`).
 */

export interface GcallFanoutWebContents {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

export type CreateRefcountedFanoutOptions<T extends GcallFanoutWebContents> = {
  /** Invoked only when refcount transitions 0 → 1 (e.g. replay retained keys in main). */
  onFirstSubscribe?: (wc: T) => void;
};

export function createRefcountedFanout<T extends GcallFanoutWebContents>(
  options?: CreateRefcountedFanoutOptions<T>
) {
  const subscribers = new Set<T>();
  const refCounts = new Map<T, number>();

  function addSubscriber(wc: T): void {
    const next = (refCounts.get(wc) ?? 0) + 1;
    refCounts.set(wc, next);
    if (next === 1) {
      subscribers.add(wc);
      options?.onFirstSubscribe?.(wc);
    }
  }

  function removeSubscriber(wc: T): void {
    const prev = refCounts.get(wc) ?? 0;
    if (prev <= 0) return;
    if (prev === 1) {
      refCounts.delete(wc);
      subscribers.delete(wc);
    } else {
      refCounts.set(wc, prev - 1);
    }
  }

  function broadcast(channel: string, payload: unknown): void {
    for (const wc of subscribers) {
      if (wc.isDestroyed()) {
        subscribers.delete(wc);
        refCounts.delete(wc);
      } else {
        wc.send(channel, payload);
      }
    }
  }

  /** For tests: current refcount (0 if not subscribed). */
  function getRefCount(wc: T): number {
    return refCounts.get(wc) ?? 0;
  }

  function isSubscribed(wc: T): boolean {
    return subscribers.has(wc);
  }

  return {
    addSubscriber,
    removeSubscriber,
    broadcast,
    getRefCount,
    isSubscribed,
  };
}

export type GcallRendererSubscriptionFanout<T extends GcallFanoutWebContents> = ReturnType<
  typeof createRefcountedFanout<T>
>;
