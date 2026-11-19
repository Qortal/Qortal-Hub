import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
import { lightTheme } from '../../../styles/theme-light';
import { HomeDesktop } from './HomeDesktop';
import { homeDefaultGrid, moveHomeWindow, resizeHomeWindow } from './homeGrid';
import {
  HOME_LAYOUT_DEFAULT,
  type HomePanelId,
  readHomeLayout,
  saveHomeLayout,
  withHomeGrid,
  withHomePanelShown,
} from './homeLayout';

/**
 * Whether Getting started shows: the Qortino card is a stand-in that tells
 * Home, and follows this as it changes.
 */
const gettingStarted = vi.hoisted(() => {
  let shown = true;
  const listeners = new Set<() => void>();
  return {
    get shown() {
      return shown;
    },
    set(value: boolean) {
      shown = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('../HomeQortinoWorkspaceCard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../HomeQortinoWorkspaceCard')>();
  const { useLayoutEffect, useSyncExternalStore } = await import('react');
  type CardProps = Parameters<typeof actual.HomeQortinoWorkspaceCard>[0];
  const StandIn = ({ onGettingStartedShownChange }: CardProps) => {
    const shown = useSyncExternalStore(
      gettingStarted.subscribe,
      () => gettingStarted.shown
    );
    useLayoutEffect(() => {
      onGettingStartedShownChange?.(shown);
    }, [onGettingStartedShownChange, shown]);
    return null;
  };
  return {
    ...actual,
    HomeQortinoWorkspaceCard: StandIn,
    QortinoMusicPlaybackController: () => null,
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
  gettingStarted.set(true);
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * The content Home measures in Qortino's window when it follows its content:
 * 210 px (23 rows) for Qortino alone, `withGettingStarted` px (50 rows by
 * default) with Getting started over him. jsdom lays nothing out, so the
 * rest measures nothing.
 */
const measureQortino = (withGettingStarted = 480) =>
  vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      if (this.parentElement?.dataset.homeWindow !== 'qortino') return 0;
      return gettingStarted.shown ? withGettingStarted : 210;
    });

const renderHome = () =>
  render(
    <Provider store={createStore()}>
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

/** A switch in Settings > Modules, as HomeLayoutSettings changes it. */
const switchWindow = (id: HomePanelId, shown: boolean) =>
  act(() => {
    saveHomeLayout(ALICE, withHomePanelShown(readHomeLayout(ALICE), id, shown));
  });

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
  it('shows the Workspace and Qortino where and as big as they are kept, and Qortino filling again after Done', () => {
    measureQortino();
    renderHome();
    // Qortino's window has the Workspace's rows and its own.
    expect(frame('workspace')).toBeNull();
    expect(places().qortino).toEqual(['0px', '0px', '106px', '410px']);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // Qortino as big as he's kept, not as tall as Getting started.
    expect(places().workspace).toEqual(['0px', '0px', '106px', '180px']);
    expect(places().qortino).toEqual(['0px', '200px', '106px', '210px']);
    expect(places().tools?.slice(0, 2)).toEqual(['0px', '430px']);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(frame('workspace')).toBeNull();
    expect(places().qortino).toEqual(['0px', '0px', '106px', '410px']);
    expect(places().tools?.slice(0, 2)).toEqual(['0px', '430px']);
  });

  it('saves Qortino dragged next to the Workspace as it showed, then fills again after Done', () => {
    measureQortino();
    // Qortino at the top of the right column; the Workspace where it was.
    saveHomeLayout(
      ALICE,
      withHomeGrid(
        HOME_LAYOUT_DEFAULT,
        moveHomeWindow(homeDefaultGrid(), 'qortino', 18, 0)
      )
    );
    renderHome();
    expect(frame('workspace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // To the top of the left column, over the Workspace.
    const preview = drag('Qortino', -18, 0);

    expect(preview.qortino).toEqual(['0px', '0px', '106px', '210px']);
    expect(preview.workspace).toEqual(['0px', '230px', '106px', '180px']);
    expect(places()).toEqual(preview);
    expect(savedPlaces(preview)).toEqual(preview);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(frame('workspace')).toBeNull();
    expect(places().qortino).toEqual(['0px', '0px', '106px', '410px']);
    expect(places().tools).toEqual(preview.tools);
  });

  it('keeps the Workspace 100 rows tall when only Quick Tools is moved from between it and Qortino', () => {
    measureQortino();
    // The Workspace 100 rows tall, Quick Tools under it, then Qortino.
    saveHomeLayout(
      ALICE,
      withHomeGrid(
        HOME_LAYOUT_DEFAULT,
        moveHomeWindow(
          resizeHomeWindow(homeDefaultGrid(), 'workspace', 6, 100),
          'tools',
          0,
          100
        )
      )
    );
    renderHome();
    expect(frame('workspace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // Quick Tools to the top of the right column.
    const preview = drag('Quick Tools', 18, -100);

    const grid = readHomeLayout(ALICE).grid ?? [];
    expect(grid.find((item) => item.key === 'workspace')).toEqual({
      key: 'workspace',
      x: 0,
      y: 0,
      w: 6,
      h: 100,
    });
    expect(preview.workspace).toEqual(['0px', '0px', '106px', '980px']);
    expect(places()).toEqual(preview);
    expect(savedPlaces(preview)).toEqual(preview);
  });
});

describe('Getting started done after a change made while Qortino did not fill', () => {
  it('leaves Home where it is, a window moved with the Workspace switched off', () => {
    measureQortino(420);
    renderHome();
    // Default layout: Qortino's window has the Workspace's rows and its own.
    expect(places().qortino).toEqual(['0px', '0px', '106px', '410px']);
    expect(places().tools?.slice(0, 2)).toEqual(['0px', '430px']);

    // The Workspace switched off in Settings, a window moved in Edit Home
    // (Wallet Activity over Node Status), the Workspace switched on again.
    switchWindow('workspace', false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.keyDown(editControls('Wallet Activity'), { key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    switchWindow('workspace', true);
    const whileGettingStarted = places().tools?.[1];

    act(() => {
      gettingStarted.set(false);
    });

    expect(frame('workspace')).not.toBeNull();
    expect(places().tools?.[1]).toBe(whileGettingStarted);
  });

  it('leaves Quick Tools where it showed, a window resized with the Workspace switched off', () => {
    measureQortino();
    renderHome();
    // Qortino's window has the Workspace's rows and its own.
    expect(places().tools?.[1]).toBe('430px');

    // Settings > Modules: the Workspace off; Edit Home: Featured Q-Apps a
    // little taller; Settings > Modules: the Workspace on again.
    switchWindow('workspace', false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.keyDown(editControls('Featured Q-Apps'), {
      key: 'ArrowDown',
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    switchWindow('workspace', true);
    const whileGettingStarted = places().tools?.[1];

    act(() => {
      gettingStarted.set(false);
    });

    // The Workspace back over Qortino, and nothing else moves.
    expect(places().workspace?.slice(0, 2)).toEqual(['0px', '0px']);
    expect(places().tools?.[1]).toBe(whileGettingStarted);
  });
});
