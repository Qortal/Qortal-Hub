import { renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeListener = (event: {
  data: unknown;
  ports: { postMessage: (reply: unknown) => void }[];
}) => Promise<void>;

let bridgeListener: BridgeListener | null = null;

// The tab's request bridge: it hands each request from the Q-App in the tab
// to the hook's listener.
vi.mock('../qortal/qapp-guest-request-bridge', () => ({
  attachQAppRequestBridge: vi.fn(
    (_view: unknown, _documentId: string, listener: BridgeListener) => {
      bridgeListener = listener;
      return () => {
        bridgeListener = null;
      };
    }
  ),
}));
vi.mock('../qortal/get', () => ({ saveFile: vi.fn() }));

import '../i18n/i18n';
import { appLockedAtom } from '../atoms/presence';
import { HUB_LOCKED_CODE } from '../qortal/hubLocked';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { useQortalMessageListener } from './useQortalMessageListener';

const store = getDefaultStore();
let opened: unknown[];
const onAddTab = (event: CustomEvent) => opened.push(event.detail);

// The Q-App in the tab asks for a tab of another app.
const setTab = async () => {
  const replies: unknown[] = [];
  await bridgeListener?.({
    data: {
      requestedHandler: 'UI',
      action: 'SET_TAB',
      payload: { service: 'APP', name: 'Opened-App' },
    },
    ports: [{ postMessage: (reply) => replies.push(reply) }],
  });
  return replies;
};

beforeEach(() => {
  opened = [];
  subscribeToEvent('addTab', onAddTab);
  store.set(appLockedAtom, false);
  renderHook(() =>
    useQortalMessageListener(
      1,
      false,
      'Example',
      'APP',
      '',
      { current: { send: vi.fn() } },
      true,
      'document-1'
    )
  );
});

afterEach(() => {
  unsubscribeFromEvent('addTab', onAddTab);
  store.set(appLockedAtom, false);
});

describe("a Q-App's SET_TAB", () => {
  it('opens the tab while Hub is unlocked', async () => {
    const replies = await setTab();
    expect(opened).toHaveLength(1);
    expect(replies).toEqual([{ result: true, error: null }]);
  });

  it('opens no tab behind the lock screen while Hub is locked, and says why', async () => {
    store.set(appLockedAtom, true);
    const replies = await setTab();
    expect(opened).toEqual([]);
    expect(replies).toEqual([
      {
        result: null,
        error: expect.objectContaining({ code: HUB_LOCKED_CODE }),
      },
    ]);
  });
});
