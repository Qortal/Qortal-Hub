import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getNodeJson,
  useNodeOverviewData,
  useNodeRead,
} from './useNodeOverviewData';

const NODE = 'https://127.0.0.1:12391';
const OTHER_NODE = 'https://192.168.1.20:12391';

const answer = (body: unknown, ok = true) =>
  ({
    json: async () => body,
    ok,
    status: ok ? 200 : 500,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useNodeRead', () => {
  it('is loading, then holds the answer', async () => {
    const load = vi.fn(async () => 7);
    const { result } = renderHook(() => useNodeRead(NODE, load, 0));
    expect(result.current.status).toBe('loading');
    expect(result.current.value).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.value).toBe(7);
    expect(load).toHaveBeenCalledWith(NODE, expect.any(AbortSignal));
  });

  it('keeps the last answer when a refresh fails, and never turns it into nothing', async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error('down');
      return ['peer'];
    });
    const { result } = renderHook(() => useNodeRead(NODE, load, 0));
    await waitFor(() => expect(result.current.status).toBe('ok'));
    const readAt = result.current.at;

    fail = true;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.value).toEqual(['peer']);
    expect(result.current.at).toBe(readAt);
  });

  it('reads again on Retry after a failure', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('down');
      return 'answer';
    });
    const { result } = renderHook(() => useNodeRead(NODE, load, 0));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.value).toBeNull();

    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.value).toBe('answer');
  });

  it('reads every interval while mounted, and stops after', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 1);
    const { unmount } = renderHook(() => useNodeRead(NODE, load, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(load).toHaveBeenCalledTimes(4);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('drops a late answer from the node it used before', async () => {
    let answerFirstNode: (value: string) => void = () => undefined;
    const load = vi.fn(
      (base: string) =>
        new Promise<string>((resolve) => {
          if (base === NODE) answerFirstNode = resolve;
          else resolve('other node');
        })
    );
    const { rerender, result } = renderHook(
      ({ base }) => useNodeRead(base, load, 0),
      { initialProps: { base: NODE } }
    );
    rerender({ base: OTHER_NODE });
    await waitFor(() => expect(result.current.value).toBe('other node'));

    await act(async () => {
      answerFirstNode('first node');
    });
    expect(result.current.value).toBe('other node');
  });

  it('reads nothing without a reader', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useNodeRead(NODE, null, 1000));
    expect(result.current.status).toBe('loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getNodeJson', () => {
  it("takes Core's error answers for failures", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        answer({ error: 4, message: "Missing 'X-API-KEY' header" })
      )
    );
    await expect(
      getNodeJson(NODE, '/admin/info', new AbortController().signal)
    ).rejects.toThrow();
  });

  it('takes a failed request for a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer('oops', false))
    );
    await expect(
      getNodeJson(NODE, '/peers', new AbortController().signal)
    ).rejects.toThrow();
  });

  it("refuses a path that would leave the node's own paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getNodeJson(
        NODE,
        '/names/primary/../admin/stop',
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useNodeOverviewData', () => {
  const answers: Record<string, unknown> = {
    '/admin/info': { buildVersion: 'qortal-6.1.9-a', uptime: 1000 },
    '/admin/mintingaccounts': [{ publicKey: 'key' }],
    '/admin/settings/apiWhitelistEnabled': 'true',
    '/admin/settings/autoUpdateEnabled': 'oops',
    '/admin/settings/listenPort': 'null',
    '/admin/settings/maxDataPeers': '64',
    '/admin/settings/relayModeEnabled': 'true',
    '/admin/settings/uPnPEnabled': 'true',
    '/admin/summary': { blockCount: 1440 },
    '/admin/systeminfo': { availableProcessors: 8 },
    '/blocks/last': { height: 2000, timestamp: 1 },
    '/peers': [],
    '/peers/data': [],
  };
  const stubNode = () => {
    const fetchMock = vi.fn(async (url: string) => {
      const path = url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
      if (path in answers) return answer(answers[path]);
      if (path.startsWith('/blocks/')) return answer([]);
      return answer({ error: 1, message: 'nope' });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const paths = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([url]) =>
      String(url).replace(/^https:\/\/[^/]+/, '')
    );

  it("reads the node's own settings, a failed one as unknown", async () => {
    stubNode();
    const { result } = renderHook(() => useNodeOverviewData(NODE, false));
    await waitFor(() => expect(result.current.settings.status).toBe('ok'));
    expect(result.current.settings.value).toEqual({
      apiWhitelistEnabled: true,
      autoUpdateEnabled: null,
      listenPort: null,
      maxDataPeers: 64,
      relayModeEnabled: true,
      uPnPEnabled: true,
    });
    await waitFor(() => expect(result.current.mintingKeys.value).toBe(1));
  });

  it("doesn't read the public node's keys, settings or memory", async () => {
    const fetchMock = stubNode();
    const { result } = renderHook(() =>
      useNodeOverviewData('https://ext-node.qortal.link', true)
    );
    await waitFor(() => expect(result.current.info.status).toBe('ok'));
    await waitFor(() => expect(result.current.peers.status).toBe('ok'));
    const read = paths(fetchMock);
    expect(read).toContain('/admin/info');
    expect(read.some((path) => path.startsWith('/admin/settings'))).toBe(false);
    expect(read).not.toContain('/admin/mintingaccounts');
    expect(read).not.toContain('/admin/systeminfo');
    expect(result.current.settings.status).toBe('loading');
  });

  it('adds up the minters online now, skipping entries without a count', async () => {
    answers['/addresses/online/levels'] = [
      { count: 2, level: 0 },
      { count: 'many', level: 3 },
      { level: 4 },
      { count: 40, level: 10 },
    ];
    stubNode();
    const { result } = renderHook(() => useNodeOverviewData(NODE, false));
    await waitFor(() => expect(result.current.onlineMinters.value).toBe(42));
  });

  it('reads the newest blocks and the one a day back from the last height', async () => {
    const fetchMock = stubNode();
    const { result } = renderHook(() => useNodeOverviewData(NODE, false));
    await waitFor(() => expect(result.current.recentBlocks.status).toBe('ok'));
    await waitFor(() => expect(result.current.dayOldBlock.status).toBe('ok'));
    const read = paths(fetchMock);
    expect(read).toContain('/blocks/summaries?start=1991&end=2001');
    expect(read).toContain('/blocks/byheight/560');
  });
});
