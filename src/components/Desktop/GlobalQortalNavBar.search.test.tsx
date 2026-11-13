import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import { userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { GlobalQortalNavBar } from './GlobalQortalNavBar';

// The bar's other widgets are not under test here.
vi.mock('../QMailStatus', () => ({ QMailStatus: () => null }));
vi.mock('../GeneralNotifications', () => ({
  GeneralNotifications: () => null,
}));
vi.mock('../TaskManager/TaskManager', () => ({ TaskManager: () => null }));
vi.mock('../GlobalActions/GlobalActions', () => ({
  GlobalActions: () => null,
}));
vi.mock('./SubscriptionsStatus', () => ({ SubscriptionsStatus: () => null }));
vi.mock('../Apps/AppBookmarks', () => ({ AppBookmarksButton: () => null }));
vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));

const catalog = [
  { metadata: { title: 'Torq' }, name: 'Torq', service: 'APP' },
  { metadata: { title: 'Torque Garage' }, name: 'Torque', service: 'WEBSITE' },
  { metadata: { title: 'Q-Tube' }, name: 'Q-Tube', service: 'APP' },
];

type Heard = { data: unknown; event: string };
const EVENTS = ['addTab', 'open-apps-mode', 'openAppsLibrarySearch'];
let heard: Heard[] = [];
const listeners = EVENTS.map((event) => {
  const listener = (e: Event) =>
    heard.push({ data: (e as CustomEvent).detail?.data, event });
  return { event, listener };
});

const renderBar = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QViewer', name: 'Viewer' });
  store.set(availableQappsAtom, catalog);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <GlobalQortalNavBar desktopViewMode="home" />
      </ThemeProvider>
    </Provider>
  );
  return screen.getByRole('combobox');
};

const type = (input: HTMLElement, value: string) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
};

const suggestions = () =>
  screen.queryAllByRole('option').map((option) => option.textContent);

const optionStartingWith = (text: string) => {
  const option = screen
    .getAllByRole('option')
    .find((item) => item.textContent?.startsWith(text));
  if (!option) throw new Error(`No suggestion starts with ${text}`);
  return option;
};

const opened = () =>
  heard
    .filter(({ event }) => event === 'addTab')
    .map(({ data }) => data as Record<string, string>);

const librarySearches = () =>
  heard
    .filter(({ event }) => event === 'openAppsLibrarySearch')
    .map(({ data }) => (data as { query: string }).query);

describe('GlobalQortalNavBar search suggestions', () => {
  beforeEach(() => {
    localStorage.clear();
    heard = [];
    listeners.forEach(({ event, listener }) =>
      document.addEventListener(event, listener)
    );
  });

  afterEach(() => {
    listeners.forEach(({ event, listener }) =>
      document.removeEventListener(event, listener)
    );
  });

  it('suggests Q-Apps and websites as the user types', () => {
    const input = renderBar();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    type(input, 'tor');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(suggestions()).toEqual([
      'TorqQ-App',
      'Torque GarageTorque · Website',
      'Search Q-Apps for “tor”',
    ]);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens a suggestion picked with the keyboard', () => {
    const input = renderBar();
    type(input, 'tor');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(opened()).toEqual([{ name: 'Torque', service: 'WEBSITE' }]);
    expect(heard.map(({ event }) => event)).toContain('open-apps-mode');
    expect(input).toHaveValue('qortal://WEBSITE/Torque');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens a suggestion that is clicked', () => {
    const input = renderBar();
    type(input, 'tube');

    fireEvent.click(optionStartingWith('Q-Tube'));

    expect(opened()).toEqual([{ name: 'Q-Tube', service: 'APP' }]);
  });

  it('opens an exact name on Enter, and searches the library for other text', () => {
    const input = renderBar();

    type(input, 'TORQ');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(opened()).toEqual([{ name: 'Torq', service: 'APP' }]);

    type(input, 'garage');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(librarySearches()).toEqual(['garage']);
    expect(opened()).toHaveLength(1);
  });

  it('searches the library from its row', () => {
    const input = renderBar();
    type(input, 'tor');

    fireEvent.click(
      screen.getByRole('option', { name: 'Search Q-Apps for “tor”' })
    );

    expect(librarySearches()).toEqual(['tor']);
    expect(opened()).toEqual([]);
  });

  it('opens a qortal:// link as before, without suggestions', () => {
    const input = renderBar();
    type(input, 'qortal://APP/Q-Tube');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(opened()).toEqual([
      expect.objectContaining({ name: 'Q-Tube', service: 'APP' }),
    ]);
  });

  it('ranks the apps this account opens most first', () => {
    const input = renderBar();
    act(() => {
      executeEvent('addTab', { data: { name: 'Torque', service: 'WEBSITE' } });
    });

    type(input, 'tor');

    expect(suggestions()[0]).toBe('Torque GarageTorque · Website');
    expect(
      JSON.parse(localStorage.getItem('app_open_counts:QViewer') || '{}')
    ).toEqual({ 'WEBSITE:torque': 1 });
  });

  it('closes the suggestions on Escape', () => {
    const input = renderBar();
    type(input, 'tor');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(opened()).toEqual([]);
  });
});
