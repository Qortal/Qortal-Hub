import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
}));
const fetchHomeWidgets = vi.fn();
vi.mock('./fetchHomeWidgets', () => ({
  fetchHomeWidgets: (...args: unknown[]) => fetchHomeWidgets(...args),
}));

import { HomeWidgetsPanel, canHostHomeWidgets } from './HomeWidgetsPanel';
import { HOME_WIDGETS_STORAGE_KEY } from './homeWidgets';

const clock = {
  name: 'Clock',
  identifier: 'go-widget-clock',
  title: 'GO Clock',
  description: 'The time and date.',
  updated: 2,
};

const renderPanel = (
  elsewhere?: readonly { name: string; identifier: string | null }[]
) =>
  render(
    <Provider store={createStore()}>
      <HomeWidgetsPanel active elsewhere={elsewhere} />
    </Provider>
  );

const saved = () =>
  JSON.parse(window.localStorage.getItem(HOME_WIDGETS_STORAGE_KEY) ?? '[]');

beforeEach(() => {
  window.localStorage.removeItem(HOME_WIDGETS_STORAGE_KEY);
  fetchHomeWidgets.mockResolvedValue([clock]);
  vi.stubGlobal('electronAPI', {
    qappGuestPrepare: vi.fn().mockResolvedValue({
      partition: 'persist:qapp-test',
      preload: 'file:///test/qapp-guest-preload.js',
    }),
    qappGuestRelease: vi.fn().mockResolvedValue(true),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchHomeWidgets.mockReset();
});

describe('HomeWidgetsPanel', () => {
  it('is only offered where Q-App guests can run', () => {
    expect(canHostHomeWidgets()).toBe(true);
    vi.stubGlobal('electronAPI', {});
    expect(canHostHomeWidgets()).toBe(false);
    vi.stubGlobal('electronAPI', undefined);
    expect(canHostHomeWidgets()).toBe(false);
  });

  it('invites to add a widget, and adds one from the picker', async () => {
    const { container } = renderPanel();
    expect(screen.getByText('group:home_widgets.empty')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'group:home_widgets.add_widget' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('GO Clock')).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'group:home_widgets.add' })
    );
    expect(saved()).toEqual([
      expect.objectContaining({
        name: 'Clock',
        identifier: 'go-widget-clock',
        title: 'GO Clock',
        sizedBy: 'default',
      }),
    ]);
    // Added once: the picker now shows it as added.
    expect(
      within(dialog).getByRole('button', { name: 'group:home_widgets.added' })
    ).toBeDisabled();
    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-widget-name="Clock"][data-widget-identifier="go-widget-clock"]'
        )
      ).not.toBeNull()
    );
    await waitFor(() =>
      expect(container.querySelector('webview')?.getAttribute('src')).toContain(
        '/render/APP/Clock?'
      )
    );
  });

  it('counts the widgets in windows of their own as added', async () => {
    renderPanel([{ name: 'Clock', identifier: 'go-widget-clock' }]);
    fireEvent.click(
      screen.getByRole('button', { name: 'group:home_widgets.add_widget' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('GO Clock')).toBeInTheDocument();

    expect(
      within(dialog).getByRole('button', { name: 'group:home_widgets.added' })
    ).toBeDisabled();
    expect(saved()).toEqual([]);
  });

  it('arranges: keyboard moves and resizes, Delete and the button remove', async () => {
    window.localStorage.setItem(
      HOME_WIDGETS_STORAGE_KEY,
      JSON.stringify([
        { name: 'Clock', identifier: null, x: 0, y: 0, w: 2, h: 3 },
        { name: 'Weather', identifier: null, x: 0, y: 3, w: 4, h: 5 },
      ])
    );
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'group:home_widgets.arrange' })
    );
    const [clockCard, weatherCard] = screen.getAllByRole('group');
    fireEvent.keyDown(clockCard, { key: 'ArrowRight' });
    expect(saved()[0]).toMatchObject({ x: 1, y: 0, w: 2, h: 3 });
    fireEvent.keyDown(clockCard, { key: 'ArrowDown', shiftKey: true });
    expect(saved()[0]).toMatchObject({ h: 4, sizedBy: 'user' });
    fireEvent.keyDown(weatherCard, { key: 'Delete' });
    expect(saved().map((w: { name: string }) => w.name)).toEqual(['Clock']);
    fireEvent.click(
      screen.getByRole('button', { name: 'group:home_widgets.remove' })
    );
    expect(saved()).toEqual([]);
    // Nothing left to arrange: back to the invitation.
    expect(screen.getByText('group:home_widgets.empty')).toBeInTheDocument();
  });

  it('stops arranging with Escape', () => {
    window.localStorage.setItem(
      HOME_WIDGETS_STORAGE_KEY,
      JSON.stringify([{ name: 'Clock', identifier: null }])
    );
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'group:home_widgets.arrange' })
    );
    expect(screen.getAllByRole('group')).toHaveLength(1);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'group:home_widgets.arrange' })
    ).toBeInTheDocument();
  });
});
