/**
 * Serialised OS-notification queue with session ownership.
 *
 * Notifications drain one at a time, several seconds apart, so a queued item can
 * outlive the account that produced it. Without an ownership check the closure
 * runs later against whatever account is authenticated by then: it reads that
 * account's `disable-push-notifications` and posts the *previous* account's
 * sender name and message body. Logging out and back in inside the drain window
 * was enough to reproduce it.
 *
 * Every item is stamped with the session epoch at submission. Logout calls
 * {@link NotificationQueue.invalidateSession}, which bumps the epoch and drops
 * pending items. Items from an older epoch are skipped before they start, and a
 * run body can re-check the epoch after an await — clearing the array alone
 * cannot cancel a closure that is already executing.
 */

export interface NotificationQueueOptions {
  /** Gap between items, in milliseconds. */
  intervalMs?: number;
  /** Timer factory, injectable so tests do not wait in real time. */
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/** True while the session that submitted this item is still the active one. */
export type IsSessionCurrent = () => boolean;

export interface NotificationQueue {
  /**
   * Queue a run body. It is skipped entirely when the session that submitted it
   * has ended by the time the item is reached.
   *
   * The body receives an ownership check so it can re-run it after an await,
   * which is where the settings lookup happens.
   */
  enqueue: (run: (isSessionCurrent: IsSessionCurrent) => Promise<void>) => void;
  /** Ends the current session: pending items are dropped and skipped. */
  invalidateSession: () => void;
  /** Number of items still waiting. Exposed for tests and diagnostics. */
  pendingCount: () => number;
  /** Resolves when the drain loop has no more work. */
  whenIdle: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 5_000;

export function createNotificationQueue(
  options: NotificationQueueOptions = {}
): NotificationQueue {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);

  interface QueueItem {
    epoch: number;
    run: (isSessionCurrent: IsSessionCurrent) => Promise<void>;
  }

  let epoch = 0;
  let items: QueueItem[] = [];
  let processing = false;
  let idleResolvers: Array<() => void> = [];

  const resolveIdle = () => {
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  };

  const drain = async () => {
    if (processing) return;
    processing = true;
    try {
      while (items.length > 0) {
        const item = items.shift()!;
        try {
          await item.run(() => item.epoch === epoch);
        } catch (error) {
          console.error(error);
        }
        if (items.length > 0) {
          await new Promise<void>((resolve) => {
            setTimer(resolve, intervalMs);
          });
        }
      }
    } finally {
      processing = false;
      resolveIdle();
    }
  };

  return {
    enqueue(run) {
      items.push({ epoch, run });
      void drain();
    },
    invalidateSession() {
      epoch += 1;
      items = [];
      // A run already past the shift cannot be recalled, so it re-checks the
      // epoch through the callback it was given.
    },
    pendingCount() {
      return items.length;
    },
    whenIdle() {
      if (!processing && items.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleResolvers.push(resolve);
      });
    },
  };
}
