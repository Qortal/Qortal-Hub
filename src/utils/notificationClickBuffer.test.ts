import { afterEach, describe, expect, it } from 'vitest';
import {
  drainPendingNotificationNav,
  setNotificationNavHostMounted,
  setPendingNotificationNav,
} from './notificationClickBuffer';

const nav = (detail: Record<string, unknown> = {}) => ({
  eventName: 'openGroupMessage',
  detail,
});

describe('notificationClickBuffer', () => {
  afterEach(() => {
    // The module state is shared across tests, so leave it as a fresh page.
    setNotificationNavHostMounted(false);
    drainPendingNotificationNav();
  });

  it('buffers a click that arrives before the consumer mounts', () => {
    setPendingNotificationNav(nav({ from: '7' }));

    expect(drainPendingNotificationNav()).toEqual({
      eventName: 'openGroupMessage',
      detail: { from: '7' },
    });
  });

  it('clears itself on drain so a replay happens once', () => {
    setPendingNotificationNav(nav());

    expect(drainPendingNotificationNav()).not.toBeNull();
    expect(drainPendingNotificationNav()).toBeNull();
  });

  it('does not buffer once the consumer is mounted', () => {
    // The click handlers dispatch directly while mounted; buffering as well
    // would leave a copy that replays on the next mount. This is the fix for a
    // bell click being handled twice when Group was already open.
    setNotificationNavHostMounted(true);
    setPendingNotificationNav(nav({ from: '9' }));

    expect(drainPendingNotificationNav()).toBeNull();
  });

  it('buffers again after the consumer unmounts', () => {
    setNotificationNavHostMounted(true);
    setPendingNotificationNav(nav({ from: 'ignored' }));
    expect(drainPendingNotificationNav()).toBeNull();

    setNotificationNavHostMounted(false);
    setPendingNotificationNav(nav({ from: '10' }));

    expect(drainPendingNotificationNav()).toEqual({
      eventName: 'openGroupMessage',
      detail: { from: '10' },
    });
  });
});
