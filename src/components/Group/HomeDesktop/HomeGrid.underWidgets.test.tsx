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
  type HomeWindowId,
  homeDefaultGrid,
  normalizeHomeGrid,
} from './homeGrid';

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

// jsdom lays nothing out: the windows whose height follows their content say
// how tall they are here, in px (rows × 10 − 20).
let contentPx: Partial<Record<HomeWindowId, number>> = {};
beforeEach(() => {
  contentPx = {};
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      const id = this.parentElement?.getAttribute(
        'data-home-window'
      ) as HomeWindowId | null;
      return (id && contentPx[id]) || 0;
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

const TITLES: Partial<Record<HomeWindowId, string>> = {
  account: 'Account Overview',
  featured: 'Featured Q-Apps',
  feed: 'Torq Feed',
  groupActivity: 'Group Activity',
  qortino: 'Qortino',
  status: 'Node Status',
  tools: 'Quick Tools',
  wallet: 'Wallet Activity',
  widgets: 'Widgets',
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
  return onChangeGrid;
};

const editControls = (title: string) =>
  screen.getByRole('group', { name: new RegExp(`^${title}: `) });

const rectOf = (grid: readonly HomeGridItem[], key: HomeWindowId) => {
  const item = grid.find((entry) => entry.key === key);
  return item && [item.x, item.y, item.w, item.h];
};

/** The top of the default layout: the three columns. */
const topGrid = () => homeDefaultGrid().filter((item) => item.y < 64);

describe('HomeGrid, under a window whose height follows its content', () => {
  // Widgets made half as wide, over Group Activity, and saved while it held
  // tall widgets (290 rows).
  const widgetsOverGroupActivity = (): HomeGridItem[] => [
    ...topGrid(),
    { key: 'widgets', x: 0, y: 64, w: 12, h: 290 },
    { key: 'feed', x: 12, y: 64, w: 12, h: 63 },
    { key: 'groupActivity', x: 0, y: 354, w: 12, h: 63 },
  ];

  it('shows Group Activity right under a Widgets window that is shorter than when it was saved, at its own height', () => {
    // Here Widgets holds fewer: 80 rows.
    contentPx = { account: 180, widgets: 780 };
    renderGrid(widgetsOverGroupActivity());

    const frame = document.querySelector<HTMLElement>(
      '[data-home-window="groupActivity"]'
    );
    // 63 rows: 610 px, from row 144.
    expect(window.getComputedStyle(frame).height).toBe('610px');
    expect(window.getComputedStyle(frame).top).toBe('1440px');
  });

  it('saves Group Activity at its own height when it is moved above a Widgets window that is shorter than when it was saved', () => {
    // Here Widgets holds fewer: 80 rows.
    contentPx = { account: 180, widgets: 780 };
    const onChangeGrid = renderGrid(widgetsOverGroupActivity());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    // Group Activity goes above Widgets: only its place changes.
    fireEvent.keyDown(editControls('Group Activity'), { key: 'ArrowUp' });

    const saved = normalizeHomeGrid(onChangeGrid.mock.calls[0][0]);
    expect(rectOf(saved, 'groupActivity')).toEqual([0, 64, 12, 63]);
  });
});
