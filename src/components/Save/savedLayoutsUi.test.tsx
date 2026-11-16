import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import {
  isUsingImportExportSettingsAtom,
  settingsQDNLastUpdatedAtom,
  userInfoAtom,
} from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { saveSidePanel, SIDE_PANEL_DEFAULT } from '../Desktop/sidePanel';
import {
  readHomeLayout,
  saveHomeLayout,
} from '../Group/HomeDesktop/homeLayout';
import { LayoutRestoreOffer } from './LayoutRestoreOffer';
import { LAYOUT_EDIT_DONE_EVENT, LayoutSavePrompt } from './LayoutSavePrompt';
import { QDN_CARD_DONE_MS } from './QdnSettingsCard';
import { RestoreLayoutButton } from './RestoreLayoutButton';
import { savedLayoutsAtom, takeInSavedLayouts } from './savedLayouts';

const save = vi.fn();
vi.mock('./useSaveSettingsToQdn', () => ({
  useSaveSettingsToQdn: () => save,
}));

const ALICE = 'QaliceAddress00000000000000000000';

const savedSettings = (hidden: string[], changedAt: number) => ({
  homeLayout: {
    v: 1,
    layout: { hidden, stack: ['widgets', 'groupActivity', 'feed'] },
    changedAt,
  },
  sidePanel: { v: 1, settings: SIDE_PANEL_DEFAULT, changedAt },
});

const renderWith = (ui: React.ReactNode, takeIn?: unknown) => {
  const store = createStore();
  store.set(userInfoAtom, { address: ALICE, name: 'alice' });
  store.set(isUsingImportExportSettingsAtom, false);
  store.set(settingsQDNLastUpdatedAtom, 1);
  if (takeIn !== undefined) {
    store.set(savedLayoutsAtom, takeInSavedLayouts(ALICE, takeIn));
  }
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>
    </Provider>
  );
  return store;
};

afterEach(() => {
  localStorage.clear();
  save.mockReset();
  vi.restoreAllMocks();
});

describe('LayoutRestoreOffer', () => {
  it('offers the layout saved elsewhere, and restores it', () => {
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });
    renderWith(<LayoutRestoreOffer />, savedSettings(['feed'], 70));

    expect(
      screen.getByText(
        'Your Home layout was changed and saved on another device.'
      )
    ).toBeInTheDocument();

    expect(
      screen.getByRole('dialog', { name: 'Restore from QDN?' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(readHomeLayout(ALICE).hidden).toEqual(['feed']);
    expect(screen.queryByText(/saved on another device/)).toBeNull();
    // It says so, without asking anything more.
    expect(screen.getByRole('status')).toHaveTextContent('Restored from QDN.');
  });

  it("keeps this device's layout", async () => {
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });
    renderWith(<LayoutRestoreOffer />, savedSettings(['feed'], 70));

    fireEvent.click(screen.getByRole('button', { name: "Keep this device's" }));

    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);
    await waitFor(() =>
      expect(screen.queryByText(/saved on another device/)).toBeNull()
    );
  });
});

describe('RestoreLayoutButton', () => {
  it('is there only while the saved layout differs, and asks first', () => {
    renderWith(
      <RestoreLayoutButton part="homeLayout" />,
      savedSettings(['feed'], 70)
    );
    // Taken in on a device that never changed it: the same, no button.
    expect(
      screen.queryByRole('button', { name: 'Restore from QDN' })
    ).toBeNull();

    act(() => saveHomeLayout(ALICE, { hidden: [], stack: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore from QDN' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      /Use the Home layout saved to QDN/
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(readHomeLayout(ALICE).hidden).toEqual(['feed']);
  });
});

describe('LayoutSavePrompt', () => {
  it('offers to save after editing, and saves', async () => {
    save.mockResolvedValue('saved');
    renderWith(<LayoutSavePrompt />, null);
    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    expect(screen.queryByText(/Save this layout to QDN/)).toBeNull();

    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    fireEvent.click(await screen.findByRole('button', { name: 'Save to QDN' }));

    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText(/Save this layout to QDN/)).toBeNull()
    );
  });

  it('names what is unsaved: the side panel, Home, or both', () => {
    renderWith(<LayoutSavePrompt />, null);
    act(() => saveSidePanel(ALICE, { ...SIDE_PANEL_DEFAULT, buttonSize: 1.1 }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(
      screen.getByText(
        'Your side panel, set up like this, on every device you sign in on.'
      )
    ).toBeInTheDocument();

    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    expect(
      screen.getByText(
        'Your Home layout and side panel, set up like this, on every device you sign in on.'
      )
    ).toBeInTheDocument();
  });

  it('says it saved, then goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      save.mockResolvedValue('saved');
      renderWith(<LayoutSavePrompt />, null);
      act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
      act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save to QDN' }));
      });

      expect(screen.getByRole('status')).toHaveTextContent(
        'Successfully published to QDN'
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(QDN_CARD_DONE_MS + 500);
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what went wrong, and tries again', async () => {
    save.mockRejectedValue(new Error('node said no'));
    renderWith(<LayoutSavePrompt />, null);
    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));

    fireEvent.click(screen.getByRole('button', { name: 'Save to QDN' }));

    expect(await screen.findByText('Unable to save to QDN')).toBeVisible();
    expect(screen.getByText('node said no')).toBeVisible();

    save.mockResolvedValue('saved');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('goes when put off, and asks again after the next edit', async () => {
    renderWith(<LayoutSavePrompt />, null);
    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    await waitFor(() =>
      expect(screen.queryByText(/Save this layout to QDN/)).toBeNull()
    );
    expect(save).not.toHaveBeenCalled();

    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(screen.getByText(/Save this layout to QDN/)).toBeInTheDocument();
  });

  it('asks nothing when nothing changed', () => {
    renderWith(<LayoutSavePrompt />, null);
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(screen.queryByText(/Save this layout to QDN/)).toBeNull();
  });

  it('stays put when saving is declined', async () => {
    save.mockResolvedValue('canceled');
    renderWith(<LayoutSavePrompt />, null);
    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));

    fireEvent.click(await screen.findByRole('button', { name: 'Save to QDN' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Save this layout to QDN/)).toBeInTheDocument();
  });
});

describe("LayoutSavePrompt when QDN's copy can't be downloaded", () => {
  const NOTE = "Can't save to QDN on this node";

  /** Signed in, with the saved settings found but not downloaded. */
  const renderUnreadable = () => {
    const store = renderWith(<LayoutSavePrompt />);
    act(() => store.set(settingsQDNLastUpdatedAtom, -100));
    return store;
  };

  it("says why it can't save, after an edit", async () => {
    renderUnreadable();
    act(() => saveSidePanel(ALICE, { ...SIDE_PANEL_DEFAULT, background: 0.5 }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));

    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(
      screen.getByText(/couldn't be downloaded from this node/)
    ).toBeInTheDocument();
    // Nothing to save from here: only a way to close it.
    expect(screen.queryByRole('button', { name: 'Save to QDN' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText(NOTE)).toBeNull());
    expect(save).not.toHaveBeenCalled();
  });

  it("doesn't come back until something changes again", async () => {
    renderUnreadable();
    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText(NOTE)).toBeNull());

    // Edited, but nothing changed.
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(screen.queryByText(NOTE)).toBeNull();

    act(() => saveHomeLayout(ALICE, { hidden: ['status'], stack: [] }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it('says nothing when nothing changed', () => {
    renderUnreadable();
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('says nothing while the settings are still being read', () => {
    renderWith(<LayoutSavePrompt />);
    act(() => saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] }));
    act(() => executeEvent(LAYOUT_EDIT_DONE_EVENT, {}));
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByText(/Save this layout to QDN/)).toBeNull();
  });
});
