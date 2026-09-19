import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hasSessionPermission } = vi.hoisted(() => ({
  hasSessionPermission: vi.fn(),
}));

vi.mock('./qortal-requests.ts', () => ({ hasSessionPermission }));

import { dispatchQAppMoqRequest } from './qapp-moq-request';

const context = { appName: ' Call-App ', appService: 'app', tabId: 42 };
const owner = { name: 'call-app', service: 'APP', tabId: '42' };

describe('Q-App MOQT request dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasSessionPermission.mockReturnValue(true);
    Object.assign(window, {
      electronAPI: {
        qappMoqOpen: vi.fn().mockResolvedValue({ sessionId: 'qapp-moq-1' }),
        qappMoqSubscribe: vi.fn().mockResolvedValue({ subscribed: true }),
        qappMoqPublish: vi.fn().mockResolvedValue({ accepted: true }),
        qappMoqMetrics: vi.fn().mockResolvedValue({ objectsSent: 1 }),
        qappMoqClose: vi.fn().mockResolvedValue({ state: 'CLOSED' }),
      },
    });
  });

  it('requires private-data permission', async () => {
    hasSessionPermission.mockReturnValue(false);
    await expect(
      dispatchQAppMoqRequest(
        {
          action: 'MOQ_SESSION_OPEN',
          rnsConnectionId: 'rns-1',
          publicationNamespace: ['qortal', 'call', 'room', 'Alice'],
          publicationTrack: 'audio',
        },
        context
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(window.electronAPI.qappMoqOpen).not.toHaveBeenCalled();
  });

  it('uses trusted normalized ownership and ignores network injection fields', async () => {
    await dispatchQAppMoqRequest(
      {
        action: 'MOQ_SESSION_OPEN',
        rnsConnectionId: 'rns-1',
        publicationNamespace: ['qortal', 'call', 'room', 'Alice'],
        publicationTrack: 'audio',
        relayAddress: 'attacker.example:443',
        backendAddress: 'attacker.example:4446',
      },
      context
    );
    expect(window.electronAPI.qappMoqOpen).toHaveBeenCalledWith(
      owner,
      'rns-1',
      ['qortal', 'call', 'room', 'Alice'],
      'audio'
    );
  });

  it('forwards only logical handles, tracks, and opaque payloads', async () => {
    const payload = new Uint8Array([1, 2]);
    await dispatchQAppMoqRequest(
      {
        action: 'MOQ_TRACK_SUBSCRIBE',
        sessionId: 'qapp-moq-1',
        subscriptionId: 'peer-Alice',
        namespace: ['qortal', 'call', 'room', 'Alice'],
        trackName: 'audio',
      },
      context
    );
    await dispatchQAppMoqRequest(
      {
        action: 'MOQ_OBJECT_PUBLISH',
        sessionId: 'qapp-moq-1',
        payload,
      },
      context
    );
    expect(window.electronAPI.qappMoqSubscribe).toHaveBeenCalledWith(
      owner,
      'qapp-moq-1',
      'peer-Alice',
      ['qortal', 'call', 'room', 'Alice'],
      'audio'
    );
    expect(window.electronAPI.qappMoqPublish).toHaveBeenCalledWith(
      owner,
      'qapp-moq-1',
      payload
    );
  });
});
