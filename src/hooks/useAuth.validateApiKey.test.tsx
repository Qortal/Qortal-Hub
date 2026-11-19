import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../App', () => ({ handleSetGlobalApikey: vi.fn() }));
vi.mock('../background/background-cases', () => ({
  getLocalApiKeyNotElectronCase: vi.fn(),
  setLocalApiKeyNotElectronCase: vi.fn(),
}));

import {
  isOpenCoreSetup,
  isOpenDialogCustomApikey,
  isOpenUrlInvalidAtom,
  isPublicNodeUnavailableAtom,
} from '../atoms/global';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../constants/constants';
import { useAuth } from './useAuth';

type Answer = () => {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

const answer =
  (body: string, status = 200): Answer =>
  () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const proxyErrorPage = (status: number) =>
  answer(`<html><body><h1>${status} Bad Gateway</h1></body></html>`, status);
const noAnswer: Answer = () => {
  throw new TypeError('Failed to fetch');
};

/** The node's answers by path: status, the key bypass, the key test. */
const nodeAnswers = (byPath: Record<string, Answer>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      const reply = byPath[path];
      if (!reply) throw new Error(`unexpected request ${path}`);
      return reply();
    })
  );

const CUSTOM_NODE = 'https://node.example.org:12391';

const validate = async (url: string) => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(() => useAuth(), { wrapper });
  let outcome: { isValid: boolean; nodeAnswered?: boolean } | undefined;
  await act(async () => {
    outcome = await result.current.validateApiKey({ url, apikey: '' });
  });
  return {
    isValid: outcome?.isValid,
    nodeAnswered: outcome?.nodeAnswered,
    askedForKey: store.get(isOpenDialogCustomApikey),
    toldNodeUnreachable: store.get(isOpenUrlInvalidAtom),
    offeredLocalNode:
      store.get(isPublicNodeUnavailableAtom) && store.get(isOpenCoreSetup),
  };
};

describe('validateApiKey on a node that is not on this computer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('doesn’t ask for a key when the public node answers with an error page', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': proxyErrorPage(502),
      '/admin/apikey/test': proxyErrorPage(502),
    });

    const result = await validate(HTTPS_EXT_NODE_QORTAL_LINK);

    expect(result).toEqual({
      isValid: false,
      nodeAnswered: false,
      askedForKey: false,
      toldNodeUnreachable: false,
      offeredLocalNode: true,
    });
  });

  it('never asks for a key on the public node, which has none to give', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': answer('false'),
      '/admin/apikey/test': answer(
        '{"error":4,"message":"API key invalid"}',
        403
      ),
    });

    const result = await validate(HTTPS_EXT_NODE_QORTAL_LINK);

    expect(result.askedForKey).toBe(false);
    expect(result.offeredLocalNode).toBe(true);
  });

  it('says a node is not answering, not that its key is wrong', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': proxyErrorPage(503),
      '/admin/apikey/test': noAnswer,
    });

    const result = await validate(CUSTOM_NODE);

    expect(result).toEqual({
      isValid: false,
      nodeAnswered: false,
      askedForKey: false,
      toldNodeUnreachable: true,
      offeredLocalNode: false,
    });
  });

  it('still asks for a key that the node refuses', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': answer('false'),
      '/admin/apikey/test': answer(
        '{"error":4,"message":"API key invalid"}',
        403
      ),
    });

    const result = await validate(CUSTOM_NODE);

    expect(result).toEqual({
      isValid: false,
      nodeAnswered: true,
      askedForKey: true,
      toldNodeUnreachable: false,
      offeredLocalNode: false,
    });
  });

  it('accepts a key the node accepts', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': answer('false'),
      '/admin/apikey/test': answer('true'),
    });

    const result = await validate(CUSTOM_NODE);

    expect(result).toEqual({
      isValid: true,
      nodeAnswered: true,
      askedForKey: false,
      toldNodeUnreachable: false,
      offeredLocalNode: false,
    });
  });
});

describe('validateApiKey when the node stops answering after its status', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says a node is not answering when the first key-check request gets no answer', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': noAnswer,
      '/admin/apikey/test': noAnswer,
    });

    const result = await validate(CUSTOM_NODE);

    expect(result).toEqual({
      isValid: false,
      nodeAnswered: false,
      askedForKey: false,
      toldNodeUnreachable: true,
      offeredLocalNode: false,
    });
  });

  it('offers the local node when the public node drops the first key-check request', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': noAnswer,
      '/admin/apikey/test': noAnswer,
    });

    const result = await validate(HTTPS_EXT_NODE_QORTAL_LINK);

    expect(result.askedForKey).toBe(false);
    expect(result.toldNodeUnreachable).toBe(false);
    expect(result.offeredLocalNode).toBe(true);
  });

  it('still judges the key when only the first key-check request gets no answer', async () => {
    nodeAnswers({
      '/admin/status': answer('{}'),
      '/admin/settings/localAuthBypassEnabled': noAnswer,
      '/admin/apikey/test': answer(
        '{"error":4,"message":"API key invalid"}',
        403
      ),
    });

    const result = await validate(CUSTOM_NODE);

    expect(result).toEqual({
      isValid: false,
      nodeAnswered: true,
      askedForKey: true,
      toldNodeUnreachable: false,
      offeredLocalNode: false,
    });
  });
});
