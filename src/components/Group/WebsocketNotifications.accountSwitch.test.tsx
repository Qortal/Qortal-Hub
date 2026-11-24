/**
 * An account switch must not re-attribute a notification already in flight.
 *
 * The gap this locks down: a Q-Chat handler starts under account A, awaits its
 * notification settings, and resumes after a logout/login as B. Only then does
 * it reach `fireOsNotificationPayment`, which stamps the queue item with the
 * *current* session epoch — so the queue's ownership guards see a perfectly
 * ordinary item from B and present A's sender name, group name and message
 * preview. The queue could not tell the difference; only the handler knows which
 * account its work belongs to.
 *
 * These tests therefore drive the real handlers through the real event bus and
 * hold the settings lookup open until the account has changed. The unit-level
 * contract (a submission on behalf of a stale session is dropped) is covered
 * separately in `src/utils/notificationQueue.test.ts`.
 *
 * Everything heavy is mocked — the background module, the Qortal request layer,
 * the atoms and the i18n bundle — because none of it participates in the
 * decision. The handlers, the session module and the claims gate are real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { executeEvent } from '../../utils/events';
import { invalidateNotificationSession } from '../../utils/notificationSession';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type EffectiveNotificationSettings,
} from '../../utils/qChatNotificationSettings';

const {
  fireOsNotificationPayment,
  cancelQueuedNotification,
  handleNotificationClick,
  getGroupNotificationStore,
  getEffectiveNotificationSettings,
  getNotificationDeliveryMethod,
} = vi.hoisted(() => ({
  fireOsNotificationPayment: vi.fn(),
  cancelQueuedNotification: vi.fn(),
  handleNotificationClick: vi.fn(),
  getGroupNotificationStore: vi.fn(async () => ({ channels: {} })),
  getEffectiveNotificationSettings: vi.fn(),
  getNotificationDeliveryMethod: vi.fn(async () => 'native'),
}));

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node',
  getBaseApiReactSocket: () => 'ws://node',
}));

vi.mock('../../background/background', () => ({
  cancelQueuedNotification,
  fireOsNotificationPayment,
  handleNotificationClick,
}));

vi.mock('../../qortal/qortal-requests', () => ({
  getNotificationPermissionKey: (name: string) => `NOTIFICATION_${name}`,
  getPermission: vi.fn(async () => true),
}));

vi.mock('../../i18n/i18n', () => ({
  default: {
    language: 'en',
    t: (key: string) => key,
  },
  supportedLanguages: { en: { name: 'English', flag: '' } },
}));

/**
 * Partial mock: the settings readers are replaced with controllable ones, while
 * the pure predicates the handlers depend on stay real — mocking those would
 * make the test pass without exercising the actual gate.
 */
vi.mock('../../utils/qChatNotificationSettings', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getGroupNotificationStore,
    getEffectiveNotificationSettings,
    getNotificationDeliveryMethod,
  };
});

vi.mock('../../atoms/global', async () => {
  const { atom } = await import('jotai');
  // `atomWithReset` lives in `jotai/utils`, not the core entry point.
  const { atomWithReset } = await import('jotai/utils');
  return {
    customWebsocketSubscriptionsAtom: atomWithReset([]),
    dmFriendsByAddressAtom: atom({}),
    extStateAtom: atomWithReset('not-authenticated'),
    // The bell state is not what this test is about: only OS presentation is.
    filterSeenInAppKeysByRules: (keys: string[]) => keys,
    globalNotificationFormAtom: atomWithReset({
      notifyOnWelcomePosts: true,
      pushLevel: 'mentions',
      suppressEveryoneHere: false,
    }),
    notificationSeenInAppKeysAtom: atomWithReset([]),
    paymentNotificationsAtom: atomWithReset([]),
    reticulumChatEnabledAtom: atomWithReset(true),
    unreadWelcomeEventIdsAtom: atomWithReset({}),
  };
});

// Imported after the mocks so the component binds to them.
import { WebSocketNotifications } from './WebsocketNotifications';

const PUSH_ALL: EffectiveNotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  pushLevel: 'all',
};

const ACCOUNT_A = 'QAddressOfAccountA';
const ACCOUNT_B = 'QAddressOfAccountB';

const messageEvent = {
  channelId: 'general',
  eventId: 'evt-account-switch',
  groupId: 7,
  groupName: 'Devs',
  messageText: 'secret from the old account',
  senderName: 'Alice',
  timestamp: Date.now(),
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let every pending microtask (the handler's awaits) settle. */
async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function renderFor(address: string) {
  return render(
    <WebSocketNotifications myAddress={address} userName="alice" />
  );
}

describe('WebsocketNotifications across an account switch', () => {
  beforeEach(() => {
    fireOsNotificationPayment.mockClear();
    getEffectiveNotificationSettings.mockReset();
    getGroupNotificationStore.mockClear();
    getNotificationDeliveryMethod.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('presents the notification when the session does not change', async () => {
    // Positive control: without this, the regression test below could pass
    // simply because the handler never reached the point it is meant to guard.
    getEffectiveNotificationSettings.mockResolvedValue(PUSH_ALL);
    renderFor(ACCOUNT_A);

    await act(async () => {
      executeEvent('q-chat-message-notification', messageEvent);
      await flush();
    });

    expect(fireOsNotificationPayment).toHaveBeenCalledTimes(1);
    expect(fireOsNotificationPayment.mock.calls[0][1]).toBe(
      'Alice posted in Devs'
    );
  });

  it('drops the notification when the account changes during the lookup', async () => {
    // The lookup is held open across the switch, which is the real sequence:
    // the handler is suspended inside `getEffectiveNotificationSettings` when
    // logout bumps the session epoch.
    const gate = deferred<EffectiveNotificationSettings>();
    getEffectiveNotificationSettings.mockReturnValue(gate.promise);
    const view = renderFor(ACCOUNT_A);

    await act(async () => {
      executeEvent('q-chat-message-notification', messageEvent);
      await flush();
    });

    // Logout, then login as B. The old handler closure is still suspended.
    await act(async () => {
      invalidateNotificationSession();
      view.rerender(
        <WebSocketNotifications myAddress={ACCOUNT_B} userName="bob" />
      );
      await flush();
    });

    // The lookup settles only now, under B.
    await act(async () => {
      gate.resolve(PUSH_ALL);
      await flush();
    });

    // A's sender, group name and preview must not surface under B.
    expect(fireOsNotificationPayment).not.toHaveBeenCalled();
  });

  it('drops the mention notification for the same reason', async () => {
    // The mention handler awaits three lookups (group store, settings, channel
    // metadata), so it has more places to resume in the wrong account.
    const gate = deferred<EffectiveNotificationSettings>();
    getEffectiveNotificationSettings.mockReturnValue(gate.promise);
    const view = renderFor(ACCOUNT_A);

    await act(async () => {
      executeEvent('q-chat-mention-notification', {
        ...messageEvent,
        isEveryoneOrHere: false,
        mentionCount: 1,
      });
      await flush();
    });

    await act(async () => {
      invalidateNotificationSession();
      view.rerender(
        <WebSocketNotifications myAddress={ACCOUNT_B} userName="bob" />
      );
      await flush();
    });

    await act(async () => {
      gate.resolve(PUSH_ALL);
      await flush();
    });

    expect(fireOsNotificationPayment).not.toHaveBeenCalled();
  });
});
