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
  RESTART_DOWN_WAIT_MS,
  RESTART_UP_WAIT_MS,
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
const RESTART_STILL_UP =
  "The node hasn't restarted: it's still running as before. If Core's restart failed, Core's own output may say why (its terminal, or run.log in its folder).";
const BOOTSTRAP_STILL_UP =
  "The node hasn't restarted to bootstrap: it's still running as before. If Core's bootstrap failed, Core's own output may say why (its terminal, or run.log in its folder).";
const RESTART_NOT_BACK = "The node stopped to restart and hasn't come back.";
const BOOTSTRAP_NOT_BACK =
  "The node stopped to bootstrap and hasn't come back.";
const MINUTE = 60 * 1000;
/**
 * Core 6.1.9's restart (RestartNode, then ApplyRestart): a helper process
 * (`java … -cp qortal.jar org.qortal.ApplyRestart`) asks the node to stop,
 * asks again 30 s later and gets no answer, then waits 30 + 60 + 60 + 15 s
 * before it runs `java … -jar qortal.jar` again: about 193 s after the
 * node's API went away. Hub's process check only sees `-jar …qortal.jar`.
 */
const NEW_CORE_AFTER_MS = 193_000;
/** How long the old Core takes to shut down once its API is gone. */
const OLD_CORE_EXITS_AFTER_MS = 20_000;
const ELSEWHERE =
  "Hub can only start Core from the folder it knows, and Core isn't there. Choose the folder your Core runs from (the one with qortal.jar), and Hub can start it.";
const NO_JAR = 'Chosen directory does not contain a qortal.jar';
const CHOOSE_FOLDER = "Choose Core's folder";

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
  // An answer can be worked out when it's asked for (a growing uptime).
  const body =
    typeof answer === 'function' ? (answer as () => unknown)() : answer;
  return body === undefined ? respond({ error: 1 }, 404) : respond(body);
});

/** A node's uptime as Core answers it: growing from when it started. */
const runningSince = (startedAt: number) => () =>
  String(Date.now() - startedAt);

const requests = (path: string) =>
  fetchMock.mock.calls
    .map(([url]) => new URL(url))
    .filter((url) => url.pathname === path);

const store = getDefaultStore();

const control = (active: boolean, nodeBase = NODE) => (
  <ThemeProvider theme={darkTheme}>
    <NodeControlSection active={active} nodeBase={nodeBase} />
  </ThemeProvider>
);

const renderControl = (nodeBase = NODE, active = true) =>
  render(control(active, nodeBase));

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

/** Every text put on screen while `run` goes, even one gone a commit later. */
const textsShownDuring = async (run: () => Promise<void>) => {
  const shown: string[] = [];
  const watcher = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData' && record.target.textContent)
        shown.push(record.target.textContent);
      for (const node of Array.from(record.addedNodes))
        if (node.textContent) shown.push(node.textContent);
    }
  });
  watcher.observe(document.body, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  try {
    await run();
  } finally {
    watcher.disconnect();
  }
  return shown;
};

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
    'GET /admin/uptime': runningSince(Date.now() - 2 * HOUR),
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

  it.each([
    [
      'restart',
      'Restart node',
      'Restart the node?',
      'The node is restarting.',
      RESTART_STILL_UP,
    ],
    [
      'bootstrap',
      'Bootstrap node',
      'Bootstrap the node?',
      'The node is restarting to bootstrap.',
      BOOTSTRAP_STILL_UP,
    ],
  ])(
    'says so when a %s asked for here never happens',
    async (change, button, title, asked, stillUp) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderControl();
      await card('control_key').findByText(
        "Hub's API key for this node works."
      );
      await confirmChange(button, title);
      await card(`control_${change}`).findByText(asked);
      await dialogsClosed();

      // Core restarts itself through a second process: when that fails, the
      // node just goes on answering, and its uptime never starts over.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RESTART_UP_WAIT_MS - 10_000);
      });
      expect(card(`control_${change}`).getByText(asked)).toBeInTheDocument();

      // Said once a read after the wait shows the same node.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(
        await card(`control_${change}`).findByText(stillUp)
      ).toBeInTheDocument();
      expect(card(`control_${change}`).queryByText(asked)).toBeNull();

      // Asked again: a fresh wait.
      await confirmChange(button, title);
      expect(
        await card(`control_${change}`).findByText(asked)
      ).toBeInTheDocument();
      expect(card(`control_${change}`).queryByText(stillUp)).toBeNull();
    }
  );

  it("offers to start Core once a restart stopped the node and it didn't come back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      isCoreRunningOnSystem: vi.fn(async () => false),
      startCore,
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // It stopped to restart, and no Core came up again.
    down.add('/admin/uptime');
    await nextUptimeRead();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_DOWN_WAIT_MS - 10_000);
    });
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
    expect(
      card('control_restart').getByText('The node is restarting.')
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      await card('control_restart').findByText(RESTART_NOT_BACK)
    ).toBeInTheDocument();
    fireEvent.click(
      card('control_restart').getByRole('button', { name: 'Start Core' })
    );
    expect(startCore).toHaveBeenCalledTimes(1);
    expect(await card('control_restart').findByText(ASKED)).toBeInTheDocument();
    expect(
      card('control_stop').queryByRole('button', { name: 'Start Core' })
    ).toBeNull();
  });

  it('gives a restart its full wait again once the node stops answering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const isCoreRunningOnSystem = vi.fn(async () => false);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      isCoreRunningOnSystem,
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // Slow to stop: it answers for most of the wait, then goes down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_UP_WAIT_MS - 20_000);
    });
    down.add('/admin/uptime');
    await nextUptimeRead();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000 + CORE_CHECK_MS);
    });
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
    expect(screen.queryByText(RESTART_STILL_UP)).toBeNull();
    expect(screen.queryByText(RESTART_NOT_BACK)).toBeNull();
    expect(
      card('control_restart').getByText('The node is restarting.')
    ).toBeInTheDocument();
  });

  it("keeps waiting after a restart while Core's process on this PC runs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const isCoreRunningOnSystem = vi.fn(async () => true);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      isCoreRunningOnSystem,
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // A slow start: no answer yet, but Core's process is there.
    down.add('/admin/uptime');
    await nextUptimeRead();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_DOWN_WAIT_MS + CORE_CHECK_MS);
    });
    expect(isCoreRunningOnSystem).toHaveBeenCalled();
    expect(
      card('control_restart').getByText('The node is restarting.')
    ).toBeInTheDocument();
    expect(screen.queryByText(RESTART_NOT_BACK)).toBeNull();
    expect(screen.queryByText(STILL_RUNNING)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
  });

  it("offers no Start, and doesn't say the node is gone, while Core's own restart waits to start it again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let apiDownAt: number | null = null;
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      // What Hub's check answers during a restart that works: the old Core
      // while it shuts down, nothing while Core's helper waits, then the
      // Core the helper starts.
      isCoreRunningOnSystem: vi.fn(async () => {
        if (apiDownAt === null) return true;
        const since = Date.now() - apiDownAt;
        return since < OLD_CORE_EXITS_AFTER_MS || since >= NEW_CORE_AFTER_MS;
      }),
      startCore,
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // Core's helper stops the node at once.
    apiDownAt = Date.now();
    down.add('/admin/uptime');

    // Watch the card until well after the wait for a node that stays away,
    // while the new Core opens its database.
    const seen: string[] = [];
    while (Date.now() - apiDownAt < RESTART_DOWN_WAIT_MS + 30_000) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const at = Math.round((Date.now() - apiDownAt) / 1000);
      if (screen.queryByRole('button', { name: 'Start Core' }))
        seen.push(`Start Core at ${at} s`);
      if (screen.queryByText(RESTART_NOT_BACK))
        seen.push(`"hasn't come back" at ${at} s`);
    }
    expect(seen).toEqual([]);
    expect(
      card('control_restart').getByText('The node is restarting.')
    ).toBeInTheDocument();
  }, 60_000);

  it("keeps waiting after a bootstrap while Core runs from a folder Hub doesn't know", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const isCoreRunningOnSystem = vi.fn(async () => true);
    window.coreSetup = {
      // Core isn't in the folder Hub knows…
      isCoreInstalledOnSystem: vi.fn(async () => false),
      // …but its process runs: it's downloading the bootstrap.
      isCoreRunningOnSystem,
      pickQortalDirectory: vi.fn(async () => null),
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Bootstrap node', 'Bootstrap the node?');
    await card('control_bootstrap').findByText(
      'The node is restarting to bootstrap.'
    );
    await dialogsClosed();

    // A bootstrap keeps the API down for a long while.
    down.add('/admin/uptime');
    await nextUptimeRead();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_DOWN_WAIT_MS + CORE_CHECK_MS);
    });
    expect(isCoreRunningOnSystem).toHaveBeenCalled();
    expect(screen.queryByText(BOOTSTRAP_NOT_BACK)).toBeNull();
    expect(screen.queryByText(ELSEWHERE)).toBeNull();
    expect(
      card('control_bootstrap').getByText(
        'The node is restarting to bootstrap.'
      )
    ).toBeInTheDocument();
  });

  it('says Core is still running, not where its folder is, while a Core from elsewhere shuts down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let running = true;
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => false),
      isCoreRunningOnSystem: vi.fn(async () => running),
      pickQortalDirectory: vi.fn(async () => null),
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    down.add('/admin/uptime');
    renderControl();
    expect(await screen.findByText(STILL_RUNNING)).toBeInTheDocument();
    expect(screen.queryByText(ELSEWHERE)).toBeNull();

    running = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CORE_CHECK_MS);
    });
    expect(
      await card('control_stop').findByText(ELSEWHERE)
    ).toBeInTheDocument();
    expect(screen.queryByText(STILL_RUNNING)).toBeNull();
  });

  it("doesn't call the node restarting in one card while another says it never restarted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");

    // Core's restart doesn't happen: the node goes on answering.
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_UP_WAIT_MS + 10_000);
    });
    await card('control_restart').findByText(RESTART_STILL_UP);

    // The bootstrap doesn't happen either. Asked: its own wait, with
    // nothing carried over from the restart's.
    const shown = await textsShownDuring(async () => {
      await confirmChange('Bootstrap node', 'Bootstrap the node?');
      await card('control_bootstrap').findByText(
        'The node is restarting to bootstrap.'
      );
    });
    expect(shown.filter((text) => text.includes(BOOTSTRAP_STILL_UP))).toEqual(
      []
    );
    await dialogsClosed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_UP_WAIT_MS + 10_000);
    });
    await card('control_bootstrap').findByText(BOOTSTRAP_STILL_UP);

    // The same node, at the same moment: only the newest request is spoken of.
    expect(
      card('control_restart').queryByText('The node is restarting.')
    ).toBeNull();
    expect(card('control_restart').queryByText(RESTART_STILL_UP)).toBeNull();
  });

  it("doesn't say a restart never happened when it happened while Node control was hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The node was started two minutes ago.
    answers['GET /admin/uptime'] = runningSince(Date.now() - 2 * MINUTE);
    const view = renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // Over to another section while it restarts: back four minutes later.
    view.rerender(control(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * MINUTE);
    });
    // Nothing was read meanwhile, so nothing is said about the restart.
    expect(screen.queryByText(RESTART_STILL_UP)).toBeNull();

    // Back to Node control: the node has run four minutes, so it started
    // after the restart was asked eight minutes ago.
    answers['GET /admin/uptime'] = runningSince(Date.now() - 4 * MINUTE);
    const shown = await textsShownDuring(async () => {
      view.rerender(control(true));
      await nextUptimeRead();
      await nextUptimeRead();
    });
    expect(shown.filter((text) => text.includes(RESTART_STILL_UP))).toEqual([]);
    expect(screen.queryByText(RESTART_STILL_UP)).toBeNull();
    expect(
      card('control_restart').queryByText('The node is restarting.')
    ).toBeNull();
  });

  it("never shows a wait's verdict for one that's no longer true, even for a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      isCoreRunningOnSystem: vi.fn(async () => false),
      startCore,
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // It stopped and didn't come back: Hub offers to start it.
    down.add('/admin/uptime');
    await nextUptimeRead();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_DOWN_WAIT_MS);
    });
    await card('control_restart').findByText(RESTART_NOT_BACK);
    fireEvent.click(
      card('control_restart').getByRole('button', { name: 'Start Core' })
    );
    await card('control_restart').findByText(ASKED);

    // Core answers again, freshly started: nothing about the wait for a
    // node that answered, not even for a commit.
    answers['GET /admin/uptime'] = runningSince(Date.now() - 5000);
    down.delete('/admin/uptime');
    const shown = await textsShownDuring(async () => {
      await nextUptimeRead();
      await waitFor(() =>
        expect(screen.queryByText(RESTART_NOT_BACK)).toBeNull()
      );
    });
    expect(shown.filter((text) => text.includes("hasn't restarted"))).toEqual(
      []
    );
  });

  it('says nothing about a wait once the node answers again after a long silence', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      // Core's process stays there: it doesn't answer, but it runs.
      isCoreRunningOnSystem: vi.fn(async () => true),
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    down.add('/admin/uptime');
    await nextUptimeRead();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_DOWN_WAIT_MS + CORE_CHECK_MS);
    });

    // The same Core answers again.
    down.delete('/admin/uptime');
    const shown = await textsShownDuring(async () => {
      await nextUptimeRead();
      await waitFor(() =>
        expect(
          card('control_restart').queryByText('The node is restarting.')
        ).toBeNull()
      );
    });
    expect(shown.filter((text) => text.includes(RESTART_STILL_UP))).toEqual([]);
    expect(shown.filter((text) => text.includes(RESTART_NOT_BACK))).toEqual([]);
  });

  it('offers to start Core after a stop that follows a restart that never happened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => true),
      isCoreRunningOnSystem: vi.fn(async () => false),
      startCore,
    } as unknown as typeof window.coreSetup;
    renderControl();
    await card('control_key').findByText("Hub's API key for this node works.");
    await confirmChange('Restart node', 'Restart the node?');
    await card('control_restart').findByText('The node is restarting.');
    await dialogsClosed();

    // Core's restart didn't go through, so the node is stopped instead.
    await confirmChange('Stop node', 'Stop the node?');
    await card('control_stop').findByText('The node is stopping.');
    expect(
      card('control_restart').queryByText('The node is restarting.')
    ).toBeNull();

    down.add('/admin/uptime');
    await nextUptimeRead();
    fireEvent.click(
      await card('control_stop').findByRole('button', { name: 'Start Core' })
    );
    expect(startCore).toHaveBeenCalledTimes(1);
    expect(await card('control_stop').findByText(ASKED)).toBeInTheDocument();
  });

  it("says Core isn't where Hub looks, and takes the folder chosen for it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let installed = false;
    const pickQortalDirectory = vi
      .fn<() => Promise<unknown>>()
      // Closed without a choice, then a folder without Core, then Core's.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        installed = true;
        return undefined;
      });
    const startCore = vi.fn(async () => undefined);
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => installed),
      isCoreRunningOnSystem: vi.fn(async () => false),
      pickQortalDirectory,
      startCore,
    } as unknown as typeof window.coreSetup;
    down.add('/admin/uptime');
    renderControl();

    expect(
      await card('control_stop').findByText(ELSEWHERE)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Core' })).toBeNull();
    const choose = async () => {
      const button = await card('control_stop').findByRole('button', {
        name: CHOOSE_FOLDER,
      });
      await waitFor(() => expect(button).toBeEnabled());
      // The picker answers at once here: let that land inside act.
      await act(async () => {
        fireEvent.click(button);
      });
    };

    await choose();
    await waitFor(() =>
      expect(
        card('control_stop').getByRole('button', { name: CHOOSE_FOLDER })
      ).toBeEnabled()
    );
    expect(pickQortalDirectory).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NO_JAR)).toBeNull();
    await choose();
    expect(await card('control_stop').findByText(NO_JAR)).toBeInTheDocument();

    // Kept: Hub looks again at once, not at its next check.
    await choose();
    fireEvent.click(
      await card('control_stop').findByRole(
        'button',
        { name: 'Start Core' },
        { timeout: CORE_CHECK_MS / 20 }
      )
    );
    expect(startCore).toHaveBeenCalledTimes(1);
    expect(await card('control_stop').findByText(ASKED)).toBeInTheDocument();
    expect(screen.queryByText(ELSEWHERE)).toBeNull();
    expect(screen.queryByText(NO_JAR)).toBeNull();
  });

  it('keeps what a folder choice found to the time the node was down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (value: unknown) => void = () => undefined;
    window.coreSetup = {
      isCoreInstalledOnSystem: vi.fn(async () => false),
      isCoreRunningOnSystem: vi.fn(async () => false),
      pickQortalDirectory: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            answer = resolve;
          })
      ),
      startCore: vi.fn(async () => undefined),
    } as unknown as typeof window.coreSetup;
    const chooseNoCore = async () => {
      fireEvent.click(
        await card('control_stop').findByRole('button', {
          name: CHOOSE_FOLDER,
        })
      );
      await act(async () => {
        answer(false);
      });
    };
    down.add('/admin/uptime');
    renderControl();

    // A folder without Core, then the node is back: the note goes with it.
    await chooseNoCore();
    expect(await card('control_stop').findByText(NO_JAR)).toBeInTheDocument();
    down.delete('/admin/uptime');
    await nextUptimeRead();
    await waitFor(() => expect(screen.queryByText(ELSEWHERE)).toBeNull());
    down.add('/admin/uptime');
    await nextUptimeRead();
    await card('control_stop').findByText(ELSEWHERE);
    expect(screen.queryByText(NO_JAR)).toBeNull();

    // The node is back before the folder window closes: its answer is old.
    fireEvent.click(
      card('control_stop').getByRole('button', { name: CHOOSE_FOLDER })
    );
    down.delete('/admin/uptime');
    await nextUptimeRead();
    await waitFor(() => expect(screen.queryByText(ELSEWHERE)).toBeNull());
    await act(async () => {
      answer(false);
    });
    down.add('/admin/uptime');
    await nextUptimeRead();
    await card('control_stop').findByText(ELSEWHERE);
    expect(screen.queryByText(NO_JAR)).toBeNull();
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
