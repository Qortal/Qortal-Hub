import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { nodeInfosAtom, selectedNodeInfoAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import { executeEvent } from '../../utils/events';
import { nodeManagerOpenAtom } from '../NodeManager/nodeManagerEvents';
import {
  CustomTitleBar,
  type CustomTitleBarRightNavProps,
} from './CustomTitleBar';

vi.mock('../CoreSyncStatus', () => ({
  CoreSyncStatus: ({
    onOpenNodeManager,
    panelOnly,
  }: {
    onOpenNodeManager?: () => void;
    panelOnly?: boolean;
  }) => (
    <div>
      {panelOnly ? 'core information panel' : 'core icon'}
      {onOpenNodeManager ? (
        <button onClick={onOpenNodeManager}>panel: node manager</button>
      ) : null}
    </div>
  ),
}));
vi.mock('../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/events')>()),
  executeEvent: vi.fn(),
}));

const rightNav = {} as CustomTitleBarRightNavProps;

const renderTitleBar = (
  node: { url: string } | null,
  status: Record<string, unknown> = {},
  nav: CustomTitleBarRightNavProps | null = rightNav,
  { nodeManagerOpen = false } = {}
) => {
  const store = createStore();
  store.set(selectedNodeInfoAtom, node as never);
  store.set(nodeInfosAtom, status);
  store.set(nodeManagerOpenAtom, nodeManagerOpen);
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <CustomTitleBar rightNav={nav} />
      </ThemeProvider>
    </Provider>
  );
};

const logoState = () =>
  document.querySelector('[data-node-state]')?.getAttribute('data-node-state');

afterEach(() => {
  vi.mocked(executeEvent).mockClear();
});

describe('CustomTitleBar', () => {
  it('shows the node the Hub is on in the logo', () => {
    renderTitleBar({ url: 'https://ext-node.qortal.link' });
    expect(logoState()).toBe('public');
  });

  it('shows minting on an own node', () => {
    renderTitleBar(
      { url: 'https://127.0.0.1:12391' },
      { isMintingPossible: true }
    );
    expect(logoState()).toBe('minting');
  });

  it('opens the Node Manager from the title', () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' });
    expect(logoState()).toBe('own');

    fireEvent.click(screen.getByRole('button', { name: 'Open Node Manager' }));

    expect(executeEvent).toHaveBeenCalledWith('openNodeManager', {
      section: 'overview',
    });
  });

  it("shows the node's information on hover, at once", async () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' });
    expect(screen.queryByText('core information panel')).toBeNull();

    fireEvent.mouseOver(
      screen.getByRole('button', { name: 'Open Node Manager' })
    );

    expect(
      await screen.findByText('core information panel')
    ).toBeInTheDocument();
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('shows no information over the Node Manager itself', () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' }, {}, rightNav, {
      nodeManagerOpen: true,
    });

    fireEvent.mouseOver(
      screen.getByRole('button', { name: 'Open Node Manager' })
    );

    expect(screen.queryByText('core information panel')).toBeNull();
  });

  it("opens the Node Manager from the information's own button", async () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' });
    fireEvent.mouseOver(
      screen.getByRole('button', { name: 'Open Node Manager' })
    );

    fireEvent.click(await screen.findByText('panel: node manager'));

    expect(executeEvent).toHaveBeenCalledWith('openNodeManager', {
      section: 'overview',
    });
  });

  it('is only a title before signing in', () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' }, {}, null);
    expect(screen.getByText('Qortal Hub')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open Node Manager' })
    ).toBeNull();
  });
});
