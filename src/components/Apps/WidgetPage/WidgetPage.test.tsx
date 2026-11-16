import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider } from 'jotai';

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: { en: { core: {} } },
});

const show = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({
    show: (...args: unknown[]) => show(...args),
  }),
}));
vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));
vi.mock('../../../background/background', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
  createEndpoint: vi.fn(async (path: string) => `http://node${path}`),
}));
vi.mock('../AppsNavBarDesktop', () => ({ saveToLocalStorage: vi.fn() }));
vi.mock('../AppViewerContainer', () => ({ default: () => null }));
vi.mock('../../../hooks/useAppRatings', () => ({
  getCacheKey: (name: string, service: string) =>
    `${service.toLowerCase()}-${name.toLowerCase()}`,
  useAppRating: () => ({ refresh: vi.fn() }),
}));
vi.mock('../../Group/groupApi', () => ({
  getPrimaryNamesForAddresses: vi.fn(async (addresses: string[]) =>
    Object.fromEntries(
      addresses.map((address) => [address, `name-of-${address}`])
    )
  ),
}));
vi.mock('../../../utils/generateWallet/publicKeyToAddress', () => ({
  default: (bytes: Uint8Array) => `Q${Array.from(bytes).join('.')}`,
}));
vi.mock('../../../encryption/Base58', () => ({
  default: {
    decode: (key: string) => new Uint8Array([key.length, key.charCodeAt(0)]),
  },
}));
vi.mock('../../Snackbar/Snackbar', () => ({
  CustomizedSnackbars: ({ open, info }: any) =>
    open && info ? <div role="status">{info.message}</div> : null,
}));

import { AppInfo } from '../AppInfo';
import { availableQappsAtom } from '../../../atoms/appsAtoms';
import { userInfoAtom } from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { savedHomeWidgetsAtom } from '../../HomeWidgets/homeWidgets';
import { appReviewKey, replyPrefixOf } from '../AppPage/appPageIds';
import { clearReviewRecordCache } from '../AppPage/useAppReviews';
import { toLibraryWidget } from '../AppsLibrary/widgetLibrary';

const WIDGET = toLibraryWidget({
  name: 'Q-Weather',
  identifier: 'go-widget-now',
  title: 'Weather Now',
  description: 'The weather right now for your place.',
  updated: 1_794_002_384_605,
  created: 1_794_002_384_605,
  category: 'WEATHER',
  categoryName: 'Weather',
  tags: ['weather', 'current weather'],
  size: 23_616,
});
const POLL = 'app-library-APP-rating-Q-Weather-id-go-widget-now';
const KEY = appReviewKey('APP', 'Q-Weather', 'go-widget-now');
const APP_KEY = appReviewKey('APP', 'Q-Weather');
const options = ['1', '2', '3', '4', '5', 'initialValue-4'].map(
  (optionName) => ({ optionName })
);

const routes = (overrides: Record<string, unknown> = {}) => {
  const table: Record<string, unknown> = {
    [`/polls/votes/${POLL}`]: {
      votes: [{ optionIndex: 4, voterPublicKey: 'AAAA' }],
      voteCounts: [],
    },
    [`/polls/${POLL}`]: {
      pollName: POLL,
      owner: 'QOwner',
      creatorPublicKey: 'CREATOR',
      pollOptions: options,
    },
    // The app beside the widget has a rating of its own: never shown here.
    '/polls/votes/app-library-APP-rating-Q-Weather': {
      votes: [{ optionIndex: 0, voterPublicKey: 'ZZ' }],
      voteCounts: [],
    },
    '/polls/app-library-APP-rating-Q-Weather': {
      pollName: 'app-library-APP-rating-Q-Weather',
      owner: 'QOwner',
      creatorPublicKey: 'CREATOR',
      pollOptions: options,
    },
    [`identifier=${KEY}&`]: [
      {
        name: 'Alice',
        identifier: KEY,
        created: 1_794_100_000_000,
        metadata: { description: 'Shows rain before it comes' },
      },
    ],
    [`identifier=${replyPrefixOf(KEY)}&`]: [],
    [`identifier=${APP_KEY}&`]: [
      {
        name: 'Bob',
        identifier: APP_KEY,
        created: 1_794_100_000_001,
        metadata: { description: 'A review of the app, not the widget' },
      },
    ],
    '/names/address/': [{ name: 'Me' }],
    ...overrides,
  };
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(table)
      .sort((a, b) => b.length - a.length)
      .find((pattern) => url.includes(pattern));
    if (!key) return new Response('', { status: 404 });
    return new Response(JSON.stringify(table[key]));
  });
};

const renderPage = (widget = WIDGET, apps: any[] = []) => {
  const store = createStore();
  store.set(userInfoAtom, { name: 'Me', address: 'QMe' });
  store.set(availableQappsAtom, apps);
  const view = render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <AppInfo app={widget} myName="Me" />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
  return { store, ...view };
};

beforeEach(() => {
  localStorage.clear();
  clearReviewRecordCache();
  vi.mocked(executeEvent).mockClear();
  show.mockReset().mockResolvedValue(undefined);
  window.sendMessage = vi.fn().mockResolvedValue({ signature: 'TX' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a widget’s page', () => {
  it('shows the widget, its own rating and its own reviews', async () => {
    routes();
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Weather Now' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('The weather right now for your place.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('APP / Q-Weather / go-widget-now')
    ).toBeInTheDocument();
    // 5 stars and the creator's initial 4: the widget's poll, not the app's.
    expect(await screen.findByText('4.5')).toBeInTheDocument();
    expect(
      await screen.findByText('Shows rain before it comes')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('A review of the app, not the widget')
    ).toBeNull();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.endsWith('-rating-Q-Weather'))).toBe(false);
  });

  it('rates the widget in its own poll, then asks for a review of it', async () => {
    routes();
    renderPage();
    await screen.findByText('4.5');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('radio')[2]);
    });
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith(
        'voteOnPoll',
        { pollName: POLL, optionIndex: 2 },
        expect.any(Number)
      )
    );
    expect(
      await screen.findByText('app_page.reviews.prompt_title')
    ).toBeInTheDocument();

    const box = screen.getAllByPlaceholderText(
      'app_page.reviews.placeholder'
    )[0];
    fireEvent.change(box, { target: { value: 'Rain before it comes' } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.reviews.post' })
      );
    });
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith(
        'publishOnQDN',
        expect.objectContaining({
          service: 'COMMENT',
          identifier: KEY,
          name: 'Me',
        })
      )
    );
  });

  it('puts the widget on Home and takes it off again', async () => {
    routes();
    const { store } = renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: 'widgets.add_to_home' })
    );
    expect(store.get(savedHomeWidgetsAtom)).toEqual([
      expect.objectContaining({
        name: 'Q-Weather',
        identifier: 'go-widget-now',
        title: 'Weather Now',
      }),
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'widgets.added_to_home'
    );
    expect(screen.getByText('widgets.on_home')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'widgets.remove_from_home' })
    );
    expect(store.get(savedHomeWidgetsAtom)).toEqual([]);
    expect(
      screen.getByRole('button', { name: 'widgets.add_to_home' })
    ).toBeInTheDocument();
  });

  it('offers the app the widget comes with, to set it up there', async () => {
    routes();
    const app = { name: 'Q-Weather', service: 'APP' };
    renderPage(WIDGET, [app, { name: 'Q-Weather', service: 'WEBSITE' }]);
    fireEvent.click(
      screen.getByRole('button', { name: 'home_widgets.open_app' })
    );
    expect(executeEvent).toHaveBeenCalledWith('addTab', { data: app });
  });

  it('is the app itself when published as its name’s default APP', async () => {
    routes({
      '/polls/votes/app-library-APP-rating-GO%20Clock': {
        votes: [],
        voteCounts: [],
      },
      '/polls/app-library-APP-rating-GO%20Clock': {
        pollName: 'app-library-APP-rating-GO Clock',
        owner: 'QOwner',
        creatorPublicKey: 'CREATOR',
        pollOptions: ['1', '2', '3', '4', '5', 'initialValue-3'].map(
          (optionName) => ({ optionName })
        ),
      },
    });
    const clock = toLibraryWidget({
      name: 'GO Clock',
      identifier: null,
      title: 'GO Clock',
      description: '',
      updated: 1,
    });
    // Its own app is on the list too: no button to open what is open here.
    renderPage(clock, [{ name: 'GO Clock', service: 'APP' }]);
    expect(await screen.findByText('3.0')).toBeInTheDocument();
    expect(screen.getByText('APP / GO Clock')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'home_widgets.open_app' })
    ).toBeNull();
    const ratings = document.getElementById('app-page-ratings-card')!;
    expect(within(ratings).getAllByRole('radio')).toHaveLength(5);
  });
});
