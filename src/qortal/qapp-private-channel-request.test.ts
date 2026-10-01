import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hasSessionPermission } = vi.hoisted(() => ({
  hasSessionPermission: vi.fn(),
}));

vi.mock('./qortal-requests.ts', () => ({ hasSessionPermission }));

import { dispatchQAppPrivateChannelRequest } from './qapp-private-channel-request';

const context = {
  appName: ' Example-App ',
  appService: 'app',
  tabId: 42,
};
const owner = { name: 'example-app', service: 'APP', tabId: '42' };

describe('Q-App private channel request dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSessionPermission.mockReturnValue(true);
    Object.assign(window, {
      electronAPI: {
        privateChannelOpen: vi
          .fn()
          .mockResolvedValue({ channelId: 'private-1' }),
        privateChannelSend: vi.fn().mockResolvedValue({ accepted: true }),
        privateChannelStatus: vi.fn().mockResolvedValue({ state: 'OPEN' }),
        privateChannelClose: vi.fn().mockResolvedValue({ state: 'CLOSED' }),
      },
    });
  });

  it('requires the explicit PRIVATE_DATA_CHANNEL session permission', async () => {
    hasSessionPermission.mockReturnValue(false);
    await expect(
      dispatchQAppPrivateChannelRequest(
        {
          action: 'PRIVATE_CHANNEL_OPEN',
          rnsConnectionId: 'rns-1',
          purpose: 'game',
        },
        context
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(window.electronAPI.privateChannelOpen).not.toHaveBeenCalled();
  });

  it('uses normalized trusted context and forwards no arbitrary network fields', async () => {
    await dispatchQAppPrivateChannelRequest(
      {
        action: 'PRIVATE_CHANNEL_OPEN',
        rnsConnectionId: 'rns-1',
        purpose: 'game',
        owner: { tabId: 'attacker' },
        destination: 'attacker.example',
        relay: '192.0.2.1',
        port: 443,
      },
      context
    );

    expect(window.electronAPI.privateChannelOpen).toHaveBeenCalledWith(
      owner,
      'rns-1',
      'game'
    );
  });

  it('uses narrow methods for send, status, and close', async () => {
    const data = new Uint8Array([1, 2]);
    await dispatchQAppPrivateChannelRequest(
      {
        action: 'PRIVATE_CHANNEL_SEND',
        channelId: 'private-1',
        lane: 'reliable',
        messageId: 'message-1',
        data,
        destination: 'ignored',
      },
      context
    );
    await dispatchQAppPrivateChannelRequest(
      { action: 'PRIVATE_CHANNEL_STATUS', channelId: 'private-1' },
      context
    );
    await dispatchQAppPrivateChannelRequest(
      { action: 'PRIVATE_CHANNEL_CLOSE', channelId: 'private-1' },
      context
    );

    expect(window.electronAPI.privateChannelSend).toHaveBeenCalledWith(
      owner,
      'private-1',
      'reliable',
      'message-1',
      data,
      undefined
    );
    expect(window.electronAPI.privateChannelStatus).toHaveBeenCalledWith(
      owner,
      'private-1'
    );
    expect(window.electronAPI.privateChannelClose).toHaveBeenCalledWith(
      owner,
      'private-1'
    );
  });
});
