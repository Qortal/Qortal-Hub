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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { darkTheme } from '../../styles/theme-dark';

const stored = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../background/background', () => ({
  getApiKeyFromStorage: vi.fn(async () => stored.value),
}));

import { PeersSection } from './PeersSection';

const NODE = 'https://127.0.0.1:12391';
const PUBLIC = 'https://ext-node.qortal.link';
const KEY = 'test-key-1';
const HOUR = 60 * 60 * 1000;

const peer = (
  address: string,
  lastHeight: number,
  { direction = 'OUTBOUND', handshakeStatus = 'COMPLETED' } = {}
) => ({
  address,
  connectedWhen: Date.now() - 2 * HOUR,
  direction,
  handshakeStatus,
  lastHeight,
  lastPing: 80,
  version: 'qortal-6.1.9-abc',
});

/** Answers by "METHOD /path"; a function answers from the request body. */
let answers: Record<string, unknown>;

const respond = (body: unknown, status = 200) =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const route = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
  const answer = answers[route];
  if (answer === undefined) return respond({ error: 1 }, 404);
  if (typeof answer === 'function')
    return respond(await (answer as (body: unknown) => unknown)(init?.body));
  return respond(answer);
});

/** The requests that changed something on the node. */
const changes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
    .map(([url, init]) => ({
      body: init?.body,
      method: init?.method,
      path: new URL(url).pathname,
      key: new URL(url).searchParams.get('apiKey'),
    }));

const renderPeers = (isPublic = false, active = true) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <PeersSection
        active={active}
        isPublic={isPublic}
        nodeBase={isPublic ? PUBLIC : NODE}
      />
    </ThemeProvider>
  );

/** How many times the node was asked for `path`. */
const reads = (path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path
  ).length;

const card = (id: string) => {
  const element = document.querySelector(`[data-overview-card="${id}"]`);
  if (!element) throw new Error(`no ${id} card`);
  return within(element as HTMLElement);
};

const row = (address: string) => {
  const element = document.querySelector(`[data-peer="${address}"]`);
  if (!element) throw new Error(`no row for ${address}`);
  return within(element as HTMLElement);
};

const confirmDialog = async (title: string) =>
  within(await screen.findByRole('dialog', { name: title }));

/** Waits for every dialog to be gone: while one fades out, the page is hidden. */
const dialogsClosed = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

beforeEach(() => {
  stored.value = { apikey: KEY, url: NODE };
  answers = {
    'GET /peers': [
      peer('203.0.113.5:12392', 2000),
      peer('203.0.113.6:12392', 2001, { direction: 'INBOUND' }),
      peer('203.0.113.7:12392', 0, { handshakeStatus: 'STARTED' }),
    ],
    'GET /peers/data': [peer('198.51.100.2:12394', 0)],
    'GET /peers/known': [{}, {}, {}],
  };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PeersSection', () => {
  it("lists the node's peers, highest first, and won't force sync one still connecting", async () => {
    renderPeers();
    await screen.findByText('203.0.113.6:12392');

    const addresses = [
      ...document.querySelectorAll(
        '[data-overview-card="peer_list"] [data-peer]'
      ),
    ].map((element) => element.getAttribute('data-peer'));
    expect(addresses).toEqual([
      '203.0.113.6:12392',
      '203.0.113.5:12392',
      '203.0.113.7:12392',
    ]);
    expect(row('203.0.113.6:12392').getByText('in')).toBeInTheDocument();
    expect(row('203.0.113.6:12392').getByText('2,001')).toBeInTheDocument();
    expect(row('203.0.113.6:12392').getByText('6.1.9')).toBeInTheDocument();
    expect(
      row('203.0.113.7:12392').getByText('still connecting')
    ).toBeInTheDocument();
    expect(
      row('203.0.113.7:12392').getByRole('button', { name: 'Force sync' })
    ).toBeDisabled();
    expect(
      row('203.0.113.5:12392').getByRole('button', { name: 'Force sync' })
    ).toBeEnabled();
    expect(
      await card('known_peers').findByText(
        'Peers your node knows of: 3. It connects to some of them at a time.'
      )
    ).toBeInTheDocument();
  });

  it("adds a peer with Hub's key, and says when the node knew it already", async () => {
    answers['POST /peers'] = 'true';
    renderPeers();
    await screen.findByText('203.0.113.6:12392');

    fireEvent.click(screen.getByRole('button', { name: 'Add peer' }));
    const dialog = await confirmDialog('Add a peer');
    const field = dialog.getByRole('textbox', { name: 'Address' });
    fireEvent.change(field, { target: { value: 'not an address' } });
    fireEvent.blur(field);
    expect(
      dialog.getByText("That isn't an address the node can use.")
    ).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(changes()).toEqual([]);

    fireEvent.change(field, { target: { value: ' 198.51.100.7:12392 ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(
      await screen.findByText('Added 198.51.100.7:12392.')
    ).toBeInTheDocument();
    expect(changes()).toEqual([
      { body: '198.51.100.7:12392', key: KEY, method: 'POST', path: '/peers' },
    ]);
    await dialogsClosed();

    answers['POST /peers'] = 'false';
    fireEvent.click(screen.getByRole('button', { name: 'Add peer' }));
    const again = await confirmDialog('Add a peer');
    fireEvent.change(again.getByRole('textbox', { name: 'Address' }), {
      target: { value: '203.0.113.5:12392' },
    });
    fireEvent.click(again.getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByText('Your node already knew 203.0.113.5:12392.')
    ).toBeInTheDocument();
  });

  it("keeps the dialog open with the node's reason, until the address changes", async () => {
    answers['POST /peers'] = { error: 123, message: 'invalid address' };
    renderPeers();
    await screen.findByText('203.0.113.6:12392');

    fireEvent.click(screen.getByRole('button', { name: 'Add peer' }));
    const dialog = await confirmDialog('Add a peer');
    const field = dialog.getByRole('textbox', { name: 'Address' });
    fireEvent.change(field, { target: { value: 'node.example.org' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }));
    expect(
      await dialog.findByText("The node can't use that address.")
    ).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'node.example.org:12392' } });
    expect(dialog.queryByText("The node can't use that address.")).toBeNull();
  });

  it('removes a peer only after asking, also one missing from the known list', async () => {
    answers['DELETE /peers'] = 'true';
    renderPeers();
    await screen.findByText('203.0.113.5:12392');

    fireEvent.click(
      row('203.0.113.5:12392').getByRole('button', { name: 'Remove' })
    );
    const asked = await confirmDialog('Remove 203.0.113.5:12392?');
    fireEvent.click(asked.getByRole('button', { name: 'Cancel' }));
    await dialogsClosed();
    expect(changes()).toEqual([]);

    fireEvent.click(
      row('203.0.113.5:12392').getByRole('button', { name: 'Remove' })
    );
    fireEvent.click(
      (await confirmDialog('Remove 203.0.113.5:12392?')).getByRole('button', {
        name: 'Remove',
      })
    );
    expect(
      await screen.findByText('Removed 203.0.113.5:12392.')
    ).toBeInTheDocument();
    expect(changes()).toEqual([
      {
        body: '203.0.113.5:12392',
        key: KEY,
        method: 'DELETE',
        path: '/peers',
      },
    ]);
    await dialogsClosed();

    // An inbound peer's port is on no known list: Core answers "false" but
    // still disconnects it.
    answers['DELETE /peers'] = 'false';
    const knownReads = reads('/peers/known');
    fireEvent.click(
      row('203.0.113.6:12392').getByRole('button', { name: 'Remove' })
    );
    fireEvent.click(
      (await confirmDialog('Remove 203.0.113.6:12392?')).getByRole('button', {
        name: 'Remove',
      })
    );
    expect(
      await screen.findByText('Removed 203.0.113.6:12392.')
    ).toBeInTheDocument();
    // The known peers are counted again.
    await waitFor(() =>
      expect(reads('/peers/known')).toBeGreaterThan(knownReads)
    );
  });

  it('force syncs only after asking, and says how it ended', async () => {
    let result: unknown = 'NOTHING_TO_DO';
    answers['POST /admin/forcesync'] = () => result;
    renderPeers();
    await screen.findByText('203.0.113.5:12392');

    const forceSync = async (expected: string) => {
      fireEvent.click(
        row('203.0.113.5:12392').getByRole('button', { name: 'Force sync' })
      );
      fireEvent.click(
        (await confirmDialog('Force sync with 203.0.113.5:12392?')).getByRole(
          'button',
          { name: 'Force sync' }
        )
      );
      expect(await screen.findByText(expected)).toBeInTheDocument();
      await dialogsClosed();
    };

    await forceSync('Already level with this peer: nothing to sync.');
    expect(changes()).toEqual([
      {
        body: '203.0.113.5:12392',
        key: KEY,
        method: 'POST',
        path: '/admin/forcesync',
      },
    ]);
    result = 'TOO_DIVERGENT';
    await forceSync("This peer's chain is too far from your node's.");
    result = 'SOMETHING_NEW';
    await forceSync('Sync ended: SOMETHING_NEW.');
    // Core's answer when that peer isn't connected any more.
    result = { error: 115, message: 'invalid data' };
    await forceSync("Your node isn't connected to that peer any more.");
  });

  it('adds and removes QDN data peers', async () => {
    answers['POST /peers/data'] = 'true';
    answers['DELETE /peers/data'] = 'true';
    renderPeers();
    await screen.findByText('198.51.100.2:12394');

    fireEvent.click(screen.getByRole('button', { name: 'Add data peer' }));
    const dialog = await confirmDialog('Add a QDN data peer');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Address' }), {
      target: { value: '[2001:db8::5]:12394' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByText(
        'Your node added [2001:db8::5]:12394 for QDN data.'
      )
    ).toBeInTheDocument();
    await dialogsClosed();

    fireEvent.click(
      row('198.51.100.2:12394').getByRole('button', { name: 'Remove' })
    );
    fireEvent.click(
      (await confirmDialog('Remove 198.51.100.2:12394?')).getByRole('button', {
        name: 'Remove',
      })
    );
    expect(
      await screen.findByText('Removed 198.51.100.2:12394.')
    ).toBeInTheDocument();
    expect(changes()).toEqual([
      {
        body: '[2001:db8::5]:12394',
        key: KEY,
        method: 'POST',
        path: '/peers/data',
      },
      {
        body: '198.51.100.2:12394',
        key: KEY,
        method: 'DELETE',
        path: '/peers/data',
      },
    ]);
    await dialogsClosed();

    // Core's "false": it knew the peer already and couldn't connect now.
    answers['POST /peers/data'] = 'false';
    fireEvent.click(screen.getByRole('button', { name: 'Add data peer' }));
    const again = await confirmDialog('Add a QDN data peer');
    fireEvent.change(again.getByRole('textbox', { name: 'Address' }), {
      target: { value: '198.51.100.9:12394' },
    });
    fireEvent.click(again.getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByText(
        "Your node already knew 198.51.100.9:12394, but couldn't connect to it just now."
      )
    ).toBeInTheDocument();
  });

  it('keeps the add dialog as it is until the node answers', async () => {
    let answer: (text: string) => void = () => undefined;
    answers['POST /peers'] = () =>
      new Promise<string>((resolve) => {
        answer = resolve;
      });
    renderPeers();
    await screen.findByText('203.0.113.5:12392');

    fireEvent.click(screen.getByRole('button', { name: 'Add peer' }));
    const dialog = await confirmDialog('Add a peer');
    const field = dialog.getByRole('textbox', { name: 'Address' });
    fireEvent.change(field, { target: { value: '198.51.100.7:12392' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(changes()).toHaveLength(1));

    // The answer belongs to the address shown: nothing can change it or
    // close the dialog meanwhile.
    expect(field).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add a peer' }), {
      key: 'Escape',
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Still open, with its address (a closed dialog starts empty).
    expect(field).toHaveValue('198.51.100.7:12392');

    await act(async () => answer('true'));
    expect(
      await screen.findByText('Added 198.51.100.7:12392.')
    ).toBeInTheDocument();
    await dialogsClosed();

    // The next add goes ahead.
    answers['POST /peers'] = 'true';
    fireEvent.click(screen.getByRole('button', { name: 'Add peer' }));
    const next = await confirmDialog('Add a peer');
    fireEvent.change(next.getByRole('textbox', { name: 'Address' }), {
      target: { value: '198.51.100.8:12392' },
    });
    fireEvent.click(next.getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByText('Added 198.51.100.8:12392.')
    ).toBeInTheDocument();
  });

  it('reads nothing while another section is shown', async () => {
    const { rerender } = renderPeers(false, false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <ThemeProvider theme={darkTheme}>
        <PeersSection active isPublic={false} nodeBase={NODE} />
      </ThemeProvider>
    );
    expect(await screen.findByText('203.0.113.5:12392')).toBeInTheDocument();
    expect(reads('/peers/known')).toBe(1);
  });

  it('forgets all known peers after asking, then counts them again', async () => {
    answers['DELETE /peers/known'] = () => {
      answers['GET /peers/known'] = [];
      return 'true';
    };
    renderPeers();
    await card('known_peers').findByText(/knows of: 3\./);
    const peerReads = reads('/peers');

    fireEvent.click(
      screen.getByRole('button', { name: 'Forget all known peers' })
    );
    fireEvent.click(
      (await confirmDialog('Forget all known peers?')).getByRole('button', {
        name: 'Forget all known peers',
      })
    );
    expect(
      await screen.findByText('Your node forgot its known peers.')
    ).toBeInTheDocument();
    expect(await card('known_peers').findByText(/knows of: 0\./)).toBeTruthy();
    // Core drops its connections too: the list is read again.
    await waitFor(() => expect(reads('/peers')).toBeGreaterThan(peerReads));
    expect(changes()).toEqual([
      { body: undefined, key: KEY, method: 'DELETE', path: '/peers/known' },
    ]);
  });

  it("says why when Hub can't act on this node, without asking it", async () => {
    stored.value = { apikey: KEY, url: 'https://203.0.113.9:12391' };
    renderPeers();
    await screen.findByText('203.0.113.5:12392');

    fireEvent.click(
      row('203.0.113.5:12392').getByRole('button', { name: 'Remove' })
    );
    fireEvent.click(
      (await confirmDialog('Remove 203.0.113.5:12392?')).getByRole('button', {
        name: 'Remove',
      })
    );
    expect(
      await screen.findByText(
        "Hub's API key is for another node. Choose this node again to give Hub its key."
      )
    ).toBeInTheDocument();
    expect(changes()).toEqual([]);
  });

  it('on the public node, shows its peers with no way to change them', async () => {
    renderPeers(true);
    await screen.findByText('203.0.113.5:12392');

    expect(
      screen.getByText(
        "These are the public node's peers. Adding or removing peers needs your own node."
      )
    ).toBeInTheDocument();
    for (const name of ['Add peer', 'Add data peer', 'Remove', 'Force sync'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(
      document.querySelector('[data-overview-card="known_peers"]')
    ).toBeNull();
    const read = fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
    expect(read).not.toContain('/peers/known');
    expect(changes()).toEqual([]);
  });
});
