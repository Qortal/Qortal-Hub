import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { lightTheme } from '../../../styles/theme-light';
import { executeEvent } from '../../../utils/events';
import { HOME_EDIT_LAYOUT_EVENT } from './homeDesktopConstants';
import { HomeGrid, type HomeGridWindow } from './HomeGrid';
import type { HomeGridItem, HomeWindowId } from './homeGrid';

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

const GRID: HomeGridItem[] = [
  { key: 'account', x: 6, y: 40, w: 12, h: 20 },
  { key: 'status', x: 0, y: 0, w: 6, h: 30 },
  { key: 'wallet', x: 0, y: 30, w: 6, h: 30 },
  { key: 'feed', x: 6, y: 0, w: 18, h: 40 },
];

const TITLES: Partial<Record<HomeWindowId, string>> = {
  account: 'Account Overview',
  feed: 'Torq Feed',
  status: 'Node Status',
  wallet: 'Wallet Activity',
};

const renderGrid = (props: Partial<Parameters<typeof HomeGrid>[0]> = {}) => {
  const handlers = {
    onChangeGrid: vi.fn(),
    onHideWindow: vi.fn(),
    onResetGrid: vi.fn(),
    onShowWindow: vi.fn(),
  };
  const windows: HomeGridWindow[] = GRID.map((item) => ({
    id: item.key,
    node: <div>{`${TITLES[item.key]} content`}</div>,
    title: TITLES[item.key] ?? item.key,
  }));
  render(
    <ThemeProvider theme={lightTheme}>
      <HomeGrid
        active
        grid={GRID}
        hiddenWindows={[]}
        windows={windows}
        {...handlers}
        {...props}
      />
    </ThemeProvider>
  );
  return handlers;
};

const editControls = (title: string) =>
  screen.getByRole('group', { name: new RegExp(`^${title}: drag it`) });

const rectOf = (grid: HomeGridItem[], key: HomeWindowId) => {
  const item = grid.find((entry) => entry.key === key);
  return item && [item.x, item.y, item.w, item.h];
};

describe('HomeGrid', () => {
  it('shows each window in a frame of its own', () => {
    renderGrid();
    ['account', 'status', 'wallet', 'feed'].forEach((id) =>
      expect(
        document.querySelector(`[data-home-window="${id}"]`)
      ).not.toBeNull()
    );
    expect(screen.getByText('Torq Feed content')).toBeInTheDocument();
    // Not editing yet: no edit controls on the windows.
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });

  it('edits with the Edit Home button, and stops with Done or Escape', () => {
    renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    expect(editControls('Node Status')).toBeInTheDocument();
    expect(
      screen.getByText('Drag a window to move it, and its edges to resize it.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryAllByRole('group')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });

  it('starts editing when the Modules settings ask', () => {
    renderGrid();
    act(() => executeEvent(HOME_EDIT_LAYOUT_EVENT, {}));
    expect(editControls('Wallet Activity')).toBeInTheDocument();
  });

  it('moves a window past its neighbour with the arrow keys', () => {
    const { onChangeGrid } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    fireEvent.keyDown(editControls('Node Status'), { key: 'ArrowDown' });
    const moved = onChangeGrid.mock.calls[0][0];
    expect(rectOf(moved, 'wallet')).toEqual([0, 0, 6, 30]);
    expect(rectOf(moved, 'status')).toEqual([0, 30, 6, 30]);

    fireEvent.keyDown(editControls('Node Status'), { key: 'ArrowRight' });
    expect(rectOf(onChangeGrid.mock.calls[1][0], 'status')?.[0]).toBe(1);
  });

  it('resizes a window with Shift and the arrow keys', () => {
    const { onChangeGrid } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    fireEvent.keyDown(editControls('Wallet Activity'), {
      key: 'ArrowDown',
      shiftKey: true,
    });
    expect(rectOf(onChangeGrid.mock.calls[0][0], 'wallet')).toEqual([
      0, 30, 6, 35,
    ]);

    // The account card's height follows its content: only its width changes.
    fireEvent.keyDown(editControls('Account Overview'), {
      key: 'ArrowDown',
      shiftKey: true,
    });
    expect(onChangeGrid).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(editControls('Account Overview'), {
      key: 'ArrowRight',
      shiftKey: true,
    });
    expect(rectOf(onChangeGrid.mock.calls[1][0], 'account')?.[2]).toBe(13);
  });

  it('hides a window with its button or Delete, but never the account card', () => {
    const { onHideWindow } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    fireEvent.click(screen.getByRole('button', { name: 'Hide Node Status' }));
    expect(onHideWindow).toHaveBeenLastCalledWith('status');
    fireEvent.keyDown(editControls('Torq Feed'), { key: 'Delete' });
    expect(onHideWindow).toHaveBeenLastCalledWith('feed');

    expect(
      screen.queryByRole('button', { name: 'Hide Account Overview' })
    ).toBeNull();
    fireEvent.keyDown(editControls('Account Overview'), { key: 'Delete' });
    expect(onHideWindow).toHaveBeenCalledTimes(2);
  });

  it('shows a hidden window again, and resets the layout', () => {
    const { onResetGrid, onShowWindow } = renderGrid({
      hiddenWindows: [{ id: 'groupActivity', title: 'Group Activity' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    fireEvent.click(screen.getByRole('button', { name: 'Show a window' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Group Activity' }));
    expect(onShowWindow).toHaveBeenCalledWith('groupActivity');

    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(onResetGrid).toHaveBeenCalledTimes(1);
  });

  it('moves a window dragged with the pointer', () => {
    const { onChangeGrid } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    const wallet = editControls('Wallet Activity');

    // jsdom lays nothing out: the grid is 1 px per column, 10 px per row.
    fireEvent.pointerDown(wallet, { button: 0, clientX: 50, clientY: 400 });
    fireEvent.pointerMove(wallet, { clientX: 50, clientY: 250 });
    fireEvent.pointerMove(wallet, { clientX: 50, clientY: 100 });
    fireEvent.pointerUp(wallet, { clientX: 50, clientY: 100 });

    const moved = onChangeGrid.mock.calls[0][0];
    expect(rectOf(moved, 'wallet')).toEqual([0, 0, 6, 30]);
    expect(rectOf(moved, 'status')).toEqual([0, 30, 6, 30]);
  });

  it('changes nothing for a press that does not move', () => {
    const { onChangeGrid } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    const wallet = editControls('Wallet Activity');
    fireEvent.pointerDown(wallet, { button: 0, clientX: 50, clientY: 400 });
    fireEvent.pointerUp(wallet, { clientX: 51, clientY: 401 });
    expect(onChangeGrid).not.toHaveBeenCalled();
  });
  it('offers to add a widget under the windows while editing', () => {
    const onAdd = vi.fn();
    renderGrid({
      addWidget: { description: 'In a window of its own.', onAdd },
    });
    expect(screen.queryByRole('button', { name: /Add widget/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('keeps the widget tile closed when Home is full', () => {
    const onAdd = vi.fn();
    renderGrid({
      addWidget: {
        description: 'You can have up to 8 widgets on Home.',
        disabled: true,
        onAdd,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));

    const tile = screen.getByRole('button', { name: /Add widget/ });
    expect(tile).toBeDisabled();
    expect(
      screen.getByText('You can have up to 8 widgets on Home.')
    ).toBeInTheDocument();
  });

  it("gives a widget's window its own buttons, and Delete removes it", () => {
    const clock = 'widget:GO%20Clock:' as HomeWindowId;
    const onReload = vi.fn();
    const windows: HomeGridWindow[] = [
      ...GRID.map((item) => ({
        id: item.key,
        node: <div>{`${TITLES[item.key]} content`}</div>,
        title: TITLES[item.key] ?? item.key,
      })),
      {
        actions: [
          { icon: <span />, label: 'Reload widget', onClick: onReload },
        ],
        id: clock,
        node: <div>Clock content</div>,
        title: 'Clock',
      },
    ];
    const { onHideWindow } = renderGrid({
      grid: [...GRID, { key: clock, x: 0, y: 60, w: 6, h: 20 }],
      windows,
    });
    expect(
      document.querySelector('[data-home-window="widget:GO%20Clock:"]')
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    const controls = screen.getByRole('group', {
      name: /^Clock: arrow keys move it/,
    });
    expect(
      within(controls).queryByRole('button', { name: 'Hide Clock' })
    ).toBeNull();
    fireEvent.click(
      within(controls).getByRole('button', { name: 'Reload widget' })
    );
    expect(onReload).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(controls, { key: 'Delete' });
    expect(onHideWindow).toHaveBeenCalledWith(clock);
  });
});
