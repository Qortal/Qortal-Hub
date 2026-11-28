import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { REFRESH_DONE_MS, REFRESH_TURN_MS } from './libraryLayout';
import { LibraryRefreshButton } from './LibraryRefreshButton';

const LABEL = 'core:action.refetch_apps_websites_list';

/** A refresh that finishes when the test says so. */
const deferred = () => {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const renderButton = (onRefresh: () => unknown) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <LibraryRefreshButton label={LABEL} onRefresh={onRefresh} />
    </ThemeProvider>
  );

const button = () => screen.getByRole('button', { name: LABEL });
const icon = () =>
  button().querySelector('[data-refresh-phase]') as HTMLElement;
const flush = () => act(async () => {});

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('LibraryRefreshButton', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it('refreshes once and turns until it is done', async () => {
    const refresh = deferred();
    const onRefresh = vi.fn(() => refresh.promise);
    renderButton(onRefresh);

    fireEvent.click(button());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(button()).toHaveAttribute('aria-busy', 'true');
    expect(icon()).toHaveAttribute('data-motion', 'spin');

    // A click while it turns does nothing.
    fireEvent.click(button());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('stops only at the end of a turn after the refresh is done', async () => {
    const refresh = deferred();
    renderButton(() => refresh.promise);

    fireEvent.click(button());
    fireEvent.animationIteration(icon());
    expect(icon()).toHaveAttribute('data-refresh-phase', 'busy');

    refresh.resolve();
    await flush();
    expect(icon()).toHaveAttribute('data-refresh-phase', 'busy');

    fireEvent.animationIteration(icon());
    expect(icon()).toHaveAttribute('data-refresh-phase', 'done');
    expect(button()).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('status')).toHaveTextContent(
      'core:launcher.library.refreshed'
    );

    act(() => {
      vi.advanceTimersByTime(REFRESH_DONE_MS);
    });
    expect(icon()).toHaveAttribute('data-refresh-phase', 'idle');
    expect(button()).toHaveAccessibleName(LABEL);
  });

  it('stops by itself when no animation event comes', async () => {
    renderButton(() => Promise.resolve());

    fireEvent.click(button());
    await flush();
    expect(icon()).toHaveAttribute('data-refresh-phase', 'busy');

    act(() => {
      vi.advanceTimersByTime(REFRESH_TURN_MS + 400);
    });
    expect(icon()).toHaveAttribute('data-refresh-phase', 'done');
  });

  it('also stops when the refresh fails', async () => {
    renderButton(() => Promise.reject(new Error('offline')));

    fireEvent.click(button());
    await flush();
    act(() => {
      vi.advanceTimersByTime(REFRESH_TURN_MS + 400);
    });
    expect(icon()).toHaveAttribute('data-refresh-phase', 'done');
  });

  it('pulses instead of turning when the system asks for less motion', () => {
    setReducedMotion(true);
    renderButton(() => new Promise(() => {}));

    fireEvent.click(button());
    expect(icon()).toHaveAttribute('data-motion', 'pulse');
  });

  it('can be removed while it turns', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refresh = deferred();
    const { unmount } = renderButton(() => refresh.promise);

    fireEvent.click(button());
    unmount();
    refresh.resolve();
    await flush();
    act(() => {
      vi.advanceTimersByTime(REFRESH_TURN_MS + REFRESH_DONE_MS + 400);
    });

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  // In sx, 1 means 100 % and margin -1 means -8 px. A status as wide as the
  // library's header made the launcher wider than its window, and dragging
  // an app near the edge then slid the whole launcher sideways.
  it('keeps its status for screen readers in a 1 px box', () => {
    renderButton(() => undefined);

    const style = getComputedStyle(screen.getByRole('status'));
    expect(style.position).toBe('absolute');
    expect(style.width).toBe('1px');
    expect(style.height).toBe('1px');
    expect(style.margin).toBe('-1px');
  });
});
