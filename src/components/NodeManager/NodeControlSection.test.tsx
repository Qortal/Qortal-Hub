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
import { nodeInfosAtom } from '../../atoms/global';
import { READ_TIMEOUT_MS } from './useNodeOverviewData';
import { darkTheme } from '../../styles/theme-dark';

const stored = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../background/background', () => ({
  getApiKeyFromStorage: vi.fn(async () => stored.value),
}));

import {
  CORE_CHECK_MS,
  LOG_LINES,
  NodeControlSection,
  START_WAIT_MS,
} from './NodeControlSection';

const NODE = 'https://127.0.0.1:12391';
const OTHER_PC = 'https://203.0.113.9:12391';
const KEY = 'test-key-1';
const HOUR = 60 * 60 * 1000;
const ASKED =
  'Hub asked Core to start. The node takes a little while to answer.';
const NOT_ANSWERING =
  "Core still isn't answering. If it doesn't start, start it the way you usually do.";
const STILL_RUNNING =
  'Core is still running on this PC. Hub can start it again once it has stopped.';

/** Answers by "METHOD /path". */
let answers: Record<string, unknown>;
/** Paths that fail as a node that's down would. */
let down: Set<string>;
/** Paths a stuck node takes but never answers. */
let stuck: Set<string>;

const respond = (body: unknown, status = 200) =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const { pathname } = new URL(url);
  if (stuck.has(pathname))
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError'))
      )
    );
  if (down.has(pathname)) throw new TypeError('Failed to fetch');
  const answer = answers[`${init?.method ?? 'GET'} ${pathname}`];
  return answer === undefined ? respond({ error: 1 }, 404) : respond(answer);
});

const requests = (path: string) =>
  fetchMock.mock.calls
    .map(([url]) => new URL(url))
    .filter((url) => url.pathname === path);

const store = getDefaultStore();

const renderControl = (nodeBase = NODE, active = true) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <NodeControlSection active={active} nodeBase={nodeBase} />
    </ThemeProvider>
  );

/** Ten seconds on: one more read of whether the node answers. */
const nextUptimeRead = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });

const confirmChange = async (button: string, title: string) => {
  fireEvent.click(screen.getByRole('button', { name: button }));
  fireEvent.click(
    within(await screen.findByRole('dialog', { name: title })).getByRole(
      'button',
      { name: button }
    )
  );
};

const card = (id: string) => {
  const element = document.querySelector(`[data-overview-card="${id}"]`);
  if (!element) throw new Error(`no ${id} card`);
  return within(element as HTMLElement);
};

const dialogsClosed = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };

beforeEach(() => {
  stored.value = { apikey: KEY, url: NODE };
  answers = {
    'GET /admin/apikey/test': 'true',
    'GET /admin/bootstrap': 'true',
    'GET /admin/info': {
      buildVersion: 'qortal-6.1.9-abc',
      nodeId: 'node-1',
      uptime: 2 * HOUR,
    },
    'GET /admin/logs': '2026-11-21 00:00:00 INFO Controller - Node started\n',
    'GET /admin/restart': 'true',
    'GET /admin/stop': 'true',
    'GET /admin/systeminfo': {
      availableProcessors: 8,
      maxMemory: 8_000_000_000,
      memoryInUse: 2_000_000_000,
    },
    'GET /admin/uptime': String(2 * HOUR),
  };
  down = new Set();
  stuck = new Set();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  clipboard.writeText.mockReset();
  clipboard.writeText.mockImplementation(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
  store.set(nodeInfosAtom, {
    height: 2000,
    isMintingPossible: true,
    isSynchronizing: false,
    numberOfConnections: 3,
    numberOfDataConnections: 1,
    syncPercent: 100,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { coreSetup?: unknown }).coreSetup;
});

describe('NodeControlSection', () => {
  it("checks Hub's API key for the node when it opens", async () => {
    renderControl();
    expect(
      await card('control_key').findByText("Hub's API key for this node works.")
    ).toBeInTheDocument();
    expect(requests('/admin/apikey/test')[0].searchParams.get('apiKey')).toBe(
      KEY
    );
  });

  it('says when the node refuses the key, or Hub has none', async () => {
    answers['GET /admin/apikey/test'] = { error: 4, message: 'unauthorized' };
    renderControl();
    expect(
      await card('control_key').findByText("The node refused Hub's API key.")
    ).toBeInTheDocument();
    cleanup();

    stored.value = null;
    fetchMock.mockClear();
    renderControl();
    expect(
      await card('control_key').findByText('Hub has no API key for this node.')
    ).toBeInTheDocument();
    expect(requests('/admin/apikey/test')).toEqual([]);
  });

  it('restarts the node only after asking', async () => {
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");

    fireEvent.click(screen.getByRole('button', { name: 'Restart node' }));
    const asked = within(
      await screen.findByRole('dialog', { name: 'Restart the node?' })
    );
    fireEvent.click(asked.getByRole('button', { name: 'Cancel' }));
    await dialogsClosed();
    expect(requests('/admin/restart')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Restart node' }));
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Restart the node?' })
      ).getByRole('button', { name: 'Restart node' })
    );
    expect(
      await card('control_restart').findByText('The node is restarting.')
    ).toBeInTheDocument();
    expect(requests('/admin/restart')).toHaveLength(1);
    expect(requests('/admin/restart')[0].searchParams.get('apiKey')).toBe(KEY);
  });

  it('stops and bootstraps the node after asking, with red buttons', async () => {
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");

    for (const [button, title, done, path] of [
      ['Stop node', 'Stop the node?', 'The node is stopping.', '/admin/stop'],
      [
        'Bootstrap node',
        'Bootstrap the node?',
        'The node is restarting to bootstrap.',
        '/admin/bootstrap',
      ],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: button }));
      const confirm = within(
        await screen.findByRole('dialog', { name: title })
      ).getByRole('button', { name: button });
      expect(confirm.className).toMatch(/containedError/);
      fireEvent.click(confirm);
      expect(await screen.findByText(done)).toBeInTheDocument();
      expect(requests(path)).toHaveLength(1);
      await dialogsClosed();
    }
  });

  it("says why when the node doesn't do it", async () => {
    answers['GET /admin/restart'] = { error: 8, message: 'no time sync' };
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    fireEvent.click(screen.getByRole('button', { name: 'Restart node' }));
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Restart the node?' })
      ).getByRole('button', { name: 'Restart node' })
    );
    expect(
      await card('control_restart').findByText(
        "The node's clock isn't synced yet. Try again in a minute."
      )
    ).toBeInTheDocument();
    expect(
      card('control_restart').queryByText('The node is restarting.')
    ).toBeNull();
  });

  it('offers to start Core only once the node on this PC stopped answering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = { startCore } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");

    // Stopped, but still answering while it shuts down: a start now would do
    // nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Stop node' }));
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Stop the node?' })
      ).getByRole('button', { name: 'Stop node' })
    );
    await screen.findByText('The node is stopping.');
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();

    down.add('/admin/uptime');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Start Core' }));
    expect(startCore).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ASKED)).toBeInTheDocument();

    // It answers again: nothing left to start, and it isn't stopping.
    down.delete('/admin/uptime');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull()
    );
    expect(
      card('control_stop').queryByText('The node is stopping.')
    ).toBeNull();

    // Down again later: a fresh start, with nothing left over from the last.
    down.add('/admin/uptime');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      await screen.findByRole('button', { name: 'Start Core' })
    ).toBeEnabled();
    expect(screen.queryByText(ASKED)).toBeNull();
  });

  it("says so when Core still isn't answering after a while", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.coreSetup = {
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    down.add('/admin/uptime');
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: 'Start Core' }));
    await screen.findByText(ASKED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_WAIT_MS);
    });
    expect(
      await screen.findByText(
        "Core still isn't answering. If it doesn't start, start it the way you usually do."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Core' })).toBeEnabled();
  });

  it("doesn't greet the next stop with the last start's \"still isn't answering\"", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.coreSetup = {
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    down.add('/admin/uptime');
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: 'Start Core' }));
    await screen.findByText(ASKED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_WAIT_MS);
    });
    await screen.findByText(NOT_ANSWERING);

    // Core was only slow.
    down.delete('/admin/uptime');
    await nextUptimeRead();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull()
    );

    // Later the node stops again: a fresh offer.
    down.add('/admin/uptime');
    await nextUptimeRead();
    await screen.findByRole('button', { name: 'Start Core' });
    expect(screen.queryByText(NOT_ANSWERING)).toBeNull();
  });

  it("doesn't offer a second start beside a restart or bootstrap asked for here", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.coreSetup = {
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");

    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();
    // Core restarts itself: its API is gone for a minute or two.
    down.add('/admin/uptime');
    await nextUptimeRead();
    await nextUptimeRead();
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();

    // Back again: the restart is over.
    down.delete('/admin/uptime');
    await nextUptimeRead();
    await waitFor(() =>
      expect(
        card('control_restart').queryByText('The node is restarting.')
      ).toBeNull()
    );

    await confirmChange('Bootstrap node', 'Bootstrap the node?');
    await screen.findByText('The node is restarting to bootstrap.');
    down.add('/admin/uptime');
    await nextUptimeRead();
    await nextUptimeRead();
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
  });

  it('notices a restart from elsewhere by its uptime starting over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');

    // Back between two reads: never seen down, but it has run 5 seconds.
    answers['GET /admin/uptime'] = '5000';
    await nextUptimeRead();
    await waitFor(() =>
      expect(
        card('control_restart').queryByText('The node is restarting.')
      ).toBeNull()
    );
  });

  it('waits for Core to stop on this PC before offering to start it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let running = true;
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      isCoreRunningOnSystem: vi.fn(async () => running),
      startCore,
    } as unknown as typeof window.coreSetup;
    down.add('/admin/uptime');
    renderControl();

    // Shutting down: its process still runs, and a start would do nothing.
    expect(await screen.findByText(STILL_RUNNING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();

    running = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CORE_CHECK_MS);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Start Core' }));
    expect(startCore).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ASKED)).toBeInTheDocument();
    expect(screen.queryByText(STILL_RUNNING)).toBeNull();
  });

  it("doesn't offer to start a Core that isn't where Hub installs it", async () => {
    const isCoreInstalledOnSystem = vi.fn(async () => false);
    window.coreSetup = {
      isCoreInstalledOnSystem,
      isCoreRunningOnSystem: vi.fn(async () => false),
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    down.add('/admin/uptime');
    renderControl();
    await waitFor(() => expect(isCoreInstalledOnSystem).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
    expect(screen.queryByText(STILL_RUNNING)).toBeNull();
  });

  it('checks the key again once the node is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    down.add('/admin/uptime');
    down.add('/admin/apikey/test');
    renderControl();
    expect(
      await card('control_key').findByText(
        "That didn't work: the node may be busy or offline. Try again."
      )
    ).toBeInTheDocument();

    down.clear();
    await nextUptimeRead();
    expect(
      await card('control_key').findByText("Hub's API key for this node works.")
    ).toBeInTheDocument();
  });

  it('reads nothing while another section is shown', async () => {
    renderControl(NODE, false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(requests('/admin/uptime')).toEqual([]);
  });

  it("doesn't offer to start Core for a node on another PC", async () => {
    window.coreSetup = {
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    stored.value = { apikey: KEY, url: OTHER_PC };
    down.add('/admin/uptime');
    renderControl(OTHER_PC);
    await card('control_key').findByText("Hub's API key for this node works.");
    await waitFor(() =>
      expect(requests('/admin/uptime').length).toBeGreaterThan(0)
    );
    // Give the failed read time to land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
  });

  it('copies a status for a help chat, with no addresses, IDs or keys', async () => {
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    expect(
      await card('control_support').findByText('Copied!')
    ).toBeInTheDocument();

    const text = clipboard.writeText.mock.calls[0][0];
    expect(text).toContain('Core version: qortal-6.1.9-abc');
    expect(text).toContain("Node: This PC's node");
    expect(text).toContain('Peers: 3');
    expect(text).toContain('2 GB of 8 GB');
    for (const secret of ['127.0.0.1', '12391', KEY, 'node-1'])
      expect(text).not.toContain(secret);
  });

  it("gives the status copy back when a stuck node doesn't answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stuck.add('/admin/info');
    stuck.add('/admin/systeminfo');
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    // As long as the window waits for any of its other reads.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    });
    expect(
      await card('control_support').findByText('Copied!')
    ).toBeInTheDocument();
    expect(clipboard.writeText.mock.calls[0][0]).toContain('Core version: —');
    expect(
      card('control_support').getByRole('button', { name: 'Copy status' })
    ).toBeEnabled();
  });

  it("doesn't call the node synchronized without Hub's status for it", async () => {
    // What Hub holds once its websocket to the node closed.
    store.set(nodeInfosAtom, {});
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    await card('control_support').findByText('Copied!');
    const text = clipboard.writeText.mock.calls[0][0];
    expect(text).not.toMatch(/Synchronized/);
    expect(text).toContain("This node's height: —");
  });

  it('copies nothing once the window is gone', async () => {
    stuck.add('/admin/info');
    stuck.add('/admin/systeminfo');
    const { unmount } = renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    await waitFor(() => expect(requests('/admin/info')).toHaveLength(1));
    unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("says when the status couldn't be copied", async () => {
    clipboard.writeText.mockImplementation(async () => {
      throw new Error('denied');
    });
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: 'Copy status' }));
    expect(
      await card('control_support').findByText("Couldn't copy.")
    ).toBeInTheDocument();
  });

  it("shows the node's newest log lines only when asked, with Hub's key", async () => {
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    expect(requests('/admin/logs')).toEqual([]);

    fireEvent.click(
      screen.getByRole('button', { name: `Show the last ${LOG_LINES} lines` })
    );
    expect(
      await card('control_log').findByText(/Node started/)
    ).toBeInTheDocument();
    const [asked] = requests('/admin/logs');
    expect(asked.searchParams.get('limit')).toBe(String(LOG_LINES));
    expect(asked.searchParams.get('tail')).toBe('true');
    expect(asked.searchParams.get('apiKey')).toBe(KEY);

    fireEvent.click(card('control_log').getByRole('button', { name: 'Copy' }));
    await card('control_log').findByText('Copied!');
    expect(clipboard.writeText).toHaveBeenLastCalledWith(
      '2026-11-21 00:00:00 INFO Controller - Node started'
    );

    // A refresh keeps the last lines on screen until the new ones are in,
    // and "Copied!" goes with the lines it was about.
    answers['GET /admin/logs'] = '\n';
    fireEvent.click(
      card('control_log').getByRole('button', { name: 'Refresh' })
    );
    expect(
      await card('control_log').findByText('The log is empty.')
    ).toBeInTheDocument();
    expect(card('control_log').queryByText('Copied!')).toBeNull();
    expect(requests('/admin/logs')).toHaveLength(2);
  });

  it('opens the log at its newest lines, which come last', async () => {
    // jsdom has no layout: give the log box a height to scroll through.
    const scrolledTo = vi.fn();
    Object.defineProperties(HTMLElement.prototype, {
      scrollHeight: {
        configurable: true,
        get() {
          return this.tagName === 'PRE' ? 900 : 0;
        },
      },
      scrollTop: {
        configurable: true,
        get: () => 0,
        set(value: number) {
          if (this.tagName === 'PRE') scrolledTo(value);
        },
      },
    });
    try {
      renderControl();
      fireEvent.click(
        screen.getByRole('button', { name: `Show the last ${LOG_LINES} lines` })
      );
      await card('control_log').findByText(/Node started/);
      await waitFor(() => expect(scrolledTo).toHaveBeenLastCalledWith(900));
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
    }
  });

  it("says why the log couldn't be read, keeping the last lines", async () => {
    renderControl();
    fireEvent.click(
      screen.getByRole('button', { name: `Show the last ${LOG_LINES} lines` })
    );
    await card('control_log').findByText(/Node started/);

    down.add('/admin/logs');
    fireEvent.click(
      card('control_log').getByRole('button', { name: 'Refresh' })
    );
    expect(
      await card('control_log').findByText(
        "That didn't work: the node may be busy or offline. Try again."
      )
    ).toBeInTheDocument();
    expect(card('control_log').getByText(/Node started/)).toBeInTheDocument();
  });

  it('reads no log for a node whose key Hub lacks', async () => {
    stored.value = null;
    renderControl();
    fireEvent.click(
      screen.getByRole('button', { name: `Show the last ${LOG_LINES} lines` })
    );
    expect(
      await card('control_log').findByText('Hub has no API key for this node.')
    ).toBeInTheDocument();
    expect(requests('/admin/logs')).toEqual([]);
  });
});
