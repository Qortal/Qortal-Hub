import { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// As in openNewTab.test.ts, except that the event bus and i18next are real
// here: the join window listens on the bus and draws its text with i18next.

vi.mock('../qortal-requests', async () =>
  (await import('./common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () =>
  (await import('./common')).backgroundFactory()
);
vi.mock('../../encryption/encryption', async () =>
  (await import('./common')).encryptionFactory()
);
vi.mock('../../components/Chat/AdminSpaceInner', async () =>
  (await import('./common')).adminSpaceFactory()
);
vi.mock('../../components/Group/Group', async () =>
  (await import('./common')).groupFactory()
);
vi.mock('../../qdn/encryption/group-encryption', async () =>
  (await import('./common')).groupEncryptionFactory()
);
vi.mock('../../qdn/publish/publish', async () =>
  (await import('./common')).publishFactory()
);
vi.mock('../../transactions/TradeBotCreateRequest', async () =>
  (await import('./common')).tradeBotCreateFactory()
);
vi.mock('../../transactions/TradeBotDeleteRequest', async () =>
  (await import('./common')).tradeBotDeleteFactory()
);
vi.mock('../../transactions/signTradeBotTransaction', async () =>
  (await import('./common')).signTradeBotFactory()
);
vi.mock('../../transactions/transactions', async () =>
  (await import('./common')).transactionsFactory()
);
vi.mock('../../utils/fileReading/index', async () =>
  (await import('./common')).fileReadingFactory()
);
vi.mock('../../utils/memeTypes', async () =>
  (await import('./common')).mimeTypesFactory()
);
vi.mock('../../utils/queue/queue', async () =>
  (await import('./common')).queueFactory()
);
vi.mock('../../utils/utils', async () =>
  (await import('./common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('../../i18n/i18n', async () =>
  (await import('./common')).i18nFactory()
);
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../encryption/Base58', async () =>
  (await import('./common')).base58Factory()
);
vi.mock('../../encryption/ed2curve', async () =>
  (await import('./common')).ed2curveFactory()
);
vi.mock('../../encryption/nacl-fast', async () =>
  (await import('./common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('./common')).asmcryptoFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { memberGroupsAtom } from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import { JoinGroup } from '../../components/GlobalActions/JoinGroup';
import { lightTheme } from '../../styles/theme-light';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { openQortalLink } from '../../utils/qortalLink/openQortalLink';
import { openNewTab } from '../get';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const MEMBER_OF = 5;
const EVENT_ID = '06a3daa0-938c-40df-a7fe-a3cec373d992';
const GROUPS: Record<string, { groupName: string; isOpen: boolean }> = {
  '5': { groupName: 'Five', isOpen: true },
  '7': { groupName: 'Seven', isOpen: true },
  '9': { groupName: 'Nine', isOpen: true },
};

const joinLink = (groupId: number) =>
  `qortal://use-group/action-join/groupid-${groupId}`;

/** OPEN_NEW_TAB as a Q-App or a Home widget sends it. */
const appOpens = async (qortalLink: string) => {
  await act(async () => {
    await openNewTab({ qortalLink }, true);
  });
};

/** A click on a link in chat, the top bar or anywhere else in Hub. */
const userOpens = (link: string) =>
  act(async () => {
    await openQortalLink(link);
  });

const groupsFetched = () =>
  vi
    .mocked(global.fetch)
    .mock.calls.map(([url]) => String(url).replace('http://node/groups/', ''));

const renderHub = () => {
  const store = createStore();
  store.set(memberGroupsAtom, [{ groupId: MEMBER_OF }] as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <I18nextProvider i18n={i18n}>
          <JoinGroup />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
  return store;
};

describe("OPEN_NEW_TAB: a group's link from a Q-App or a widget", () => {
  let groupsOpened: unknown[] = [];
  const onOpenGroup = (event: Event) =>
    groupsOpened.push((event as CustomEvent).detail);
  const getCalendarEvent = vi.fn(async () => null);

  beforeEach(() => {
    groupsOpened = [];
    subscribeToEvent('openGroupMessage', onOpenGroup);
    vi.stubGlobal('reticulumChat', { getCalendarEvent });
    global.fetch = vi.fn(async (url: string) => {
      const groupId = String(url).split('/').pop();
      return new Response(
        JSON.stringify({ groupId: Number(groupId), ...GROUPS[groupId] })
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    unsubscribeFromEvent('openGroupMessage', onOpenGroup);
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a member the group's join window, and opens no chat", async () => {
    renderHub();

    await appOpens(joinLink(MEMBER_OF));

    expect(groupsOpened).toEqual([]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText(/Five/)).toBeInTheDocument();
    // The window says they are in the group, as it always has.
    expect(screen.getByText(/already_in_group/)).toBeInTheDocument();
    expect(groupsFetched()).toEqual(['5']);
  });

  it("opens a calendar event's group in its join window only", async () => {
    renderHub();

    await appOpens(
      `qortal://use-group/action-calendar/groupid-${MEMBER_OF}/eventid-${EVENT_ID}`
    );

    expect(groupsOpened).toEqual([]);
    expect(getCalendarEvent).not.toHaveBeenCalled();
    expect(await screen.findByText(/Five/)).toBeInTheDocument();
    expect(groupsFetched()).toEqual(['5']);
  });

  it('leaves a join window that is open as it is, and says it opened nothing', async () => {
    renderHub();
    await userOpens(joinLink(7));
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();

    for (const link of [
      joinLink(9),
      joinLink(MEMBER_OF),
      `qortal://use-group/action-calendar/groupid-9/eventid-${EVENT_ID}`,
    ]) {
      await expect(appOpens(link)).rejects.toThrow('invalid_qortal_link');
    }

    expect(screen.getByText(/Seven/)).toBeInTheDocument();
    expect(screen.queryByText(/Nine|Five/)).not.toBeInTheDocument();
    expect(groupsFetched()).toEqual(['7']);
    expect(groupsOpened).toEqual([]);
  });

  it('opens the join window again once the one open is closed', async () => {
    renderHub();
    await appOpens(joinLink(7));
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
    await expect(appOpens(joinLink(9))).rejects.toThrow('invalid_qortal_link');

    await act(async () => {
      screen.getByText('action.close').click();
    });
    await appOpens(joinLink(9));

    expect(await screen.findByText(/Nine/)).toBeInTheDocument();
    expect(groupsFetched()).toEqual(['7', '9']);
  });

  it('opens nothing while Hub is locked, and says so', async () => {
    const store = renderHub();
    act(() => store.set(appLockedAtom, true));

    for (const link of [
      joinLink(7),
      joinLink(MEMBER_OF),
      `qortal://use-group/action-calendar/groupid-9/eventid-${EVENT_ID}`,
    ]) {
      await expect(appOpens(link)).rejects.toThrow('invalid_qortal_link');
    }
    expect(groupsFetched()).toEqual([]);

    act(() => store.set(appLockedAtom, false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await appOpens(joinLink(7));
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
  });

  it('still takes a member to the group from a link they click', async () => {
    renderHub();

    await userOpens(joinLink(MEMBER_OF));

    expect(groupsOpened).toEqual([{ from: '5' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
