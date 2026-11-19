import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
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
import { HomeGrid, type HomeGridWindow } from './HomeGrid';
import {
  type HomeGridItem,
  type HomeWidgetWindowId,
  type HomeWindowId,
  homeDefaultGrid,
  homeGridShown,
  normalizeHomeGrid,
} from './homeGrid';
import { type HomeLayout, withHomeGrid } from './homeLayout';

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

// jsdom lays nothing out: the account card says how tall it is here. 140 px
// is 16 rows (a new account's card), 180 px the 20 rows its place has.
const SHORT_CARD_PX = 140;
let cardPx = SHORT_CARD_PX;
beforeEach(() => {
  cardPx = SHORT_CARD_PX;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement?.getAttribute('data-home-window') === 'account'
        ? cardPx
        : 0;
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

const TITLES: Partial<Record<HomeWindowId, string>> = {
  account: 'Account Overview',
  featured: 'Featured Q-Apps',
  qortino: 'Qortino',
  status: 'Node Status',
  tools: 'Quick Tools',
  wallet: 'Wallet Activity',
  workspace: 'Workspace',
};

const renderGrid = (grid: HomeGridItem[]) => {
  const onChangeGrid = vi.fn();
  const windows: HomeGridWindow[] = grid.map((item) => ({
    id: item.key,
    node: <div>{`${TITLES[item.key] ?? item.key} content`}</div>,
    title: TITLES[item.key] ?? item.key,
  }));
  render(
    <ThemeProvider theme={lightTheme}>
      <HomeGrid
        active
        grid={grid}
        hiddenWindows={[]}
        onChangeGrid={onChangeGrid}
        onHideWindow={vi.fn()}
        onResetGrid={vi.fn()}
        onShowWindow={vi.fn()}
        windows={windows}
      />
    </ThemeProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
  return onChangeGrid;
};

const editControls = (title: string) =>
  screen.getByRole('group', { name: new RegExp(`^${title}: `) });

const rectOf = (grid: readonly HomeGridItem[], key: HomeWindowId) => {
  const item = grid.find((entry) => entry.key === key);
  return item && [item.x, item.y, item.w, item.h];
};

const bottomOf = (grid: readonly HomeGridItem[], key: HomeWindowId) => {
  const item = grid.find((entry) => entry.key === key);
  return item.y + item.h;
};

/** The top of the default layout: the three columns. */
const topGrid = () =>
  homeDefaultGrid().filter((item) =>
    [
      'account',
      'featured',
      'qortino',
      'status',
      'tools',
      'wallet',
      'workspace',
    ].includes(item.key)
  );

describe('HomeGrid, editing under a short account card', () => {
  it('saves Featured Q-Apps at its own height when another window is moved with the keyboard', () => {
    const onChangeGrid = renderGrid(topGrid());

    // Wallet Activity goes over Node Status: nothing else was touched.
    fireEvent.keyDown(editControls('Wallet Activity'), { key: 'ArrowUp' });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    expect(rectOf(saved, 'wallet')).toEqual([18, 0, 6, 31]);
    expect(rectOf(saved, 'featured')?.[3]).toBe(44);
    // Home shows it as it did before the move: level with the other columns.
    const shown = homeGridShown(saved, () => true, { account: 16 });
    expect(bottomOf(shown, 'featured')).toBe(bottomOf(shown, 'tools'));
    // The card got its name and avatar: Featured Q-Apps still ends level.
    const later = homeGridShown(saved, () => true, { account: 20 });
    expect(rectOf(later, 'featured')).toEqual([6, 20, 12, 44]);
    expect(bottomOf(later, 'featured')).toBe(bottomOf(later, 'tools'));
  });

  it('saves Featured Q-Apps at its own height when another window is dragged', () => {
    const onChangeGrid = renderGrid(topGrid());
    const wallet = editControls('Wallet Activity');

    // jsdom lays nothing out: 21 px per column, 10 px per row.
    fireEvent.pointerDown(wallet, { button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(wallet, { clientX: 400, clientY: 250 });
    fireEvent.pointerMove(wallet, { clientX: 400, clientY: 70 });
    fireEvent.pointerUp(wallet, { clientX: 400, clientY: 70 });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    expect(rectOf(saved, 'wallet')).toEqual([18, 0, 6, 31]);
    expect(rectOf(saved, 'featured')?.[3]).toBe(44);
    const later = homeGridShown(saved, () => true, { account: 20 });
    expect(bottomOf(later, 'featured')).toBe(bottomOf(later, 'tools'));
  });

  it('saves Featured Q-Apps at its own height when it is moved itself', () => {
    const onChangeGrid = renderGrid(topGrid());

    fireEvent.keyDown(editControls('Featured Q-Apps'), { key: 'ArrowLeft' });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    // The card keeps its place: Featured Q-Apps, partly under it, goes under
    // that, and shows where it was dropped.
    expect(rectOf(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rectOf(saved, 'featured')).toEqual([5, 20, 12, 44]);
    // Under the Workspace too, now that it reaches its columns.
    const shown = homeGridShown(saved, () => true, { account: 16 });
    expect(rectOf(shown, 'featured')).toEqual([5, 20, 12, 44]);
  });

  it('saves the card at its place when it is made wider', () => {
    const onChangeGrid = renderGrid(topGrid());

    fireEvent.keyDown(editControls('Account Overview'), {
      key: 'ArrowRight',
      shiftKey: true,
    });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    expect(rectOf(saved, 'account')).toEqual([6, 0, 13, 20]);
    expect(rectOf(saved, 'featured')?.[3]).toBe(44);
  });

  it('saves the card at its place when it is made wider while taller than that', () => {
    // Narrower, the card puts its avatar above its details: 300 px, 32 rows.
    cardPx = 300;
    const onChangeGrid = renderGrid(
      topGrid().map((item) =>
        item.key === 'account' ? { ...item, w: 11 } : item
      )
    );

    // As wide as Featured Q-Apps again.
    fireEvent.keyDown(editControls('Account Overview'), {
      key: 'ArrowRight',
      shiftKey: true,
    });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    expect(rectOf(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rectOf(saved, 'featured')).toEqual([6, 20, 12, 44]);
    // Back at 16 rows, Featured Q-Apps ends level with the other columns.
    const shown = homeGridShown(saved, () => true, { account: 16 });
    expect(rectOf(shown, 'featured')).toEqual([6, 16, 12, 48]);
    expect(bottomOf(shown, 'featured')).toBe(bottomOf(shown, 'tools'));
  });

  it('shows Featured Q-Apps, while it is dragged, at the height it lands with', () => {
    const onChangeGrid = renderGrid(topGrid());
    const featured = editControls('Featured Q-Apps');
    const frame = document.querySelector('[data-home-window="featured"]');
    const landing = () =>
      document.querySelector('[data-home-layout] > [aria-hidden="true"]');
    const heightOf = (element: Element) =>
      window.getComputedStyle(element).height;

    // jsdom lays nothing out: 21 px per column, 10 px per row.
    fireEvent.pointerDown(featured, { button: 0, clientX: 400, clientY: 400 });
    // Held, still under the card: its 44 rows and the 4 the card leaves.
    fireEvent.pointerMove(featured, { clientX: 395, clientY: 400 });
    expect(heightOf(landing())).toBe('460px');
    expect(heightOf(frame)).toBe('460px');
    // A column to the left it's no longer under the card: its own 44 rows.
    fireEvent.pointerMove(featured, { clientX: 379, clientY: 400 });
    expect(heightOf(landing())).toBe('420px');
    expect(heightOf(frame)).toBe('420px');
    fireEvent.pointerUp(featured, { clientX: 379, clientY: 400 });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    expect(rectOf(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rectOf(saved, 'featured')).toEqual([5, 20, 12, 44]);
    // Where it was dropped, as the drag showed: under the Workspace too, now
    // that it reaches its columns.
    const shown = homeGridShown(saved, () => true, { account: 16 });
    expect(rectOf(shown, 'featured')).toEqual([5, 20, 12, 44]);
  });

  it('keeps the height the user gives Featured Q-Apps', () => {
    const onChangeGrid = renderGrid(topGrid());

    // 48 rows on screen (its 44 and the 4 the card leaves), 5 more.
    fireEvent.keyDown(editControls('Featured Q-Apps'), {
      key: 'ArrowDown',
      shiftKey: true,
    });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    // The card keeps its place, and the 4 rows it leaves.
    expect(rectOf(saved, 'account')).toEqual([6, 0, 12, 20]);
    expect(rectOf(saved, 'featured')).toEqual([6, 20, 12, 49]);
    // What was on screen is what shows after.
    const shown = homeGridShown(saved, () => true, { account: 16 });
    expect(rectOf(shown, 'featured')).toEqual([6, 16, 12, 53]);
  });

  it("gives a window's own buttons the layout as it's saved: the card's place, Featured Q-Apps at its own height", () => {
    const grid = topGrid();
    const duplicate = vi.fn();
    render(
      <ThemeProvider theme={lightTheme}>
        <HomeGrid
          active
          grid={grid}
          hiddenWindows={[]}
          onChangeGrid={vi.fn()}
          onHideWindow={vi.fn()}
          onResetGrid={vi.fn()}
          onShowWindow={vi.fn()}
          windows={grid.map((item) => ({
            ...(item.key === 'workspace'
              ? {
                  actions: [
                    {
                      icon: <span />,
                      label: 'Duplicate Workspace',
                      onClick: duplicate,
                    },
                  ],
                }
              : {}),
            id: item.key,
            node: <div>{`${TITLES[item.key]} content`}</div>,
            title: TITLES[item.key],
          }))}
        />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    fireEvent.click(
      screen.getByRole('button', { name: 'Duplicate Workspace' })
    );

    const given = duplicate.mock.calls[0][0];
    expect(rectOf(given, 'account')).toEqual([6, 0, 12, 20]);
    expect(rectOf(given, 'featured')).toEqual([6, 20, 12, 44]);
    // Saved, Home shows Featured Q-Apps level with the other columns.
    const shown = homeGridShown(normalizeHomeGrid(given), () => true, {
      account: 16,
    });
    expect(bottomOf(shown, 'featured')).toBe(bottomOf(shown, 'tools'));
  });

  it("leaves a widget's window under the card sized by its widget", () => {
    const clock = 'widget:Clock:' as HomeWidgetWindowId;
    const layout: HomeLayout = {
      grid: [
        { key: 'account', x: 6, y: 0, w: 12, h: 20 },
        { key: 'status', x: 0, y: 0, w: 6, h: 30 },
        { key: 'wallet', x: 0, y: 30, w: 6, h: 30 },
        { key: clock, x: 6, y: 20, w: 12, h: 27 },
      ],
      hidden: [
        'qortino',
        'tools',
        'featured',
        'widgets',
        'groupActivity',
        'feed',
      ],
      stack: ['widgets', 'groupActivity', 'feed'],
      widgetWindows: [{ identifier: null, name: 'Clock' }],
    };
    const onChangeGrid = renderGrid(layout.grid);

    // Only Wallet Activity is moved, over Node Status.
    fireEvent.keyDown(editControls('Wallet Activity'), { key: 'ArrowUp' });

    const next = withHomeGrid(layout, onChangeGrid.mock.calls[0][0]);
    expect(rectOf(next.grid, clock)?.[3]).toBe(27);
    // The size its widget asks for still applies.
    expect(next.widgetWindows?.[0].sizedBy).toBeUndefined();
  });
});

describe('HomeGrid, showing a short account card', () => {
  /** Home's top windows on a grid `width` px wide, not edited. */
  const showGrid = (width: number) => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(
      function (this: Element) {
        return this.hasAttribute('data-home-layout') ? width : 0;
      }
    );
    const grid = topGrid();
    render(
      <ThemeProvider theme={lightTheme}>
        <HomeGrid
          active
          grid={grid}
          hiddenWindows={[]}
          onChangeGrid={vi.fn()}
          onHideWindow={vi.fn()}
          onResetGrid={vi.fn()}
          onShowWindow={vi.fn()}
          windows={grid.map((item) => ({
            id: item.key,
            node: <div>{`${TITLES[item.key]} content`}</div>,
            title: TITLES[item.key],
          }))}
        />
      </ThemeProvider>
    );
    const featured = document.querySelector('[data-home-window="featured"]');
    return {
      layout: document
        .querySelector('[data-home-layout]')
        ?.getAttribute('data-home-layout'),
      featuredHeight: window.getComputedStyle(featured).height,
    };
  };

  it('keeps Featured Q-Apps level with the columns beside it in the wide layout', () => {
    const shown = showGrid(1200);
    expect(shown.layout).toBe('grid');
    // Its 44 rows and the 4 the card leaves.
    expect(shown.featuredHeight).toBe('460px');
  });

  it('shows Featured Q-Apps at its own height in two flowing columns', () => {
    const shown = showGrid(900);
    expect(shown.layout).toBe('flow');
    // Not beside Quick Tools and Wallet Activity here: its own 44 rows.
    expect(shown.featuredHeight).toBe('420px');
  });

  it('shows Featured Q-Apps at its own height in one flowing column', () => {
    const shown = showGrid(600);
    expect(shown.layout).toBe('flow');
    expect(shown.featuredHeight).toBe('420px');
  });
});
