import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  WIDGET_INFO,
  WIDGET_NOT_ON_SCREEN,
  WIDGET_REQUEST_NOT_ALLOWED,
  WIDGET_SET_SIZE,
  createWidgetRequestHandler,
  widgetRequestVerdict,
} from './widgetRequests';

const owner = { tabId: 'home-widget:Clock:', name: 'Clock', service: 'APP' };

const request = (data: Record<string, unknown>) => {
  const postMessage = vi.fn();
  return {
    event: {
      data: { requestedHandler: 'UI', ...data },
      ports: [{ postMessage }],
    },
    postMessage,
  };
};

describe('widgetRequestVerdict', () => {
  it('answers its own requests itself', () => {
    expect(widgetRequestVerdict(WIDGET_SET_SIZE, false)).toEqual({
      kind: 'own',
    });
    expect(widgetRequestVerdict(WIDGET_INFO, false)).toEqual({ kind: 'own' });
  });

  it('allows harmless look-ups at any time', () => {
    expect(widgetRequestVerdict('GET_NODE_STATUS', false)).toEqual({
      kind: 'allow',
    });
    expect(widgetRequestVerdict('WHICH_UI', false)).toEqual({ kind: 'allow' });
  });

  it('allows foreign-coin fees and server lists at any time', () => {
    for (const action of ['GET_FOREIGN_FEE', 'GET_CROSSCHAIN_SERVER_INFO']) {
      expect(widgetRequestVerdict(action, false)).toEqual({ kind: 'allow' });
    }
  });

  it('opens apps and asks the user only while Home is showing', () => {
    for (const action of [
      'OPEN_NEW_TAB',
      'GET_USER_ACCOUNT',
      'GET_WALLET_BALANCE',
      'SET_TAB',
    ]) {
      expect(widgetRequestVerdict(action, true)).toEqual({ kind: 'allow' });
      expect(widgetRequestVerdict(action, false)).toEqual({
        kind: 'refuse',
        code: WIDGET_NOT_ON_SCREEN,
      });
    }
  });

  it.each([
    'SEND_COIN',
    'PUBLISH_QDN_RESOURCE',
    'PUBLISH_MULTIPLE_QDN_RESOURCES',
    'SIGN_TRANSACTION',
    'DECRYPT_DATA',
    'ENCRYPT_DATA',
    'SEND_CHAT_MESSAGE',
    'SAVE_FILE',
    'FILE_SAVE_OPEN',
    'NOTIFICATION_ADD',
    'RNS_CONNECT',
    'PRIVATE_CHANNEL_OPEN',
    'MOQ_SESSION_OPEN',
    'SCREEN_CAPTURE_SELECT',
    'GET_USER_WALLET',
    'SOMETHING_NEW',
    42,
  ])('refuses %s, even while Home is showing', (action) => {
    expect(widgetRequestVerdict(action, true)).toEqual({
      kind: 'refuse',
      code: WIDGET_REQUEST_NOT_ALLOWED,
    });
  });
});

describe('createWidgetRequestHandler', () => {
  const opened: unknown[] = [];
  const onAddTab = (event: CustomEvent) => opened.push(event.detail);
  afterEach(() => {
    opened.length = 0;
    unsubscribeFromEvent('addTab', onAddTab);
  });

  it('refuses with a code the widget can read, without running anything', async () => {
    const sendMessage = vi.fn();
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => true,
      answerOwn: vi.fn(),
      sendMessage,
    });
    const { event, postMessage } = request({ action: 'SEND_COIN' });
    await handler(event);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      result: null,
      error: expect.objectContaining({ code: WIDGET_REQUEST_NOT_ALLOWED }),
    });
  });

  it('answers its own requests', async () => {
    const answerOwn = vi.fn(() => ({ applied: true }));
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => false,
      answerOwn,
      sendMessage: vi.fn(),
    });
    const { event, postMessage } = request({
      action: WIDGET_SET_SIZE,
      width: 'half',
      height: 140,
    });
    await handler(event);
    expect(answerOwn).toHaveBeenCalledWith(
      WIDGET_SET_SIZE,
      expect.objectContaining({ height: 140 })
    );
    expect(postMessage).toHaveBeenCalledWith({
      result: { applied: true },
      error: null,
    });
  });

  it('runs an allowed request as the widget, and passes the answer on', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ height: 123 });
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => false,
      answerOwn: vi.fn(),
      sendMessage,
    });
    const { event, postMessage } = request({ action: 'GET_NODE_STATUS' });
    await handler(event);
    expect(sendMessage).toHaveBeenCalledWith(
      'GET_NODE_STATUS',
      expect.objectContaining({ action: 'GET_NODE_STATUS' }),
      expect.any(Number),
      true,
      { name: 'Clock', service: 'APP', tabId: 'home-widget:Clock:' }
    );
    expect(postMessage).toHaveBeenCalledWith({
      result: { height: 123 },
      error: null,
    });
  });

  it('passes errors on in the shape Q-Apps know', async () => {
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => true,
      answerOwn: vi.fn(),
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          error: 'User declined',
          code: 'USER_DECLINED',
          message: 'No',
        })
        .mockRejectedValueOnce(new Error('offline')),
    });
    const first = request({ action: 'GET_USER_ACCOUNT' });
    await handler(first.event);
    expect(first.postMessage).toHaveBeenCalledWith({
      result: null,
      error: { error: 'User declined', code: 'USER_DECLINED', message: 'No' },
    });
    const second = request({ action: 'GET_USER_ACCOUNT' });
    await handler(second.event);
    expect(second.postMessage).toHaveBeenCalledWith({
      result: null,
      error: { error: 'offline', message: 'offline' },
    });
  });

  it('opens a tab for SET_TAB while Home is showing', async () => {
    subscribeToEvent('addTab', onAddTab);
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => true,
      answerOwn: vi.fn(),
      sendMessage: vi.fn(),
    });
    const { event, postMessage } = request({
      action: 'SET_TAB',
      payload: { service: 'APP', name: 'Clock' },
    });
    await handler(event);
    expect(opened).toEqual([{ data: { service: 'APP', name: 'Clock' } }]);
    expect(postMessage).toHaveBeenCalledWith({ result: true, error: null });
  });

  it('acknowledges navigation reports and ignores messages not for the UI', async () => {
    const sendMessage = vi.fn();
    const handler = createWidgetRequestHandler({
      owner,
      isOnScreen: () => false,
      answerOwn: vi.fn(),
      sendMessage,
    });
    const report = request({ action: 'QDN_RESOURCE_DISPLAYED', path: '/' });
    await handler(report.event);
    expect(report.postMessage).toHaveBeenCalledWith({
      result: true,
      error: null,
    });
    const other = request({ action: 'GET_NODE_STATUS' });
    other.event.data.requestedHandler = 'NOT_UI';
    await handler(other.event);
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
