import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const saveSettings = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../Chat/MessageDisplay', () => ({ extractComponents: vi.fn() }));

vi.mock('../../Save/useSaveSettingsToQdn', () => ({
  useSaveSettingsToQdn: (...args: unknown[]) => {
    useSaveSettingsToQdnArgs.push(args);
    return saveSettings;
  },
}));

const useSaveSettingsToQdnArgs: unknown[][] = [];

import {
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import { launcherViewStorageKey } from './launcherItems';
import { launcherEditsAtom, savedLauncherAtom } from './launcherQdnSync';
import { LauncherSaveWindow, SAVED_NOTICE_MS } from './LauncherSaveWindow';

const ADDRESS = 'Qaddress';
const NAME = 'simon';
const TITLE = 'core:launcher.save_title';
const SAVE = 'core:message.generic.save_qdn';
const LATER = 'core:launcher.save_later';
const RETRY = 'core:launcher.save_retry';
const SAVED = 'core:message.success.published_qdn';
const FAILED = 'core:message.error.save_qdn';

const bookmarks = (names: string[]): AppBookmarksForAddress => ({
  folders: [],
  bookmarks: names.map((name, index) => ({
    id: `b${index}`,
    name,
    service: 'APP',
    appName: name,
    path: '',
    link: `qortal://APP/${name}`,
    folderId: null,
    createdAt: 10,
    updatedAt: 20,
  })),
  updatedAt: 30,
});

/** An account whose saved settings are known and hold one bookmark. */
const setUp = ({
  data = bookmarks(['Q-Tube', 'Q-Mail']),
  edits = 1,
  savedBookmarks = bookmarks(['Q-Tube']),
  name = NAME as string | null,
  importExport = false as boolean | null,
  qdnLastUpdated = 100,
}: {
  data?: AppBookmarksForAddress | null;
  edits?: number;
  savedBookmarks?: AppBookmarksForAddress | null;
  name?: string | null;
  importExport?: boolean | null;
  qdnLastUpdated?: number;
} = {}) => {
  const store = createStore();
  store.set(isUsingImportExportSettingsAtom, importExport);
  store.set(settingsQDNLastUpdatedAtom, qdnLastUpdated);
  store.set(settingsLocalLastUpdatedAtom, 50);
  store.set(sortablePinnedAppsAtom, []);
  store.set(oldPinnedAppsAtom, []);
  store.set(launcherEditsAtom, { address: ADDRESS, count: edits });
  store.set(savedLauncherAtom, {
    address: ADDRESS,
    status: savedBookmarks ? 'saved' : 'none',
    launcher: savedBookmarks
      ? {
          bookmarks: {
            version: 1,
            folders: [],
            bookmarks: savedBookmarks.bookmarks.map(
              ({ link: _link, ...rest }) => rest
            ),
          },
          order: [],
        }
      : null,
    savedAt: 100,
  });

  const view = render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <LauncherSaveWindow
          bookmarks={data}
          myAddress={ADDRESS}
          myName={name}
        />
      </ThemeProvider>
    </Provider>
  );
  return { store, ...view };
};

beforeEach(() => {
  localStorage.clear();
  saveSettings.mockReset();
  saveSettings.mockResolvedValue('saved');
  useSaveSettingsToQdnArgs.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LauncherSaveWindow', () => {
  it('offers to save what differs from the saved arrangement', () => {
    setUp();

    expect(screen.getByText(TITLE)).toBeVisible();
    expect(screen.getByRole('button', { name: SAVE })).toBeVisible();
    expect(screen.getByRole('button', { name: LATER })).toBeVisible();
  });

  it('stays away until something is rearranged', () => {
    setUp({ edits: 0 });

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('stays away when the arrangement is the one that is saved', () => {
    setUp({ data: bookmarks(['Q-Tube']) });

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('stays away without a registered name, which QDN needs', () => {
    setUp({ name: null });

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('stays away until what is on QDN was read', async () => {
    const { store } = setUp();
    expect(screen.getByText(TITLE)).toBeVisible();

    act(() => {
      store.set(savedLauncherAtom, {
        address: ADDRESS,
        status: 'unknown',
        launcher: null,
        savedAt: 0,
      });
    });

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  });

  it('stays away while the saved settings could not be read', () => {
    setUp({ qdnLastUpdated: -100 });

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('stays away while settings are imported from a file', () => {
    setUp({ importExport: true });

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('saves, says so, and then goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setUp();

    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(SAVED)).toBeVisible();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SAVED_NOTICE_MS + 500);
    });

    await waitFor(() => expect(screen.queryByText(SAVED)).toBeNull());
  });

  it('goes when saving is declined, and comes back with the next change', async () => {
    const user = userEvent.setup();
    saveSettings.mockResolvedValue('canceled');
    setUp();

    await user.click(screen.getByRole('button', { name: SAVE }));

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeVisible());
    expect(screen.getByRole('button', { name: SAVE })).toBeEnabled();
  });

  it('says what went wrong and offers another try', async () => {
    const user = userEvent.setup();
    saveSettings.mockRejectedValue(new Error('node said no'));
    setUp();

    await user.click(screen.getByRole('button', { name: SAVE }));

    expect(await screen.findByText(FAILED)).toBeVisible();
    expect(screen.getByText('node said no')).toBeVisible();

    saveSettings.mockResolvedValue('saved');
    await user.click(screen.getByRole('button', { name: RETRY }));

    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(SAVED)).toBeVisible();
  });

  it('goes when it is put off, and comes back with the next change', async () => {
    const user = userEvent.setup();
    const { store } = setUp();

    await user.click(screen.getByRole('button', { name: LATER }));

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();

    act(() => {
      store.set(launcherEditsAtom, { address: ADDRESS, count: 2 });
    });

    expect(screen.getByText(TITLE)).toBeVisible();
  });

  it('counts the order of the tiles as something to save', () => {
    localStorage.setItem(
      launcherViewStorageKey(ADDRESS),
      JSON.stringify({ version: 1, order: ['APP-Q-Tube'], openFolders: [] })
    );
    setUp({ data: bookmarks(['Q-Tube']) });

    expect(screen.getByText(TITLE)).toBeVisible();
  });

  it('saves for the signed-in account', () => {
    setUp();

    expect(useSaveSettingsToQdnArgs.at(-1)).toEqual([ADDRESS, NAME]);
  });
});
