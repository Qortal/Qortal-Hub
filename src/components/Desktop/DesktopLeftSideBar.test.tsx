import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { DesktopSideBar } from './DesktopLeftSideBar';
import { sidePanelStorageKey } from './sidePanel';

vi.mock('../CoreSyncStatus', () => ({
  CoreSyncStatus: ({ renderIcon }: { renderIcon?: React.ReactNode }) => (
    <span data-testid="core-sync-status">{renderIcon ?? null}</span>
  ),
}));
vi.mock('../Language/LanguageSelector', () => ({
  default: () => <div>language selector</div>,
}));
vi.mock('../Theme/ThemeSelector', () => ({
  default: () => <div>theme selector</div>,
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://node',
}));
vi.mock('../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/events')>()),
  executeEvent: vi.fn(),
}));

const ALICE = 'QaliceAddress00000000000000000000';

const renderPanel = (settings?: unknown) => {
  if (settings) {
    localStorage.setItem(sidePanelStorageKey(ALICE), JSON.stringify(settings));
  }
  const store = createStore();
  store.set(userInfoAtom, { address: ALICE, name: 'alice' });
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <DesktopSideBar
          desktopViewMode="home"
          goToHome={vi.fn()}
          hasUnreadDirects={false}
          isApps={false}
          setAppsModeDev={vi.fn()}
          setDesktopViewMode={vi.fn()}
        />
      </ThemeProvider>
    </Provider>
  );
};

afterEach(() => {
  localStorage.clear();
  vi.mocked(executeEvent).mockClear();
});

describe('DesktopSideBar', () => {
  it('waits at the left edge by default, with its own buttons', () => {
    renderPanel();
    expect(document.querySelector('[data-side-panel="hover"]')).not.toBeNull();
    expect(screen.getByLabelText('Move sidebar handle')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit side panel' })
    ).toBeInTheDocument();
  });

  it('stays open beside the content, and opens an added Q-App', () => {
    renderPanel({
      background: 0.3,
      items: [
        { kind: 'qdn', name: 'Q-Tube', service: 'APP' },
        { kind: 'home' },
      ],
      show: 'always',
    });
    expect(document.querySelector('[data-side-panel="always"]')).not.toBeNull();
    // No edge handle: it doesn't hide.
    expect(screen.queryByLabelText('Move sidebar handle')).toBeNull();

    fireEvent.click(screen.getByText('Q-Tube'));

    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: { name: 'Q-Tube', service: 'APP' },
    });
    expect(executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('leaves out hidden buttons, and keeps the node status running', () => {
    renderPanel({
      items: [
        { kind: 'home' },
        { hidden: true, kind: 'info' },
        { hidden: true, kind: 'language' },
        { hidden: true, kind: 'theme' },
      ],
    });
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Info')).toBeNull();
    expect(screen.queryByText('language selector')).toBeNull();
    expect(screen.queryByText('theme selector')).toBeNull();
    // Out of sight, it still keeps the P2P health others read.
    expect(screen.getAllByTestId('core-sync-status')).toHaveLength(1);
  });

  it('makes room for bigger buttons', () => {
    renderPanel({ buttonSize: 1.25, show: 'always' });
    expect(document.querySelector('[data-side-panel="always"]')).toHaveStyle({
      width: '90px',
    });
  });

  it("sizes its edge handle, and shows only the handle's outline", () => {
    renderPanel({ handleBackground: 0, handleHeight: 160 });
    const handle = screen.getByLabelText('Move sidebar handle');
    expect(handle).toHaveStyle({ height: '160px' });
    expect(getComputedStyle(handle).background).toBe('rgba(255, 255, 255, 0)');
  });

  it('closes once the pointer is away, even after leaving over its handle', () => {
    vi.useFakeTimers();
    try {
      renderPanel();
      const handle = screen.getByLabelText('Move sidebar handle');
      const column = document.querySelector(
        '[data-side-panel="hover"]'
      ) as HTMLElement;
      fireEvent.mouseEnter(handle);
      expect(column).toHaveStyle({ pointerEvents: 'auto' });

      // From the panel back over its handle: the handle keeps it open.
      fireEvent.mouseEnter(column);
      fireEvent.mouseLeave(column);
      fireEvent.mouseEnter(handle);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(column).toHaveStyle({ pointerEvents: 'auto' });

      // Then onto the page, which sends the panel no mouseleave.
      fireEvent.pointerMove(document.body);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(column).toHaveStyle({ pointerEvents: 'none' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays open while the pointer is on it, its handle or a menu it opened', () => {
    vi.useFakeTimers();
    const menu = document.createElement('div');
    menu.className = 'MuiModal-root';
    document.body.appendChild(menu);
    try {
      renderPanel();
      const handle = screen.getByLabelText('Move sidebar handle');
      const column = document.querySelector(
        '[data-side-panel="hover"]'
      ) as HTMLElement;
      fireEvent.mouseEnter(handle);

      fireEvent.pointerMove(screen.getByText('Home'));
      fireEvent.pointerMove(handle);
      fireEvent.pointerMove(menu);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(column).toHaveStyle({ pointerEvents: 'auto' });
    } finally {
      menu.remove();
      vi.useRealTimers();
    }
  });

  it('opens from anywhere along the left edge when its handle is off', () => {
    vi.useFakeTimers();
    try {
      renderPanel({ edgeHandle: false });
      expect(screen.queryByLabelText('Move sidebar handle')).toBeNull();
      const edge = document.querySelector(
        '[data-side-panel-edge="edge"]'
      ) as HTMLElement;
      expect(edge).toHaveStyle({ bottom: '0px', top: '0px' });
      const column = document.querySelector(
        '[data-side-panel="hover"]'
      ) as HTMLElement;
      expect(column).toHaveStyle({ pointerEvents: 'none' });

      fireEvent.mouseEnter(edge);
      act(() => {
        vi.advanceTimersByTime(10);
      });

      expect(column).toHaveStyle({ pointerEvents: 'auto' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens its editor', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit side panel' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Side panel');
  });
});
