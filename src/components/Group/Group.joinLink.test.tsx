import { createContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

// Group draws the whole signed-in window. Everything it only draws is left
// out here; its own handlers, its member list and the event bus are real.
const { none, wrap } = vi.hoisted(() => ({
  none: () => null,
  wrap: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock('../../App', () => ({
  clearAllQueues: vi.fn(),
  getBaseApiReact: () => 'http://node',
  pauseAllQueues: vi.fn(),
  resumeAllQueues: vi.fn(),
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../background/background.ts', () => ({ getFee: vi.fn() }));
vi.mock('../Chat/ChatGroup', () => ({ ChatGroup: none }));
vi.mock('../Chat/ChatDirect', () => ({ ChatDirect: none }));
vi.mock('../Chat/GroupAnnouncements', () => ({ GroupAnnouncements: none }));
vi.mock('../Chat/GroupForum', () => ({ GroupForum: none }));
vi.mock('../Chat/AdminSpace', () => ({ AdminSpace: none }));
vi.mock('../Chat/reticulumJoinUnreadBaseline', () => ({
  applyReticulumJoinUnreadBaseline: vi.fn(),
  resolveReticulumMembershipJoinedAt: vi.fn(async () => null),
}));
vi.mock('../common/ReticulumUnreadCountBadge', () => ({
  ReticulumUnreadCountBadge: none,
}));
vi.mock('./ReticulumModePill', () => ({ ReticulumModePill: none }));
vi.mock('../Snackbar/Snackbar', () => ({ CustomizedSnackbars: none }));
vi.mock('../Snackbar/LoadingSnackbar', () => ({ LoadingSnackbar: none }));
vi.mock('./WebsocketActive', () => ({ WebSocketActive: none }));
vi.mock('./WebsocketNotifications', () => ({ WebSocketNotifications: none }));
vi.mock('./groupApi', () => ({
  getAllPublishesFromAdmins: vi.fn(async () => []),
  getGroupAdmins: vi.fn(async () => ({})),
  getGroupAdminsAddress: vi.fn(async () => []),
  getGroupMembers: vi.fn(async () => ({})),
  getNameInfo: vi.fn(async () => ''),
  getNames: vi.fn(async () => []),
  getNamesForAdmins: vi.fn(async () => []),
  getPublishesFromAdmins: vi.fn(async () => []),
}));
vi.mock('./groupDataPublishes', () => ({
  addDataPublishesFunc: vi.fn(),
  decryptResource: vi.fn(),
  getDataPublishesFunc: vi.fn(),
}));
vi.mock('./groupQueues', () => ({
  requestQueueAdminMemberNames: { enqueue: vi.fn() },
  requestQueueMemberNames: { enqueue: vi.fn() },
}));
vi.mock('../../qdn/encryption/group-encryption', () => ({
  base64ToUint8Array: vi.fn(),
}));
vi.mock('../../encryption/encryption', () => ({
  uint8ArrayToObject: vi.fn(),
}));
vi.mock('../../messaging/MessageQueueContext', () => ({
  useMessageQueue: () => ({ clearStatesMessageQueueProvider: vi.fn() }),
}));
vi.mock('./HomeDesktop', () => ({ HomeDesktop: none }));
vi.mock('../Desktop/DesktopHeader', () => ({ DesktopHeader: none }));
vi.mock('../Apps/AppsDesktop', () => ({ AppsDesktop: none }));
vi.mock('../Desktop/DesktopLeftSideBar', () => ({ DesktopSideBar: none }));
vi.mock('../Save/LayoutRestoreOffer', () => ({ LayoutRestoreOffer: none }));
vi.mock('../Save/LayoutSavePrompt', () => ({ LayoutSavePrompt: none }));
vi.mock('../Save/QdnSettingsCard', () => ({ QdnCardDock: none }));
vi.mock('./WalletsAppWrapper', () => ({ WalletsAppWrapper: none }));
vi.mock('./GroupList', () => ({ GroupList: none }));
vi.mock('./ReticulumGroupAbout', () => ({ ReticulumGroupAboutModal: none }));
vi.mock('./FirstTimeQChatEmptyState', () => ({
  FirstTimeQChatEmptyState: none,
}));
vi.mock('./ReturningUserActivityDashboard', () => ({
  ReturningUserActivityDashboard: none,
}));
vi.mock('./ReturningUserCaughtUpState', () => ({
  ReturningUserCaughtUpState: none,
}));
vi.mock('./reticulumGroupScore', () => ({
  startReticulumGroupScoreScheduler: vi.fn(() => () => undefined),
}));
vi.mock('../../contexts/GroupCallContext', () => ({
  useGroupCallContext: () => ({
    joinGroupCall: vi.fn(),
    leaveGroupCall: vi.fn(),
    roomId: null,
    roomState: null,
  }),
}));
vi.mock('../../contexts/CallSwitchGuardContext', () => ({
  useCallSwitchGuard: () => ({ confirmCallSwitch: vi.fn(async () => true) }),
}));
vi.mock('../../lib/group-call/gcallAudioSurfaceTrace', () => ({
  traceGcallAudioSurface: vi.fn(),
}));
vi.mock('./useWebsocketStatus', () => ({ useWebsocketStatus: vi.fn() }));
vi.mock('./DirectsSidebar', () => ({ DirectsSidebar: none }));
vi.mock('./GlobalChatWidget', () => ({ GlobalChatWidget: none }));
vi.mock('../Onboarding/HubOnboardingTour', () => ({ HubOnboardingTour: none }));
vi.mock('../Onboarding/OnboardingQChatPreview', () => ({
  OnboardingQChatPreview: none,
}));
vi.mock('./Group.styles', () => ({
  AdminRowBox: wrap,
  CenterBox: wrap,
  ChatContentBox: wrap,
  EncryptionKeyMessageDiv: wrap,
  InnerChatBox: wrap,
  MainContentBox: wrap,
  NewChatOverlay: wrap,
  NoSelectionTypography: wrap,
  NotPartAdminListBox: wrap,
  NotPartGroupDiv: wrap,
  RootBox: wrap,
  SelectedDirectOverlay: wrap,
  SelectedGroupWrapper: wrap,
}));
vi.mock('./AddGroup', () => ({ AddGroup: none }));
vi.mock('./FindGroupModal', () => ({
  FindGroupModal: none,
  FindGroupOverviewModal: none,
}));
vi.mock('./ManageMembers', () => ({ ManageMembers: none }));
vi.mock('./BlockedUsersModal', () => ({ BlockedUsersModal: none }));
vi.mock('../QortalLand/QortalLand', () => ({ QortalLand: none }));

import { memberGroupsAtom, selectedGroupIdAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { openQortalLink } from '../../utils/qortalLink/openQortalLink';
import { JoinGroup } from '../GlobalActions/JoinGroup';
import { Group } from './Group';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const ME = 'QtestAddressOfTheSignedInAccount00';

/** A click on a group's join link, in chat or anywhere else in Hub. */
const clickJoinLink = (groupId: number) =>
  act(async () => {
    await openQortalLink(`qortal://use-group/action-join/groupid-${groupId}`);
  });

// The member list as Hub's background sends it to the window.
const receiveGroups = (groups: unknown[]) =>
  act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { action: 'SET_GROUPS', payload: groups },
        origin: window.location.origin,
      })
    );
  });

const renderHub = () => {
  const store = createStore();
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <I18nextProvider i18n={i18n}>
          <Group
            desktopViewMode="home"
            myAddress={ME}
            setDesktopViewMode={vi.fn()}
          />
          <JoinGroup />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
  return store;
};

describe("a group's join link, for a member", () => {
  beforeEach(() => {
    (window as unknown as { sendMessage: unknown }).sendMessage = vi.fn(
      async () => ({})
    );
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify([]))
    ) as unknown as typeof fetch;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('takes them to a group they joined a moment ago', async () => {
    const store = renderHub();
    await receiveGroups([{ groupId: 5, groupName: 'Five', timestamp: 1 }]);

    // A group they have been in for a while opens from its link.
    await clickJoinLink(5);
    await waitFor(() => expect(store.get(selectedGroupIdAtom)).toBe(5), {
      timeout: 3_000,
    });

    // They join another group from its link, and the join confirms: the
    // task list adds the group to the account's groups (TaskManager), before
    // Hub's background sends the whole list again.
    await act(async () => {
      store.set(memberGroupsAtom, (current: unknown[]) => [
        { groupId: 7, groupName: 'Seven' },
        ...current,
      ]);
    });

    // The same link again: they are in the group now, so it takes them
    // there, with no join window.
    await clickJoinLink(7);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await waitFor(() => expect(store.get(selectedGroupIdAtom)).toBe(7), {
      timeout: 3_000,
    });
  });
});
