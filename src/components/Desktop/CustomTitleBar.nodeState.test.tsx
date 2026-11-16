import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { nodeInfosAtom, selectedNodeInfoAtom } from '../../atoms/global';
import { darkTheme } from '../../styles/theme-dark';
import {
  CustomTitleBar,
  type CustomTitleBarRightNavProps,
} from './CustomTitleBar';

vi.mock('../CoreSyncStatus', () => ({
  CoreSyncStatus: ({ panelOnly }: { panelOnly?: boolean }) => (
    <div>{panelOnly ? 'core information panel' : 'core icon'}</div>
  ),
}));

const rightNav = {} as CustomTitleBarRightNavProps;

const renderTitleBar = (
  node: { url: string } | null,
  status: Record<string, unknown> = {},
  nav: CustomTitleBarRightNavProps | null = rightNav
) => {
  const store = createStore();
  store.set(selectedNodeInfoAtom, node as never);
  store.set(nodeInfosAtom, status);
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

  it("opens the node's information from the title", async () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' });
    expect(logoState()).toBe('own');
    expect(screen.queryByText('core information panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Core information' }));

    expect(
      await screen.findByText('core information panel')
    ).toBeInTheDocument();
  });

  it("shows the node's information on hover, at once", async () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' });

    fireEvent.mouseOver(
      screen.getByRole('button', { name: 'Core information' })
    );

    expect(
      await screen.findByText('core information panel')
    ).toBeInTheDocument();
  });

  it('is only a title before signing in', () => {
    renderTitleBar({ url: 'https://127.0.0.1:12391' }, {}, null);
    expect(screen.getByText('Qortal Hub')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Core information' })
    ).toBeNull();
  });
});
