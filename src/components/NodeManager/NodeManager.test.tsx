import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import {
  isOpenCoreSetup,
  nodeInfosAtom,
  reticulumEnabledAtom,
  selectedNodeInfoAtom,
} from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import Base58Untyped from '../../encryption/Base58';
import { darkTheme } from '../../styles/theme-dark';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { NodeManagerHost } from './NodeManager';
import { nodeManagerOpenAtom, openNodeManager } from './nodeManagerEvents';

// Base58.ts has no types of its own.
const Base58 = Base58Untyped as unknown as {
  encode: (bytes: Uint8Array) => string;
};

const NODE = 'https://127.0.0.1:12391';
const HOUR = 60 * 60 * 1000;
// The last block's signature, as the node gives it: base58 in /blocks/last,
// base64 in /peers.
const SIGNATURE = Uint8Array.from({ length: 128 }, (_, i) => (i * 11) % 256);
const SIGNATURE_BASE58 = Base58.encode(SIGNATURE);
const SIGNATURE_BASE64 = btoa(String.fromCharCode(...SIGNATURE));

const peer = (direction: string, lastHeight = 2000) => ({
  direction,
  handshakeStatus: 'COMPLETED',
  lastBlockSignature: SIGNATURE_BASE64,
  lastHeight,
  lastPing: 80,
  version: 'qortal-6.1.9-abc',
});

let answers: Record<string, unknown>;
let failing: Set<string>;
let hanging: Set<string>;

const respond = (body: unknown, ok = true) =>
  ({
    json: async () => body,
    ok,
    status: ok ? 200 : 503,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

const pathOf = (url: unknown) =>
  String(url)
    .replace(/^https:\/\/[^/]+/, '')
    .split('?')[0];

const fetchMock = vi.fn(async (url: string) => {
  const path = pathOf(url);
  if (hanging.has(path)) return new Promise<Response>(() => undefined);
  if (failing.has(path)) return respond('unavailable', false);
  if (path in answers) return respond(answers[path]);
  if (path.startsWith('/blocks/')) return respond([]);
  return respond({ error: 1, message: 'unknown' });
});

const store = getDefaultStore();

const renderHost = (url = NODE) => {
  store.set(selectedNodeInfoAtom, { url } as never);
  store.set(nodeInfosAtom, {
    height: 2000,
    isMintingPossible: false,
    isSynchronizing: false,
    numberOfConnections: 3,
    numberOfDataConnections: 1,
    syncPercent: 100,
  });
  render(
    <ThemeProvider theme={darkTheme}>
      <NodeManagerHost />
    </ThemeProvider>
  );
};

const open = async () => {
  act(() => openNodeManager());
  return screen.findByRole('dialog', { name: 'Node Manager' });
};

const card = (id: string) => {
  const element = document.querySelector(`[data-overview-card="${id}"]`);
  if (!element) throw new Error(`no ${id} card`);
  return within(element as HTMLElement);
};

beforeEach(() => {
  answers = {
    '/admin/info': {
      buildTimestamp: 1793135952,
      buildVersion: 'qortal-6.1.9-abc',
      currentTimestamp: Date.now(),
      isTestNet: false,
      nodeId: 'node-1',
      type: 'full',
      uptime: 2 * HOUR,
    },
    '/admin/mintingaccounts': [],
    '/admin/settings/apiWhitelistEnabled': 'true',
    '/admin/settings/autoUpdateEnabled': 'false',
    '/admin/settings/listenPort': 'null',
    '/admin/settings/maxDataPeers': '64',
    '/admin/settings/relayModeEnabled': 'true',
    '/admin/settings/uPnPEnabled': 'true',
    '/admin/summary': { blockCount: 1440, totalTransactionCount: 99 },
    '/addresses/online/levels': [
      { count: 2, level: 1 },
      { count: 3, level: 5 },
    ],
    '/admin/systeminfo': {
      availableProcessors: 8,
      maxMemory: 8_000_000_000,
      memoryInUse: 2_000_000_000,
    },
    '/blocks/last': {
      height: 2000,
      minterLevel: 3,
      // Core 6.1.9 leaves this at 0: not read.
      onlineAccountsCount: 0,
      signature: SIGNATURE_BASE58,
      timestamp: Date.now() - 30_000,
      totalFees: '0.01000000',
      transactionCount: 2,
    },
    '/peers': [peer('OUTBOUND'), peer('OUTBOUND', 2001), peer('INBOUND')],
    '/peers/data': [peer('OUTBOUND')],
  };
  failing = new Set();
  hanging = new Set();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  store.set(reticulumEnabledAtom, false);
  store.set(appLockedAtom, false);
  store.set(isOpenCoreSetup, false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  store.set(appLockedAtom, false);
});

describe('NodeManager', () => {
  it("opens on its event and shows the node's details in full", async () => {
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();

    await open();

    // Peers: two out, one in, from the node's own list.
    expect(await card('peers').findByText('2 out · 1 in')).toBeInTheDocument();
    expect(
      card('peers').getByText('1 ahead · 2 level · 0 behind')
    ).toBeInTheDocument();
    expect(card('peers').getByText('6.1.9')).toBeInTheDocument();
    // The highest peer is one block ahead.
    expect(card('sync').getByText('2,001')).toBeInTheDocument();
    expect(card('sync').getByText('2 of 2 at this height')).toBeInTheDocument();
    // Minters online now: 2 + 3, from their own list.
    expect(await card('blocks').findByText('5')).toBeInTheDocument();
    expect(card('blocks').getByText('0.01 QORT')).toBeInTheDocument();
    expect(await card('data_peers').findByText('64')).toBeInTheDocument();
    expect(await card('node').findByText('Full node')).toBeInTheDocument();
    expect(card('node').getByText('2 GB of 8 GB')).toBeInTheDocument();
    expect(
      card('minting').getByText('No minting key is on this node yet.')
    ).toBeInTheDocument();
    expect(
      card('reticulum').getByText('Reticulum is turned off in Hub.')
    ).toBeInTheDocument();
  });

  it('says what helps the network, with the port to open', async () => {
    answers['/peers'] = [peer('OUTBOUND')];
    answers['/admin/settings/relayModeEnabled'] = 'false';
    renderHost();
    await open();

    const help = card('help');
    expect(
      await help.findByText(
        'No other node has connected to yours yet. Opening port 12392 on your router lets them.'
      )
    ).toBeInTheDocument();
    expect(
      await help.findByText(
        'Relay mode is off. With it on, your node passes QDN data on to others.'
      )
    ).toBeInTheDocument();
    expect(help.getByText('QDN data peers connected: 1.')).toBeInTheDocument();
  });

  it("doesn't take reads still under way for answers", async () => {
    hanging.add('/admin/mintingaccounts');
    hanging.add('/peers');
    renderHost();
    await open();
    await card('node').findByText('Full node');

    // The minting keys are still being read: no "couldn't read" yet.
    expect(
      card('minting').queryByText("Couldn't read this node's minting keys.")
    ).toBeNull();
    expect(card('minting').getByText('Loading...')).toBeInTheDocument();
    // Nothing is said about newer Core before the peers are read.
    expect(
      card('help').queryByText("Core is as new as your peers'.")
    ).toBeNull();
    expect(card('node').queryByText('None')).toBeNull();
  });

  it('warns when the API whitelist is off', async () => {
    answers['/admin/settings/apiWhitelistEnabled'] = 'false';
    renderHost();
    await open();
    expect(
      await card('node').findByText(
        "Any device that can reach this PC can call this node's API. Admin actions still need the API key."
      )
    ).toBeInTheDocument();
  });

  it('never opens while Hub is locked, and closes when it locks', async () => {
    renderHost();
    // Hub has been locked a while before anything asks for the window.
    act(() => store.set(appLockedAtom, true));
    act(() => openNodeManager());
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => store.set(appLockedAtom, false));
    await open();
    act(() => store.set(appLockedAtom, true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('makes way for the minting window', async () => {
    const onMinting = vi.fn();
    subscribeToEvent('openMintingPanel', onMinting);
    try {
      renderHost();
      await open();
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Minting (opens the minting window)',
        })
      );
      expect(onMinting).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } finally {
      unsubscribeFromEvent('openMintingPanel', onMinting);
    }
  });

  it('closes with its close button', async () => {
    renderHost();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says it is open, for the node cards on hover to stay shut', async () => {
    renderHost();
    expect(store.get(nodeManagerOpenAtom)).toBe(false);
    await open();
    expect(store.get(nodeManagerOpenAtom)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(store.get(nodeManagerOpenAtom)).toBe(false));

    // Signing out takes the window away while it's open.
    await open();
    expect(store.get(nodeManagerOpenAtom)).toBe(true);
    cleanup();
    expect(store.get(nodeManagerOpenAtom)).toBe(false);
  });

  it("on a public node, offers a node of the user's own and reads none of its admin parts", async () => {
    renderHost('https://ext-node.qortal.link');
    await open();

    expect(
      card('public').getByText("You're on a public node")
    ).toBeInTheDocument();
    expect(
      card('minting').getByText('Minting needs your own node.')
    ).toBeInTheDocument();
    expect(document.querySelector('[data-overview-card="help"]')).toBeNull();
    // The minting window refuses the public node: no way in from here.
    expect(
      screen.queryByRole('button', { name: /opens the minting window/i })
    ).toBeNull();
    await card('peers').findByText('2 out · 1 in');
    const read = fetchMock.mock.calls.map(([url]) => pathOf(url));
    expect(read).not.toContain('/admin/mintingaccounts');
    expect(read).not.toContain('/admin/systeminfo');
    expect(read.some((path) => path.startsWith('/admin/settings'))).toBe(false);

    fireEvent.click(
      card('public').getByRole('button', { name: 'Set up my own node' })
    );
    expect(store.get(isOpenCoreSetup)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a failed read with Retry, which reads again', async () => {
    failing.add('/admin/mintingaccounts');
    renderHost();
    await open();

    const minting = card('minting');
    expect(
      await minting.findByText("Couldn't read this node's minting keys.")
    ).toBeInTheDocument();
    expect(
      minting.getByText("Couldn't read this from the node.")
    ).toBeInTheDocument();

    failing.clear();
    answers['/admin/mintingaccounts'] = [{ publicKey: 'key' }];
    fireEvent.click(minting.getByRole('button', { name: 'Retry' }));
    expect(
      await minting.findByText(
        "This node has a minting key, but it isn't minting right now. It mints once it's synchronized and has enough peers."
      )
    ).toBeInTheDocument();
  });

  it('starts over after a failure, closing and opening again', async () => {
    failing.add('/peers');
    renderHost();
    await open();
    expect(
      await card('peers').findByText("Couldn't read this from the node.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    failing.clear();
    await open();
    expect(await card('peers').findByText('2 out · 1 in')).toBeInTheDocument();
    expect(
      card('peers').queryByText("Couldn't read this from the node.")
    ).toBeNull();
  });
});
