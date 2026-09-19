import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authorizeRnsDestination } = vi.hoisted(() => ({
  authorizeRnsDestination: vi.fn(),
}));

vi.mock('./get.ts', () => ({ authorizeRnsDestination }));

import { dispatchQAppReticulumRequest } from './qapp-reticulum-request';

const destination = 'a'.repeat(32);
const context = {
  appName: 'ExampleApp',
  appService: 'APP',
  isFromExtension: true,
  tabId: 42,
};
const owner = { name: 'exampleapp', service: 'APP', tabId: '42' };

describe('dedicated Q-App Reticulum request dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeRnsDestination.mockResolvedValue(destination);
    Object.assign(window, {
      electronAPI: {
        qappReticulumClose: vi.fn().mockResolvedValue(true),
        qappReticulumConnect: vi
          .fn()
          .mockResolvedValue({ connectionId: 'connection', state: 'OPEN' }),
        qappReticulumRequest: vi.fn().mockResolvedValue({ ok: true }),
        qappReticulumSend: vi.fn().mockResolvedValue(true),
      },
      sendMessage: vi.fn(),
    });
  });

  it('sends RPC directly to Electron without using the global message bus', async () => {
    const message = {
      action: 'RNS_REQUEST',
      destination,
      path: '/example/status',
      payload: { requestId: 'request-1' },
    };

    await expect(
      dispatchQAppReticulumRequest(message, context)
    ).resolves.toEqual({ ok: true });

    expect(authorizeRnsDestination).toHaveBeenCalledWith(destination, true, {
      name: 'ExampleApp',
      tabId: 42,
    });
    expect(window.electronAPI.qappReticulumRequest).toHaveBeenCalledWith(
      owner,
      message
    );
    expect(window.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps realtime connections scoped to their Q-App owner', async () => {
    await dispatchQAppReticulumRequest(
      { action: 'RNS_CONNECT', destination },
      context
    );
    await dispatchQAppReticulumRequest(
      {
        action: 'RNS_SEND',
        connectionId: 'connection',
        payload: { type: 'ping' },
      },
      context
    );
    await dispatchQAppReticulumRequest(
      { action: 'RNS_CLOSE', connectionId: 'connection' },
      context
    );

    expect(window.electronAPI.qappReticulumConnect).toHaveBeenCalledWith(
      owner,
      destination
    );
    expect(window.electronAPI.qappReticulumSend).toHaveBeenCalledWith(
      owner,
      'connection',
      { type: 'ping' }
    );
    expect(window.electronAPI.qappReticulumClose).toHaveBeenCalledWith(
      owner,
      'connection'
    );
    expect(window.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects malformed connection operations before native dispatch', async () => {
    await expect(
      dispatchQAppReticulumRequest(
        { action: 'RNS_SEND', payload: 'message' },
        context
      )
    ).rejects.toThrow('RNS_UNKNOWN_CONNECTION');

    expect(window.electronAPI.qappReticulumSend).not.toHaveBeenCalled();
    expect(window.sendMessage).not.toHaveBeenCalled();
  });
});
