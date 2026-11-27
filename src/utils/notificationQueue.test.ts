import { describe, expect, it, vi } from 'vitest';
import { createNotificationQueue } from './notificationQueue';

/**
 * Drives the queue's interval so tests never wait in real time. Each scheduled
 * tick is parked until the test releases it.
 */
function makeClock() {
  const pending: Array<() => void> = [];
  const setTimer = (fn: () => void, _ms: number) => {
    pending.push(fn);
    return pending.length;
  };
  const tick = () => {
    const next = pending.shift();
    next?.();
  };
  return { setTimer, tick, pendingCount: () => pending.length };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('notificationQueue', () => {
  it('runs queued items in order', async () => {
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });
    const seen: string[] = [];

    queue.enqueue(async () => {
      seen.push('a');
    });
    queue.enqueue(async () => {
      seen.push('b');
    });

    await flush();
    // The second item waits for the interval; release it.
    expect(seen).toEqual(['a']);
    clock.tick();
    await flush();
    expect(seen).toEqual(['a', 'b']);
  });

  it('drops items queued by a session that ended before they were reached', async () => {
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });
    const seen: string[] = [];

    queue.enqueue(async () => {
      seen.push('first-account');
    });
    queue.enqueue(async () => {
      seen.push('also-first-account');
    });

    await flush();
    expect(seen).toEqual(['first-account']);

    // Logout while the second item is still parked behind the interval.
    queue.invalidateSession();
    clock.tick();
    await flush();

    // The second item belonged to the account that logged out. Presenting it
    // now would show the previous account's sender name and body, decided by
    // the new account's settings.
    expect(seen).toEqual(['first-account']);
    expect(queue.pendingCount()).toBe(0);
  });

  it('lets a running item notice the session ended while it was awaiting', async () => {
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: makeClock().setTimer,
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const presented: string[] = [];

    queue.enqueue(async (isSessionCurrent) => {
      await gate;
      // The settings lookup happens here in production. Clearing the array
      // cannot cancel a closure that is already executing, so the body has to
      // re-check ownership itself.
      if (!isSessionCurrent()) return;
      presented.push('should-not-appear');
    });

    await flush();
    queue.invalidateSession();
    release();
    await queue.whenIdle();

    expect(presented).toEqual([]);
  });

  it('keeps the item queued under a new session', async () => {
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: makeClock().setTimer,
    });
    const seen: string[] = [];

    queue.invalidateSession();
    queue.enqueue(async (isSessionCurrent) => {
      if (isSessionCurrent()) seen.push('second-account');
    });

    await flush();
    expect(seen).toEqual(['second-account']);
  });

  it('continues draining after an item throws', async () => {
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const seen: string[] = [];

    queue.enqueue(async () => {
      throw new Error('bad payload');
    });
    queue.enqueue(async () => {
      seen.push('after-failure');
    });

    await flush();
    clock.tick();
    await flush();

    expect(seen).toEqual(['after-failure']);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('lets work outside the queue notice the session ended', async () => {
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: makeClock().setTimer,
    });

    // The periodic announcement and thread checks are not drained from this
    // queue, but they await settings before presenting just like a queued item.
    const session = queue.captureSession();
    expect(queue.isSessionCurrent(session)).toBe(true);

    queue.invalidateSession();

    expect(queue.isSessionCurrent(session)).toBe(false);
  });

  it('keeps a token captured after the new session valid', async () => {
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: makeClock().setTimer,
    });
    const stale = queue.captureSession();
    queue.invalidateSession();
    const fresh = queue.captureSession();

    expect(queue.isSessionCurrent(stale)).toBe(false);
    expect(queue.isSessionCurrent(fresh)).toBe(true);
  });

  it('replaces a waiting item with the same key instead of stacking it', async () => {
    // The same DM can reach two handlers, which enqueues it twice. The drain
    // presents items seconds apart, so both copies would survive it and the user
    // would see two desktop notifications for one message.
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });
    const seen: string[] = [];

    // The first item is already draining and cannot be replaced.
    queue.enqueue(async () => {
      seen.push('first');
    }, 'dm-1');
    queue.enqueue(async () => {
      seen.push('duplicate');
    }, 'dm-1');
    queue.enqueue(async () => {
      seen.push('replacement');
    }, 'dm-1');

    await flush();
    expect(seen).toEqual(['first']);
    clock.tick();
    await flush();
    // Only one of the two waiting copies ran, and it is the newer one.
    expect(seen).toEqual(['first', 'replacement']);
  });

  it('cancels a waiting item by key', async () => {
    // A direct message deleted while its notification waits must not pop up
    // afterwards.
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });
    const seen: string[] = [];

    queue.enqueue(async () => {
      seen.push('delivered');
    });
    queue.enqueue(async () => {
      seen.push('deleted-message');
    }, 'dm-deleted');

    await flush();
    queue.cancel('dm-deleted');
    clock.tick();
    await flush();

    expect(seen).toEqual(['delivered']);
  });

  it('drops an item submitted on behalf of a session that already ended', async () => {
    // The handler captured `stale` at the top of its work, then awaited its
    // settings. Logging out and back in inside that window leaves it resuming
    // under the new account, where an item stamped with the *current* epoch
    // would look like the new account's own notification — showing the previous
    // account's sender name, group name and message preview.
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: makeClock().setTimer,
    });
    const presented: string[] = [];

    const stale = queue.captureSession();
    queue.invalidateSession();
    const fresh = queue.captureSession();

    queue.enqueue(
      async () => {
        presented.push('old-account');
      },
      'evt-1',
      stale
    );

    // The new account's own notification for the same event still presents.
    queue.enqueue(
      async () => {
        presented.push('new-account');
      },
      'evt-1',
      fresh
    );

    await flush();
    expect(presented).toEqual(['new-account']);
    expect(queue.isSessionCurrent(stale)).toBe(false);
  });

  it('does not let a stale submission evict the current account item', async () => {
    // Ordering matters: filtering by key before the session check would let a
    // stale item share a key with the live one, evict it, and then drop itself
    // — so neither notification would ever be presented.
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });
    const presented: string[] = [];

    // Hold the drain open so both keyed items sit in the waiting list, which is
    // where key replacement happens.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.enqueue(async () => {
      await gate;
      presented.push('filler');
    });
    await flush();

    const stale = queue.captureSession();
    queue.invalidateSession();

    queue.enqueue(async () => {
      presented.push('new-account');
    }, 'evt-shared');
    queue.enqueue(
      async () => {
        presented.push('old-account');
      },
      'evt-shared',
      stale
    );

    expect(queue.pendingCount()).toBe(1);

    release();
    await flush();
    clock.tick();
    await flush();

    expect(presented).toEqual(['filler', 'new-account']);
  });

  it('treats a missing session argument as the current session', async () => {
    // Callers that do not await first (payments, app resources) pass no token
    // and must keep working unchanged.
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: makeClock().setTimer,
    });
    const seen: string[] = [];

    queue.enqueue(async () => {
      seen.push('immediate');
    });

    await flush();
    expect(seen).toEqual(['immediate']);
  });

  it('reports idle only once the queue is empty', async () => {
    const clock = makeClock();
    const queue = createNotificationQueue({
      intervalMs: 1,
      setTimer: clock.setTimer,
    });

    queue.enqueue(async () => {});
    queue.enqueue(async () => {});

    let idle = false;
    const done = queue.whenIdle().then(() => {
      idle = true;
    });

    await flush();
    expect(idle).toBe(false);

    clock.tick();
    await done;
    expect(idle).toBe(true);
  });
});
