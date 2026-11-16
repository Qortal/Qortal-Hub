import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));
vi.mock('../../../background/background', () => ({
  createEndpoint: vi.fn(async (path: string) => `http://node${path}`),
}));
vi.mock('../AppViewerContainer', () => ({
  default: () => <div data-testid="app-view" />,
}));
vi.mock('./screenshotImage', () => ({
  encodeScreenshot: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([7])], { type: 'image/webp' }),
    width: 1600,
    height: 1000,
  })),
}));

import { ScreenshotCaptureDialog } from './ScreenshotCaptureDialog';
import { LauncherTabShownContext } from '../launcherTabs';

const CAPTURED = { png: new Uint8Array([1]), width: 1600, height: 1000 };

let qappGuestShot: ReturnType<typeof vi.fn>;

// As its callers keep it: the same object across renders.
const SOURCE = { kind: 'published', service: 'APP', name: 'MyApp' } as const;

const renderDialog = (slots = 5) => {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const dialogIn = (isTabShown: boolean) => (
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <LauncherTabShownContext.Provider value={isTabShown}>
          <ScreenshotCaptureDialog
            onClose={onClose}
            onDone={onDone}
            open
            slots={slots}
            source={SOURCE}
          />
        </LauncherTabShownContext.Provider>
      </I18nextProvider>
    </ThemeProvider>
  );
  const view = render(dialogIn(true));
  // Its launcher tab hidden behind another tab, or shown again.
  const setTabShown = (isTabShown: boolean) =>
    view.rerender(dialogIn(isTabShown));
  return { onClose, onDone, setTabShown };
};

const captureButton = () =>
  screen.getByRole('button', { name: 'app_page.capture.capture_this' });

const whenReady = () =>
  waitFor(() => expect(captureButton()).toBeEnabled(), { timeout: 3000 });

const shotUrls = () =>
  screen
    .queryAllByAltText('app_page.screenshots.alt')
    .map((image) => image.getAttribute('src'));

beforeEach(() => {
  // The guest isn't attached on the first look, then it captures.
  qappGuestShot = vi
    .fn()
    .mockRejectedValueOnce(new Error('QAPP_GUEST_NOT_FOUND'))
    .mockResolvedValue(CAPTURED);
  window.electronAPI = { qappGuestShot, qappGuestPrepare: vi.fn() } as any;
  let count = 0;
  URL.createObjectURL = vi.fn(() => `blob:${++count}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('taking screenshots by hand', () => {
  it('shows the app and takes nothing until the publisher captures', async () => {
    renderDialog();
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
    expect(screen.getByText('app_page.capture.loading')).toBeInTheDocument();
    expect(
      screen.getByText('app_page.capture.instructions')
    ).toBeInTheDocument();
    // Named by its title; the instructions describe it.
    expect(
      screen.getByRole('dialog', { name: 'app_page.capture.title' })
    ).toHaveAccessibleDescription('app_page.capture.instructions');
    await whenReady();
    expect(screen.queryByText('app_page.capture.loading')).toBeNull();
    const probes = qappGuestShot.mock.calls.length;
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(qappGuestShot).toHaveBeenCalledTimes(probes);
    expect(shotUrls()).toEqual([]);
    expect(screen.getByText('app_page.capture.count')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'app_page.capture.use' })
    ).toBeDisabled();
    // Only captures are ever asked of main.
    for (const call of qappGuestShot.mock.calls) {
      expect(call[1]).toEqual({ action: 'capture' });
    }
    expect(qappGuestShot.mock.calls[0][0]).toMatchObject({
      name: 'MyApp',
      service: 'APP',
    });
  });

  it('captures each press, reorders and removes, then hands them over', async () => {
    const { onDone, onClose } = renderDialog();
    await whenReady();
    await act(async () => {
      fireEvent.click(captureButton());
    });
    await act(async () => {
      fireEvent.click(captureButton());
    });
    await act(async () => {
      fireEvent.click(captureButton());
    });
    expect(shotUrls()).toEqual(['blob:1', 'blob:2', 'blob:3']);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'app_page.screenshots.move_later',
      })[0]
    );
    expect(shotUrls()).toEqual(['blob:2', 'blob:1', 'blob:3']);
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'app_page.screenshots.move_earlier',
      })[2]
    );
    expect(shotUrls()).toEqual(['blob:2', 'blob:3', 'blob:1']);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'action.remove' })[1]
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:3');
    expect(shotUrls()).toEqual(['blob:2', 'blob:1']);

    fireEvent.click(
      screen.getByRole('button', { name: 'app_page.capture.use' })
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0].map((shot) => shot.url)).toEqual([
      'blob:2',
      'blob:1',
    ]);
    expect(onDone.mock.calls[0][0][0]).toMatchObject({
      caption: '',
      width: 1600,
      height: 1000,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops at the room left on the page', async () => {
    renderDialog(1);
    await whenReady();
    await act(async () => {
      fireEvent.click(captureButton());
    });
    expect(shotUrls()).toEqual(['blob:1']);
    expect(captureButton()).toBeDisabled();
    expect(screen.getByText('app_page.capture.full')).toBeInTheDocument();
  });

  it('says so when a capture fails, and lets the publisher try again', async () => {
    renderDialog();
    await whenReady();
    qappGuestShot.mockRejectedValueOnce(new Error('SHOT_EMPTY'));
    await act(async () => {
      fireEvent.click(captureButton());
    });
    expect(
      screen.getByText('app_page.capture.capture_failed')
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(captureButton());
    });
    expect(shotUrls()).toEqual(['blob:1']);
    expect(screen.queryByText('app_page.capture.capture_failed')).toBeNull();
  });

  it('steps aside while its launcher tab is hidden, keeping the app and the captures', async () => {
    const { onClose, setTabShown } = renderDialog();
    await whenReady();
    await act(async () => {
      fireEvent.click(captureButton());
    });
    const view = screen.getByTestId('app-view');

    setTabShown(false);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Kept as it was, out of sight.
    expect(screen.getByTestId('app-view')).toBe(view);

    setTabShown(true);

    expect(
      await screen.findByRole('dialog', { name: 'app_page.capture.title' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('app-view')).toBe(view);
    expect(shotUrls()).toEqual(['blob:1']);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without handing anything over', async () => {
    const { onDone, onClose } = renderDialog();
    await whenReady();
    await act(async () => {
      fireEvent.click(captureButton());
    });
    fireEvent.click(screen.getByRole('button', { name: 'action.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });
});
