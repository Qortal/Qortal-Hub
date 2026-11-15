import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../i18n/i18n';
import {
  nodeInfosAtom,
  reticulumEnabledAtom,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { darkTheme } from '../styles/theme-dark';
import { CoreSyncStatus } from './CoreSyncStatus';

const renderPanel = (url: string, status: Record<string, unknown>) => {
  const store = createStore();
  store.set(selectedNodeInfoAtom, { url } as never);
  store.set(nodeInfosAtom, status);
  store.set(reticulumEnabledAtom, false);
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <CoreSyncStatus panelOnly />
      </ThemeProvider>
    </Provider>
  );
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ buildVersion: 'qortal-6.1.9' }),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CoreSyncStatus panel', () => {
  it("shows the node's state, then its numbers", async () => {
    renderPanel('https://127.0.0.1:12391', {
      height: 2795692,
      isMintingPossible: true,
      numberOfConnections: 157,
      numberOfDataConnections: 16,
      syncPercent: 100,
    });

    expect(screen.getByText('Core information')).toBeInTheDocument();
    expect(screen.getByText('Minting on your own node')).toBeInTheDocument();
    expect(screen.getByText('Synchronized (100%)')).toBeInTheDocument();
    expect(screen.getByText('Minting')).toBeInTheDocument();
    expect(screen.getByText('2,795,692')).toBeInTheDocument();
    expect(screen.getByText('157')).toBeInTheDocument();
    expect(await screen.findByText('qortal-6.1.9')).toBeInTheDocument();
    // The gold cube while minting.
    expect(
      document.querySelector('[data-node-state="minting"]')?.getAttribute('src')
    ).toContain('minting');
  });

  it('says so on the public node, never minting', () => {
    renderPanel('https://ext-node.qortal.link', {
      isMintingPossible: true,
      isSynchronizing: true,
      syncPercent: 80,
    });

    expect(screen.getByText('Using a public node')).toBeInTheDocument();
    expect(screen.getByText('Synchronizing (80%)...')).toBeInTheDocument();
    expect(screen.getByText('Not minting')).toBeInTheDocument();
  });
});
