import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { lightTheme } from '../../../styles/theme-light';
import type { QAppSaveUpdate } from '../../../../electron/src/qapp-context-menu-types';
import {
  CANCELLED_CARD_MS,
  QAppSavesNotice,
  SAVED_CARD_MS,
} from './QAppSavesNotice';

let push: ((update: QAppSaveUpdate) => void) | null;
let api: {
  onQAppSaveUpdate: ReturnType<typeof vi.fn>;
  qappSaveCancel: ReturnType<typeof vi.fn>;
  qappSaveShow: ReturnType<typeof vi.fn>;
};

let started: Set<string>;

/** Main's update for a save; its first one says so, as main does. */
const send = (update: QAppSaveUpdate) =>
  act(() => {
    const first = !started.has(update.saveId);
    started.add(update.saveId);
    push?.(first ? { ...update, first: true } : update);
  });

const renderNotice = () =>
  render(
    <ThemeProvider theme={lightTheme}>
      <QAppSavesNotice />
    </ThemeProvider>
  );

beforeEach(() => {
  push = null;
  started = new Set();
  api = {
    onQAppSaveUpdate: vi.fn((callback) => {
      push = callback;
      return () => {
        push = null;
      };
    }),
    qappSaveCancel: vi.fn(async () => true),
    qappSaveShow: vi.fn(async () => true),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('QAppSavesNotice', () => {
  it('shows nothing until a save starts', () => {
    renderNotice();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('follows a save to the end and opens its folder', () => {
    renderNotice();
    send({ saveId: 's1', name: 'picture.png', state: 'saving' });
    expect(screen.getByText('picture.png')).toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    send({ saveId: 's1', name: 'picture.png', state: 'saving', percent: 40 });
    expect(screen.getByText('Saving… 40%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '40'
    );
    send({ saveId: 's1', name: 'picture.png', state: 'done', percent: 100 });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(api.qappSaveShow).toHaveBeenCalledWith('s1');
    expect(screen.getAllByText('picture.png')).toHaveLength(1);
  });

  it('cancels a save that is still going', () => {
    renderNotice();
    send({ saveId: 's1', name: 'film.mp4', state: 'saving', percent: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.qappSaveCancel).toHaveBeenCalledWith('s1');
  });

  it('keeps a failed save until closed, and lets finished ones go', () => {
    vi.useFakeTimers();
    renderNotice();
    send({ saveId: 's1', name: 'a.png', state: 'failed' });
    send({ saveId: 's2', name: 'b.png', state: 'done', percent: 100 });
    send({ saveId: 's3', name: 'c.png', state: 'cancelled' });
    expect(screen.getByText("Couldn't save")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(CANCELLED_CARD_MS + 1);
    });
    expect(screen.queryByText('c.png')).not.toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SAVED_CARD_MS);
    });
    expect(screen.queryByText('b.png')).not.toBeInTheDocument();
    expect(screen.getByText('a.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('a.png')).not.toBeInTheDocument();
  });

  it('lets a saved card go on time while another save is still going', () => {
    vi.useFakeTimers();
    renderNotice();
    send({ saveId: 's1', name: 'a.png', state: 'saving' });
    send({ saveId: 's1', name: 'a.png', state: 'done', percent: 100 });
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    send({ saveId: 's2', name: 'film.mp4', state: 'saving', percent: 10 });
    act(() => {
      vi.advanceTimersByTime(SAVED_CARD_MS - 6_000 + 1);
    });
    expect(screen.queryByText('a.png')).not.toBeInTheDocument();
    expect(screen.getByText('film.mp4')).toBeInTheDocument();
  });

  it("doesn't show the next account a save started before signing out", () => {
    const first = renderNotice();
    send({ saveId: 's1', name: 'private.pdf', state: 'saving', percent: 5 });
    // Sign out: Group, and with it the notice, unmounts.
    first.unmount();
    // Another account signs in; the save finishes in main meanwhile.
    renderNotice();
    send({ saveId: 's1', name: 'private.pdf', state: 'done', percent: 100 });
    expect(screen.queryByText('private.pdf')).not.toBeInTheDocument();
  });

  it('shows the newest few saves', () => {
    renderNotice();
    for (let index = 1; index <= 6; index += 1) {
      send({ saveId: `s${index}`, name: `file-${index}.png`, state: 'saving' });
    }
    expect(screen.queryByText('file-1.png')).not.toBeInTheDocument();
    expect(screen.queryByText('file-2.png')).not.toBeInTheDocument();
    expect(screen.getByText('file-6.png')).toBeInTheDocument();
  });

  it("keeps the newest saves shown when an older save's progress comes in", () => {
    renderNotice();
    for (let index = 1; index <= 5; index += 1) {
      send({ saveId: `s${index}`, name: `file-${index}.png`, state: 'saving' });
    }
    expect(screen.queryByText('file-1.png')).not.toBeInTheDocument();
    // The oldest save goes on downloading, and says how far it got.
    send({ saveId: 's1', name: 'file-1.png', state: 'saving', percent: 40 });
    expect(screen.queryByText('file-1.png')).not.toBeInTheDocument();
    expect(screen.getByText('file-2.png')).toBeInTheDocument();
    // A newer one ends: the older save's card comes back.
    send({ saveId: 's5', name: 'file-5.png', state: 'failed' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.getByText('Saving… 40%')).toBeInTheDocument();
  });
});
