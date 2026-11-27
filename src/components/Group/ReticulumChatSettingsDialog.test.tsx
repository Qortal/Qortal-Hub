import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createTheme, ThemeProvider } from '@mui/material';
import {
  memberGroupsAtom,
  globalNotificationFormAtom,
  DEFAULT_GLOBAL_NOTIF_FORM,
  reticulumChatTextScaleAtom,
  reticulumHighlightOwnMessagesAtom,
  reticulumLegacyThreadsEnabledAtom,
} from '../../atoms/global';
import { ReticulumChatSettingsDialog } from './GroupList';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));

vi.mock('../../utils/qChatNotificationSettings', async () => {
  const actual = await vi.importActual('../../utils/qChatNotificationSettings');
  return {
    ...actual,
    applyNotificationSettingsToAllGroups: vi.fn(async () => {}),
    setGlobalNotificationSettings: vi.fn(async () => ({
      pushLevel: 'mentions',
      suppressEveryoneHere: false,
      notifyOnReplies: true,
      notifyOnReactions: true,
      version: 2,
    })),
    wipeAllChannelOverrides: vi.fn(async () => {}),
    getNotificationDeliveryMethod: vi.fn(async () => 'native'),
    setNotificationDeliveryMethod: vi.fn(async () => {}),
  };
});

function renderDialog(
  memberGroups: any[] = [{ groupId: 1 }, { groupId: 2 }],
  committedForm = DEFAULT_GLOBAL_NOTIF_FORM
) {
  const store = createStore();
  store.set(memberGroupsAtom, memberGroups);
  store.set(globalNotificationFormAtom, committedForm);
  store.set(reticulumChatTextScaleAtom as any, 'default');
  store.set(reticulumHighlightOwnMessagesAtom as any, false);
  store.set(reticulumLegacyThreadsEnabledAtom as any, false);

  return {
    store,
    ...render(
      <ThemeProvider theme={createTheme()}>
        <Provider store={store}>
          <ReticulumChatSettingsDialog open={true} onClose={() => {}} />
        </Provider>
      </ThemeProvider>
    ),
  };
}

function openNotifications() {
  const navButtons = screen.getAllByText(
    'reticulum:settings.nav.notifications'
  );
  fireEvent.click(navButtons[navButtons.length - 1]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReticulumChatSettingsDialog — Notifications section', () => {
  it('shows Notifications category in the left nav', () => {
    renderDialog();
    expect(
      screen.getAllByText('reticulum:settings.nav.notifications').length
    ).toBeGreaterThan(0);
  });

  it('renders notification controls with default values when navigated to', () => {
    renderDialog();
    openNotifications();

    expect(
      screen.getByText('reticulum:settings.notifications.title')
    ).toBeInTheDocument();
    expect(
      screen.getByText('reticulum:settings.notifications.description')
    ).toBeInTheDocument();

    const mentionsRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'mentions');
    expect(mentionsRadio).toBeDefined();
    expect(mentionsRadio?.checked).toBe(true);

    const allRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'all');
    expect(allRadio?.checked).toBe(false);

    const noneRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'none');
    expect(noneRadio?.checked).toBe(false);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(5);

    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(true);
    expect(checkboxes[3].checked).toBe(true);
    expect(checkboxes[4].checked).toBe(false);
  });

  it('renders the Apply to All Groups button', () => {
    renderDialog();
    openNotifications();

    expect(
      screen.getByText('reticulum:settings.notifications.apply_button')
    ).toBeInTheDocument();
  });

  it('sets global defaults and wipes channel overrides when Apply is clicked', async () => {
    const { setGlobalNotificationSettings, wipeAllChannelOverrides } =
      await import('../../utils/qChatNotificationSettings');

    renderDialog();
    openNotifications();

    const noneRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'none');
    fireEvent.click(noneRadio!);

    const applyButton = screen.getByText(
      'reticulum:settings.notifications.apply_button'
    );
    await act(async () => {
      fireEvent.click(applyButton);
    });

    expect(setGlobalNotificationSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        pushLevel: 'none',
        suppressEveryoneHere: false,
        notifyOnReplies: true,
        notifyOnReactions: true,
      })
    );
    expect(wipeAllChannelOverrides).toHaveBeenCalledWith([1, 2]);
  });

  it('does not update the committed atom until Apply is clicked', async () => {
    const { store } = renderDialog();
    openNotifications();

    const noneRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'none');
    fireEvent.click(noneRadio!);

    expect(store.get(globalNotificationFormAtom)).toEqual(
      DEFAULT_GLOBAL_NOTIF_FORM
    );

    const applyButton = screen.getByText(
      'reticulum:settings.notifications.apply_button'
    );
    await act(async () => {
      fireEvent.click(applyButton);
    });

    expect(store.get(globalNotificationFormAtom).pushLevel).toBe('none');
  });

  it('disables Apply when the draft equals the committed atom', () => {
    renderDialog();
    openNotifications();

    expect(
      screen
        .getByText('reticulum:settings.notifications.apply_button')
        .closest('button')
    ).toBeDisabled();
  });

  it('shows Revert when a field differs from defaults, even after only toggling reactions', () => {
    renderDialog();
    openNotifications();

    const reactionsCheckbox = screen.getAllByRole('checkbox')[3];
    fireEvent.click(reactionsCheckbox);

    expect(
      screen.getByText('reticulum:settings.notifications.revert_button')
    ).toBeInTheDocument();
  });

  it('does not call setNotificationDeliveryMethod when Revert is clicked', async () => {
    const { setNotificationDeliveryMethod } =
      await import('../../utils/qChatNotificationSettings');

    renderDialog();
    openNotifications();

    const reactionsCheckbox = screen.getAllByRole('checkbox')[3];
    fireEvent.click(reactionsCheckbox);

    const revertButton = screen.getByText(
      'reticulum:settings.notifications.revert_button'
    );
    fireEvent.click(revertButton);

    expect(setNotificationDeliveryMethod).not.toHaveBeenCalled();
  });

  it('discards edits when the dialog is closed without applying', () => {
    const { store, unmount } = renderDialog();
    openNotifications();

    const noneRadio = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('value') === 'none');
    fireEvent.click(noneRadio!);
    unmount();

    expect(store.get(globalNotificationFormAtom)).toEqual(
      DEFAULT_GLOBAL_NOTIF_FORM
    );
  });
});
