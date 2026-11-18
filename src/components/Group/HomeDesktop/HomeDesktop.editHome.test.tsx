import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { createContext } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { balanceAtom, txListAtom, userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import {
  restoreSavedLayouts,
  takeInSavedLayouts,
} from '../../Save/savedLayouts';
import { QORTINO_WORKSPACE_SETTINGS_KEY } from '../HomeQortinoWorkspaceCard';
import { HomeDesktop } from './HomeDesktop';
import {
  HOME_LAYOUT_DEFAULT,
  homeLayoutGrid,
  homeLayoutStorageKey,
  readHomeLayout,
  saveHomeLayout,
  withHomePanelShown,
} from './homeLayout';

/**
 * The Qortino card: the real one (`real`), or a stand-in that only tells
 * Home whether Getting started shows.
 */
const card = vi.hoisted(() => ({ gettingStarted: true, real: false }));

vi.mock('../HomeQortinoWorkspaceCard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../HomeQortinoWorkspaceCard')>();
  const { useLayoutEffect } = await import('react');
  type CardProps = Parameters<typeof actual.HomeQortinoWorkspaceCard>[0];
  const StandIn = ({ onGettingStartedShownChange }: CardProps) => {
    useLayoutEffect(() => {
      onGettingStartedShownChange?.(card.gettingStarted);
    }, [onGettingStartedShownChange]);
    return null;
  };
  return {
    ...actual,
    HomeQortinoWorkspaceCard: (props: CardProps) =>
      card.real ? (
        <actual.HomeQortinoWorkspaceCard {...props} />
      ) : (
        <StandIn {...props} />
      ),
    QortinoMusicPlaybackController: (
      props: Parameters<typeof actual.QortinoMusicPlaybackController>[0]
    ) =>
      card.real ? <actual.QortinoMusicPlaybackController {...props} /> : null,
  };
});
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  QORTAL_APP_CONTEXT: createContext({
    downloadResource: Object.assign(vi.fn(), {
      cancelResourceDownload: vi.fn(),
    }),
    show: vi.fn(),
  }),
  extStates: {},
}));
// EarBump's library: nothing to play.
vi.mock('../earbumpLibraryApi', () => ({
  fetchEarbumpRecentTracks: vi.fn().mockResolvedValue([]),
  fetchEarbumpTrackById: vi.fn().mockResolvedValue(null),
  searchEarbumpTracks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../HomeProfileCard', () => ({ HomeProfileCard: () => null }));
vi.mock('../HomeQuickToolsPad', () => ({ HomeQuickToolsPad: () => null }));
vi.mock('../HomeFeaturedApps', () => ({ HomeFeaturedApps: () => null }));
vi.mock('./InfoPreviewPanel', () => ({ InfoPreviewPanel: () => null }));
vi.mock('./HomeDesktopWalletActivity', () => ({
  HomeDesktopWalletActivity: () => null,
}));
vi.mock('./OnlineUsersBadge', () => ({ OnlineUsersBadge: () => null }));
vi.mock('./homeNavigation', () => ({ returnToQChat: vi.fn() }));
vi.mock('../../Widgets/DashboardWidgetFrame', () => ({
  DashboardWidgetFrame: () => null,
}));
vi.mock('../../Widgets/GroupsWidget', () => ({ GroupsWidget: () => null }));
vi.mock('../../Widgets/QuitterFeedWidget', () => ({
  QuitterFeedWidget: () => null,
}));
vi.mock('../../Widgets/quitter/torqFeed', () => ({ TORQ_APP_NAME: 'Torq' }));
vi.mock('../../HomeWidgets/HomeWidgetsPanel', () => ({
  HomeWidgetsPanel: () => null,
  canHostHomeWidgets: () => true,
}));
vi.mock('../../HomeWidgets/HomeWidgetPicker', () => ({
  HomeWidgetPicker: () => null,
}));
vi.mock('../../HomeWidgets/HomeWidgetWindow', () => ({
  HomeWidgetWindow: () => null,
}));
vi.mock('../../Save/RestoreLayoutButton', () => ({
  RestoreLayoutButton: () => null,
}));
vi.mock('../../Save/LayoutSavePrompt', () => ({
  LAYOUT_EDIT_DONE_EVENT: 'layoutEditDone',
}));

// jsdom has no PointerEvent: a mouse event with a pointer id stands in.
class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
const realPointerEvent = window.PointerEvent;
beforeAll(() => {
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
});
afterAll(() => {
  window.PointerEvent = realPointerEvent;
});

const ALICE = 'QaliceAddress00000000000000000000';

beforeEach(() => {
  card.gettingStarted = true;
  card.real = false;
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const renderHome = (store = createStore()) =>
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <HomeDesktop
          desktopViewMode="home"
          myAddress={ALICE}
          onOpenQortalLand={vi.fn()}
          onOpenSettings={vi.fn()}
          setDesktopViewMode={vi.fn()}
          setGroupSection={vi.fn()}
        />
      </ThemeProvider>
    </Provider>
  );

const frame = (id: string) =>
  document.querySelector<HTMLElement>(`[data-home-window="${id}"]`);

/**
 * Where every window shows, in px. jsdom lays nothing out: a column is 1 px
 * wide (21 px with its gap) and a row 10 px.
 */
const places = () =>
  Object.fromEntries(
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-home-window]'),
      (node) => {
        const style = window.getComputedStyle(node);
        return [
          node.dataset.homeWindow ?? '',
          [style.left, style.top, style.width, style.height],
        ];
      }
    )
  );

const editControls = (title: string) =>
  screen.getByRole('group', { name: new RegExp(`^${title}: drag it`) });

/** A window dragged by `columns` and `rows`: where the windows show before it's let go. */
const drag = (title: string, columns: number, rows: number) => {
  const controls = editControls(title);
  const to = { clientX: 300 + columns * 21, clientY: 300 + rows * 10 };
  fireEvent.pointerDown(controls, { button: 0, clientX: 300, clientY: 300 });
  fireEvent.pointerMove(controls, {
    clientX: (300 + to.clientX) / 2,
    clientY: (300 + to.clientY) / 2,
  });
  fireEvent.pointerMove(controls, to);
  const preview = places();
  fireEvent.pointerUp(controls, to);
  return preview;
};

/**
 * Where the saved layout puts these windows, in px as places() gives them:
 * what shows while editing is what's kept.
 */
const savedPlaces = (shown: Record<string, string[]>) => {
  const grid = readHomeLayout(ALICE).grid ?? [];
  return Object.fromEntries(
    Object.keys(shown).map((id) => {
      const item = grid.find((entry) => entry.key === id);
      return [
        id,
        item
          ? [
              `${item.x * 21}px`,
              `${item.y * 10}px`,
              `${item.w * 21 - 20}px`,
              `${item.h * 10 - 20}px`,
            ]
          : null,
      ];
    })
  );
};

describe('Edit Home while Getting started shows', () => {
  it('saves a window dragged as every window showed while it was dragged', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // From the middle column to the top left corner.
    const preview = drag('Featured Q-Apps', -6, -20);

    // While dragged: on top, the Workspace and Qortino under it, each as
    // big as it's kept.
    expect(preview.featured?.slice(0, 2)).toEqual(['0px', '0px']);
    expect(preview.workspace).toEqual(['0px', '440px', '106px', '180px']);
    expect(preview.qortino).toEqual(['0px', '640px', '106px', '210px']);
    expect(places()).toEqual(preview);
    expect(savedPlaces(preview)).toEqual(preview);
  });

  it('saves a window moved with the keyboard as it showed', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // Wallet Activity over Node Status.
    fireEvent.keyDown(editControls('Wallet Activity'), { key: 'ArrowUp' });

    const shown = places();
    expect(shown.wallet?.slice(0, 2)).toEqual(['378px', '0px']);
    expect(shown.workspace).toEqual(['0px', '0px', '106px', '180px']);
    expect(shown.qortino).toEqual(['0px', '200px', '106px', '210px']);
    expect(savedPlaces(shown)).toEqual(shown);
  });

  it("saves Qortino's window resized as it showed, then fills the Workspace's rows again after Done", () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // Shift + Down: 5 rows taller.
    fireEvent.keyDown(editControls('Qortino'), {
      key: 'ArrowDown',
      shiftKey: true,
    });

    const shown = places();
    expect(shown.qortino).toEqual(['0px', '200px', '106px', '260px']);
    expect(shown.tools?.slice(0, 2)).toEqual(['0px', '480px']);
    expect(savedPlaces(shown)).toEqual(shown);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // The Workspace's rows and Qortino's, Quick Tools where it was.
    expect(frame('workspace')).toBeNull();
    expect(places().qortino).toEqual(['0px', '0px', '106px', '460px']);
    expect(places().tools).toEqual(shown.tools);
  });

  it('keeps a hidden window where it is kept', () => {
    saveHomeLayout(
      ALICE,
      withHomePanelShown(HOME_LAYOUT_DEFAULT, 'status', false)
    );
    const status = homeLayoutGrid(readHomeLayout(ALICE)).find(
      (item) => item.key === 'status'
    );
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    const preview = drag('Featured Q-Apps', -6, -20);

    expect(places()).toEqual(preview);
    expect(savedPlaces(preview)).toEqual(preview);
    const grid = readHomeLayout(ALICE).grid ?? [];
    expect(grid.find((item) => item.key === 'status')).toEqual(status);
  });
});

describe('Edit Home once Getting started is done', () => {
  it('moves a window as before, the Workspace among the others', () => {
    card.gettingStarted = false;
    renderHome();
    expect(places().workspace).toEqual(['0px', '0px', '106px', '180px']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    const preview = drag('Featured Q-Apps', -6, -20);

    expect(preview.featured?.slice(0, 2)).toEqual(['0px', '0px']);
    expect(preview.workspace?.slice(0, 2)).toEqual(['0px', '440px']);
    expect(places()).toEqual(preview);
  });
});

describe('Duplicate in Edit Home', () => {
  it('keeps the feed beside Group Activity when Widgets measures taller than it is kept', () => {
    card.gettingStarted = false;
    // What Home measures in the windows that follow their content: Widgets
    // 190 px, one row more than the 20 it has until measured.
    const heights: Record<string, number> = {
      account: 180,
      qortino: 210,
      widgets: 190,
    };
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return heights[this.parentElement?.dataset.homeWindow ?? ''] ?? 0;
      }
    );
    renderHome();
    const before = places();
    expect(before.feed?.[1]).toBe(before.groupActivity?.[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    for (let copy = 0; copy < 3; copy += 1) {
      fireEvent.click(
        screen.getByRole('button', { name: 'Duplicate Workspace' })
      );
    }

    const shown = places();
    expect(readHomeLayout(ALICE).workspaces).toHaveLength(3);
    // Still beside Group Activity, under Widgets.
    expect(shown.feed?.[1]).toBe(shown.groupActivity?.[1]);
    expect(parseFloat(shown.feed?.[1] ?? '')).toBeGreaterThan(
      parseFloat(shown.widgets?.[1] ?? '')
    );
  });
});

describe('a copy of the Workspace taken off Home', () => {
  it('lets go of what it held, and its music, with the Workspace and Qortino hidden', async () => {
    card.real = true;
    localStorage.setItem('getting_started_status_' + ALICE, 'completed');
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({
        hidden: ['workspace', 'qortino'],
        stack: ['widgets', 'groupActivity', 'feed'],
        version: 2,
        workspaces: ['k1'],
      })
    );
    // What the Workspaces hold, as the account's settings keep it: the music
    // player in the copy, playing.
    let settings: unknown = {
      hotkeys: [],
      mode: 'empty',
      musicPlaying: true,
      musicQuery: '',
      onboardingCelebrationSeen: true,
      repeatMode: 'all',
      selectedTrackId: '',
      version: 1,
      windows: { k1: { hotkeys: [], mode: 'music' } },
    };
    window.sendMessage = vi.fn(
      async (type: string, payload?: { keyValue?: { key?: string } }) => {
        if (type === 'getUserSettings') return settings;
        if (
          type === 'addUserSettings' &&
          payload?.keyValue?.key === QORTINO_WORKSPACE_SETTINGS_KEY
        ) {
          settings = (payload.keyValue as { value?: unknown }).value;
        }
        return null;
      }
    ) as typeof window.sendMessage;
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
      ok: true,
    }) as typeof fetch;
    const store = createStore();
    store.set(userInfoAtom, { address: ALICE, name: 'alice' });
    store.set(balanceAtom, 10);
    store.set(txListAtom, []);

    renderHome(store);
    const copy = () => frame('workspace:k1');
    await waitFor(() => {
      expect(within(copy()!).getByText('Music player')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Workspace 2' }));

    expect(copy()).toBeNull();
    await waitFor(() => {
      expect(settings).toMatchObject({ musicPlaying: false });
      expect(settings).not.toHaveProperty('windows');
    });
  });
});

describe('a Home layout restored from QDN without a copy of the Workspace', () => {
  it('keeps the copy that holds something here, and what it holds', async () => {
    card.real = true;
    localStorage.setItem('getting_started_status_' + ALICE, 'completed');
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({
        hidden: [],
        stack: ['widgets', 'groupActivity', 'feed'],
        version: 2,
        workspaces: ['k1'],
      })
    );
    // The music player is in the copy.
    let settings: unknown = {
      hotkeys: [],
      mode: 'empty',
      musicPlaying: false,
      musicQuery: '',
      onboardingCelebrationSeen: true,
      repeatMode: 'all',
      selectedTrackId: '',
      version: 1,
      windows: { k1: { hotkeys: [], mode: 'music' } },
    };
    window.sendMessage = vi.fn(
      async (type: string, payload?: { keyValue?: { key?: string } }) => {
        if (type === 'getUserSettings') return settings;
        if (
          type === 'addUserSettings' &&
          payload?.keyValue?.key === QORTINO_WORKSPACE_SETTINGS_KEY
        ) {
          settings = (payload.keyValue as { value?: unknown }).value;
        }
        return null;
      }
    ) as typeof window.sendMessage;
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
      ok: true,
    }) as typeof fetch;
    const store = createStore();
    store.set(userInfoAtom, { address: ALICE, name: 'alice' });
    store.set(balanceAtom, 10);
    store.set(txListAtom, []);

    renderHome(store);
    const copy = () => frame('workspace:k1');
    await waitFor(() => {
      expect(within(copy()!).getByText('Music player')).toBeInTheDocument();
    });

    // Saved by a Hub without copies of the Workspace, and restored here.
    act(() => {
      const state = takeInSavedLayouts(ALICE, {
        homeLayout: {
          v: 1,
          layout: { hidden: ['feed'], stack: ['widgets', 'groupActivity'] },
          changedAt: 70,
        },
      });
      restoreSavedLayouts(ALICE, state, ['homeLayout']);
    });

    expect(frame('feed')).toBeNull();
    expect(copy()).not.toBeNull();
    expect(within(copy()!).getByText('Music player')).toBeInTheDocument();
    await act(async () => {});
    expect(settings).toMatchObject({
      windows: { k1: { mode: 'music' } },
    });
  });

  it('keeps it when only the account settings hold what it holds, with storage full', async () => {
    card.real = true;
    localStorage.setItem('getting_started_status_' + ALICE, 'completed');
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({
        hidden: [],
        stack: ['widgets', 'groupActivity', 'feed'],
        version: 2,
        workspaces: ['k1'],
      })
    );
    // Storage is full: the card's copy of what the Workspaces hold isn't
    // written on this device.
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key.startsWith(QORTINO_WORKSPACE_SETTINGS_KEY)) {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    });
    // The account's settings have the music player in the copy.
    let settings: unknown = {
      hotkeys: [],
      mode: 'empty',
      musicPlaying: false,
      musicQuery: '',
      onboardingCelebrationSeen: true,
      repeatMode: 'all',
      selectedTrackId: '',
      version: 1,
      windows: { k1: { hotkeys: [], mode: 'music' } },
    };
    window.sendMessage = vi.fn(
      async (type: string, payload?: { keyValue?: { key?: string } }) => {
        if (type === 'getUserSettings') return settings;
        if (
          type === 'addUserSettings' &&
          payload?.keyValue?.key === QORTINO_WORKSPACE_SETTINGS_KEY
        ) {
          settings = (payload.keyValue as { value?: unknown }).value;
        }
        return null;
      }
    ) as typeof window.sendMessage;
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
      ok: true,
    }) as typeof fetch;
    const store = createStore();
    store.set(userInfoAtom, { address: ALICE, name: 'alice' });
    store.set(balanceAtom, 10);
    store.set(txListAtom, []);

    renderHome(store);
    const copy = () => frame('workspace:k1');
    await waitFor(() => {
      expect(within(copy()!).getByText('Music player')).toBeInTheDocument();
    });
    expect(
      localStorage.getItem(`${QORTINO_WORKSPACE_SETTINGS_KEY}_${ALICE}`)
    ).toBeNull();

    // Saved by a Hub without copies of the Workspace, and restored here.
    act(() => {
      const state = takeInSavedLayouts(ALICE, {
        homeLayout: {
          v: 1,
          layout: { hidden: ['feed'], stack: ['widgets', 'groupActivity'] },
          changedAt: 70,
        },
      });
      restoreSavedLayouts(ALICE, state, ['homeLayout']);
    });

    expect(frame('feed')).toBeNull();
    expect(readHomeLayout(ALICE).workspaces).toEqual(['k1']);
    expect(copy()).not.toBeNull();
    expect(within(copy()!).getByText('Music player')).toBeInTheDocument();
    await act(async () => {});
    expect(settings).toMatchObject({
      windows: { k1: { mode: 'music' } },
    });
  });
});
