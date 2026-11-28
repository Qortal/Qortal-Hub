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
import { darkTheme } from '../../styles/theme-dark';

const stored = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../background/background', () => ({
  getApiKeyFromStorage: vi.fn(async () => stored.value),
}));

import { NodeManagerHost } from './NodeManager';
import { openNodeManager } from './nodeManagerEvents';

const NODE = 'https://127.0.0.1:12391';
const KEY = 'test-key-1';
const PEER = '203.0.113.5:12392';

const respond = (body: unknown, status = 200) =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

/** Force syncs the node is still working on. */
let syncs: { answer: (body: unknown) => void; signal?: AbortSignal | null }[];

const fetchMock = vi.fn(
  (url: string, init?: RequestInit): Promise<Response> => {
    const route = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    if (route === 'POST /admin/forcesync')
      return new Promise<Response>((resolve, reject) => {
        syncs.push({
          answer: (body) => resolve(respond(body)),
          signal: init?.signal,
        });
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    if (route === 'GET /peers')
      return Promise.resolve(
        respond([
          {
            address: PEER,
            connectedWhen: Date.now() - 60_000,
            direction: 'OUTBOUND',
            handshakeStatus: 'COMPLETED',
            lastHeight: 2000,
            lastPing: 80,
            version: 'qortal-6.1.9-abc',
          },
        ])
      );
    if (route === 'GET /peers/data' || route === 'GET /peers/known')
      return Promise.resolve(respond([]));
    return Promise.resolve(respond({ error: 1, message: 'unknown' }, 404));
  }
);

const store = getDefaultStore();

const nav = (name: string) => screen.getByRole('button', { name });

const row = (address: string) => {
  const element = document.querySelector(`[data-peer="${address}"]`);
  if (!element) throw new Error(`no row for ${address}`);
  return within(element as HTMLElement);
};

beforeEach(() => {
  stored.value = { apikey: KEY, url: NODE };
  syncs = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  store.set(reticulumEnabledAtom, false);
  store.set(appLockedAtom, false);
  store.set(isOpenCoreSetup, false);
  store.set(selectedNodeInfoAtom, { url: NODE } as never);
  store.set(nodeInfosAtom, {
    height: 2000,
    isMintingPossible: false,
    isSynchronizing: false,
    numberOfConnections: 1,
    syncPercent: 100,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NodeManager: what is under way across sections', () => {
  it('still says how a force sync ended after a look at the Overview', async () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <NodeManagerHost />
      </ThemeProvider>
    );
    act(() => openNodeManager('peers'));
    await screen.findByText(PEER);

    fireEvent.click(row(PEER).getByRole('button', { name: 'Force sync' }));
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: `Force sync with ${PEER}?` })
      ).getByRole('button', { name: 'Force sync' })
    );
    await screen.findByText(`Syncing with ${PEER}…`);
    expect(syncs).toHaveLength(1);
    // The question has faded out (the window behind it is hidden meanwhile).
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: `Force sync with ${PEER}?` })
      ).toBeNull()
    );

    // While the node syncs (minutes), the user checks the height and comes
    // back.
    fireEvent.click(nav('Overview'));
    fireEvent.click(nav('Peers'));
    await screen.findByText(PEER);

    // The sync is still under way, as before.
    expect(
      row(PEER).getByRole('button', { name: 'Force sync' })
    ).toBeDisabled();

    // The node finishes the sync it was asked for: how it ended shows, as
    // when the user stays on Peers.
    expect(syncs[0].signal?.aborted).toBe(false);
    syncs[0].answer('NOTHING_TO_DO');
    expect(
      await screen.findByText('Already level with this peer: nothing to sync.')
    ).toBeInTheDocument();
  });
});
