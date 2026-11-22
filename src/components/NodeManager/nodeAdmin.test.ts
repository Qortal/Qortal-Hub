import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../background/background', () => ({
  getApiKeyFromStorage: vi.fn(async () => stored.value),
}));

import {
  NodeAdminError,
  nodeAdminRequest,
  parsePeerAddress,
  type NodeAdminFailure,
} from './nodeAdmin';

const NODE = 'https://127.0.0.1:12391';
const KEY = 'test-key-1';

const respond = (text: string, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }) as Response;

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
  async () => respond('true')
);

/** Why the request was refused, or 'ok'. */
const outcome = async (
  promise: Promise<string>
): Promise<NodeAdminFailure | 'ok' | 'other'> => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof NodeAdminError ? error.reason : 'other';
  }
};

beforeEach(() => {
  stored.value = { apikey: KEY, url: NODE };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => respond('true'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nodeAdminRequest', () => {
  it("sends Hub's key to the node it belongs to, as its own parameter", async () => {
    const answer = await nodeAdminRequest(NODE, '/peers', {
      body: '203.0.113.5:12392',
      method: 'POST',
    });

    expect(answer).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${NODE}/peers?apiKey=${KEY}`);
    expect(init).toMatchObject({
      body: '203.0.113.5:12392',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST',
      // A redirect could take the key to another server.
      redirect: 'error',
    });
  });

  it('sends a plain GET with no body and no headers', async () => {
    await nodeAdminRequest(NODE, '/admin/restart');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${NODE}/admin/restart?apiKey=${KEY}`);
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it('never asks the public node', async () => {
    const PUBLIC = 'https://ext-node.qortal.link';
    stored.value = { apikey: KEY, url: PUBLIC };
    expect(await outcome(nodeAdminRequest(PUBLIC, '/admin/restart'))).toBe(
      'public'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so when Hub has no key, without asking the node', async () => {
    stored.value = null;
    expect(await outcome(nodeAdminRequest(NODE, '/admin/stop'))).toBe('no_key');
    stored.value = { apikey: '', url: NODE };
    expect(await outcome(nodeAdminRequest(NODE, '/admin/stop'))).toBe('no_key');
    stored.value = { url: NODE };
    expect(await outcome(nodeAdminRequest(NODE, '/admin/stop'))).toBe('no_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a key that belongs to another node away from this one', async () => {
    for (const url of [
      'https://203.0.113.9:12391',
      // Same machine, another port or scheme: another origin.
      'https://127.0.0.1:12392',
      'http://127.0.0.1:12391',
      'not a url',
      undefined,
    ]) {
      stored.value = { apikey: KEY, url };
      expect(await outcome(nodeAdminRequest(NODE, '/admin/stop'))).toBe(
        'node_changed'
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // The same node written with a trailing slash is the same node.
    stored.value = { apikey: KEY, url: `${NODE}/` };
    expect(await outcome(nodeAdminRequest(NODE, '/admin/stop'))).toBe('ok');
  });

  it("tells Core's refusals apart", async () => {
    const cases: [string, number, NodeAdminFailure][] = [
      ['{"error":4,"message":"API call unauthorized"}', 403, 'refused'],
      ['{"error":8,"message":"no time sync"}', 503, 'no_time_sync'],
      ['{"error":115,"message":"invalid data"}', 400, 'invalid'],
      ['{"error":123,"message":"invalid network address"}', 400, 'invalid'],
      ['{"error":5,"message":"repository issue"}', 500, 'failed'],
      // Core's numbered errors count even with a 200.
      ['{"error":123}', 200, 'invalid'],
      ['Forbidden', 403, 'refused'],
      ['Unauthorized', 401, 'refused'],
      ['<html>Bad gateway</html>', 502, 'failed'],
    ];
    for (const [text, status, reason] of cases) {
      fetchMock.mockImplementationOnce(async () => respond(text, status));
      expect(await outcome(nodeAdminRequest(NODE, '/admin/restart'))).toBe(
        reason
      );
    }
  });

  it("fails when the node doesn't answer", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await outcome(nodeAdminRequest(NODE, '/admin/restart'))).toBe(
      'failed'
    );

    // No answer in time, or the caller gave up (here while the key was
    // still being read, before the request went out).
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted)
          reject(new DOMException('Aborted', 'AbortError'));
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    fetchMock.mockImplementationOnce(hang);
    expect(
      await outcome(nodeAdminRequest(NODE, '/admin/restart', { timeoutMs: 5 }))
    ).toBe('failed');

    fetchMock.mockImplementationOnce(hang);
    const controller = new AbortController();
    const asked = outcome(
      nodeAdminRequest(NODE, '/admin/forcesync', {
        body: '203.0.113.5:12392',
        method: 'POST',
        signal: controller.signal,
      })
    );
    controller.abort();
    expect(await asked).toBe('failed');
  });

  it("returns the node's answer without its line break", async () => {
    fetchMock.mockImplementationOnce(async () => respond('NOTHING_TO_DO\n'));
    expect(
      await nodeAdminRequest(NODE, '/admin/forcesync', {
        body: '203.0.113.5:12392',
        method: 'POST',
      })
    ).toBe('NOTHING_TO_DO');
  });

  it('refuses a path the node could read as another endpoint', async () => {
    expect(await outcome(nodeAdminRequest(NODE, '/admin/../peers'))).not.toBe(
      'ok'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parsePeerAddress', () => {
  it('takes host names, IPv4 and bracketed IPv6, with or without a port', () => {
    for (const address of [
      'node.example.org',
      'node.example.org:12392',
      'localhost:62392',
      '203.0.113.5',
      '203.0.113.5:12392',
      '[2001:db8::1]',
      '[2001:db8::1]:12392',
      '[::ffff:203.0.113.5]:12392',
    ]) {
      expect(parsePeerAddress(address)).toBe(address);
    }
    expect(parsePeerAddress('  203.0.113.5:12392\n')).toBe('203.0.113.5:12392');
  });

  it("refuses what the node can't use", () => {
    for (const value of [
      '',
      '   ',
      'http://203.0.113.5:12392',
      '203.0.113.5:12392/peers',
      'node example.org',
      'node.example.org:',
      ':12392',
      'node.example.org:0',
      'node.example.org:65536',
      'node.example.org:123456',
      '-node.example.org',
      'node-.example.org',
      'node..example.org',
      '2001:db8::1',
      '[2001:db8::zz]',
      '[2001:db8::1',
      `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(50)}`,
      'user@node.example.org',
    ]) {
      expect(parsePeerAddress(value)).toBeNull();
    }
    expect(parsePeerAddress(undefined)).toBeNull();
    expect(parsePeerAddress(12392)).toBeNull();
  });
});
