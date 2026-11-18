import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { appLockedAtom } from '../../atoms/presence';
import { HUB_LOCKED_CODE } from '../../qortal/hubLocked';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { createWidgetRequestHandler } from './widgetRequests';

const store = getDefaultStore();
const owner = { tabId: 'home-widget:Clock:', name: 'Clock', service: 'APP' };
let events: string[];
const onAddTab = () => events.push('addTab');
const onAppsMode = () => events.push('open-apps-mode');

// A Home widget's SET_TAB, while its window is on Home.
const setTab = async () => {
  const postMessage = vi.fn();
  const handler = createWidgetRequestHandler({
    owner,
    isOnScreen: () => true,
    answerOwn: vi.fn(),
    sendMessage: vi.fn(),
  });
  await handler({
    data: {
      requestedHandler: 'UI',
      action: 'SET_TAB',
      payload: { service: 'APP', name: 'Opened-App' },
    },
    ports: [{ postMessage }],
  });
  return postMessage;
};

beforeEach(() => {
  events = [];
  subscribeToEvent('addTab', onAddTab);
  subscribeToEvent('open-apps-mode', onAppsMode);
  store.set(appLockedAtom, false);
});

afterEach(() => {
  unsubscribeFromEvent('addTab', onAddTab);
  unsubscribeFromEvent('open-apps-mode', onAppsMode);
  store.set(appLockedAtom, false);
});

describe("a Home widget's SET_TAB", () => {
  it('opens the tab while Hub is unlocked', async () => {
    const postMessage = await setTab();
    expect(events).toEqual(['addTab', 'open-apps-mode']);
    expect(postMessage).toHaveBeenCalledWith({ result: true, error: null });
  });

  it('opens no tab behind the lock screen while Hub is locked, and says why', async () => {
    store.set(appLockedAtom, true);
    const postMessage = await setTab();
    expect(events).toEqual([]);
    expect(postMessage).toHaveBeenCalledWith({
      result: null,
      error: expect.objectContaining({ code: HUB_LOCKED_CODE }),
    });
  });
});
