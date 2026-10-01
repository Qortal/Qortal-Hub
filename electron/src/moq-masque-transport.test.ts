import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  MoqMasqueTransport,
  type MoqTransportEvent,
} from './moq-masque-transport';
import type {
  PrivateBootstrapDescriptor,
  PrivateChannelBootstrapProvider,
} from './private-channel-bootstrap';
import {
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
} from './private-transport-sidecar';

const descriptor: PrivateBootstrapDescriptor = {
  version: 1,
  transport: 'quic-masque-inner-v1',
  logicalSessionId: 'logical-session',
  backendRnsDestination: 'ab'.repeat(16),
  backendTransportEndpoint: '127.0.0.1:4446',
  backendTransportServerName: 'application-private-backend',
  backendTransportCertSha256: 'cd'.repeat(32),
  attachToken: 'one-time-transport-token',
  expiresAt: Date.now() + 30_000,
  nonce: 'n'.repeat(32),
  ownerBindingHash: 'ef'.repeat(32),
  applicationProtocol: 'moqt-18',
  supportedFeatures: {
    reliable: true,
    datagrams: true,
    moqt: true,
    moqtReliableGroups: true,
  },
};

class FakeSidecar extends EventEmitter {
  private opened = 0;
  openMoqSession = vi.fn(async (config) => ({
    moqSessionId: `moq-session${++this.opened === 1 ? '' : `-${this.opened}`}`,
    logicalSessionId: config.logicalSessionId,
    publicationNamespace: config.publicationNamespace,
    publicationTrack: config.publicationTrack,
    applicationProtocol: 'moqt-18' as const,
  }));
  subscribeMoqTrack = vi.fn(async () => undefined);
  publishMoqObject = vi.fn(async () => undefined);
  moqSessionMetrics = vi.fn(async () => ({ objectsSent: 1 }));
  closeMoqSession = vi.fn(async () => undefined);
}

function setup(overrides: Partial<PrivateBootstrapDescriptor> = {}) {
  const sidecar = new FakeSidecar();
  const provider: PrivateChannelBootstrapProvider = {
    getBootstrap: vi.fn(async () => ({ ...descriptor, ...overrides })),
  };
  const events: MoqTransportEvent[] = [];
  const transport = new MoqMasqueTransport(
    (event) => events.push(event),
    sidecar as unknown as PrivateTransportSidecar,
    {
      relayAddress: '192.0.2.1:47322',
      relayServerName: 'qortal-masque-relay',
      relayCertSha256: '12'.repeat(32),
    },
    provider
  );
  return { sidecar, provider, events, transport };
}

const context = {
  owner: { tabId: 'tab-1', name: 'sample-app', service: 'APP' },
  rnsConnectionId: 'rns-connection',
  publicationNamespace: ['qortal', 'apps', 'sample', 'publisher-123'],
  publicationTrack: 'realtime-data',
};

describe('generic trusted MOQT transport', () => {
  it.each(['MOQ_QUEUE_LIMIT', 'MOQ_OBJECT_EXPIRED'])(
    'does not reconnect for expected delivery pressure: %s',
    async (code) => {
      const { transport, sidecar } = setup();
      await transport.open(context);
      sidecar.publishMoqObject.mockRejectedValueOnce(
        new PrivateTransportSidecarError(code)
      );
      await expect(
        transport.publish(
          new Uint8Array([1]),
          'realtime-data',
          [new Uint8Array([1])],
          { priority: 0, maxQueueAgeMillis: 120 }
        )
      ).rejects.toMatchObject({ code });
      expect(sidecar.openMoqSession).toHaveBeenCalledTimes(1);
      await transport.close();
    }
  );
  it.each([
    ['RELAY_ACCESS_DENIED', true],
    ['RELAY_MEMBERSHIP_UNAVAILABLE', true],
    ['ATTACH_TOKEN_REJECTED', false],
    ['MOQ_ATTACH_FAILED', false],
    ['BACKEND_IDENTITY_MISMATCH', false],
  ] as const)(
    'distinguishes %s from backend authentication rejection',
    async (code, retry) => {
      const { sidecar, transport } = setup();
      sidecar.openMoqSession.mockRejectedValueOnce(
        new PrivateTransportSidecarError(code)
      );
      if (retry) await transport.open(context);
      else
        await expect(transport.open(context)).rejects.toMatchObject({ code });
      expect(sidecar.openMoqSession).toHaveBeenCalledTimes(retry ? 2 : 1);
      await transport.close();
    }
  );
  it('refreshes credentials that almost expired while relay discovery ran', async () => {
    const { sidecar, provider, transport } = setup();
    vi.mocked(provider.getBootstrap)
      .mockResolvedValueOnce({
        ...descriptor,
        expiresAt: Date.now() + 1_000,
        attachToken: 'old',
      })
      .mockResolvedValueOnce({
        ...descriptor,
        expiresAt: Date.now() + 30_000,
        attachToken: 'fresh',
      });
    await transport.open(context);
    expect(provider.getBootstrap).toHaveBeenCalledTimes(2);
    expect(sidecar.openMoqSession).toHaveBeenCalledWith(
      expect.objectContaining({ attachToken: 'fresh' })
    );
    await transport.close();
  });
  it('uses an authenticated realtime bootstrap and transports opaque objects', async () => {
    const { sidecar, provider, transport } = setup();
    await transport.open(context);
    expect(provider.getBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'trusted-moq-transport',
        rnsConnectionId: context.rnsConnectionId,
        purpose: 'realtime',
        owner: context.owner,
      })
    );
    expect(sidecar.openMoqSession).toHaveBeenCalledWith({
      relayAddress: '192.0.2.1:47322',
      relayServerName: 'qortal-masque-relay',
      relayCertSha256: '12'.repeat(32),
      backendAddress: '127.0.0.1:4446',
      backendServerName: 'application-private-backend',
      backendCertSha256: 'cd'.repeat(32),
      logicalSessionId: 'logical-session',
      attachToken: 'one-time-transport-token',
      publicationNamespace: context.publicationNamespace,
      publicationTrack: 'realtime-data',
    });
    await transport.subscribe(
      'subscription-1',
      ['qortal', 'apps', 'sample', 'peer-456'],
      'events'
    );
    const opaquePayload = new Uint8Array([1, 2, 3]);
    await transport.publish(opaquePayload);
    expect(sidecar.subscribeMoqTrack).toHaveBeenCalledWith(
      'moq-session',
      'subscription-1',
      ['qortal', 'apps', 'sample', 'peer-456'],
      'events'
    );
    expect(sidecar.publishMoqObject).toHaveBeenCalledWith(
      'moq-session',
      opaquePayload
    );
  });

  it('rejects a descriptor that does not explicitly advertise MOQT', async () => {
    const { sidecar, transport } = setup({ applicationProtocol: undefined });
    await expect(transport.open(context)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MOQ_TRANSPORT',
    });
    expect(sidecar.openMoqSession).not.toHaveBeenCalled();
  });

  it('delivers only bounded generic objects belonging to its native session', async () => {
    const { sidecar, transport, events } = setup();
    await transport.open(context);
    sidecar.emit('event', {
      event: 'object',
      sessionId: 'another-session',
      subscriptionId: 'subscription-1',
      namespace: ['qortal', 'apps'],
      trackName: 'events',
      groupId: 0,
      objectId: 1,
      data: Buffer.from([9]),
    });
    sidecar.emit('event', {
      event: 'object',
      sessionId: 'moq-session',
      subscriptionId: 'subscription-1',
      namespace: ['qortal', 'apps'],
      trackName: 'events',
      groupId: 0,
      objectId: 1,
      data: Buffer.from([7, 8]),
    });
    expect(events).toEqual([
      {
        kind: 'object',
        subscriptionId: 'subscription-1',
        namespace: ['qortal', 'apps'],
        trackName: 'events',
        groupId: 0,
        objectId: 1,
        payload: new Uint8Array([7, 8]),
      },
    ]);
    await transport.close();
    expect(sidecar.closeMoqSession).toHaveBeenCalledWith('moq-session');
  });

  it('does not reconnect the media connection when one reliable object expires', async () => {
    const { sidecar, transport } = setup();
    await transport.open(context);
    sidecar.publishMoqObject.mockRejectedValueOnce(
      new PrivateTransportSidecarError('MOQ_OBJECT_EXPIRED')
    );
    const payload = new Uint8Array(2000);
    await expect(
      transport.publish(payload, 'events', [payload], {
        priority: 1,
        maxQueueAgeMillis: 1500,
        groupId: 1,
        objectId: 1,
      })
    ).rejects.toMatchObject({ code: 'MOQ_OBJECT_EXPIRED' });
    expect(sidecar.openMoqSession).toHaveBeenCalledTimes(1);
    await transport.close();
  });

  it('does not retry an attach failure as a direct connection', async () => {
    const { sidecar, transport } = setup();
    sidecar.openMoqSession.mockRejectedValueOnce(
      new PrivateTransportSidecarError('MOQ_ATTACH_FAILED')
    );
    await expect(transport.open(context)).rejects.toMatchObject({
      code: 'MOQ_ATTACH_FAILED',
    });
    expect(sidecar.openMoqSession).toHaveBeenCalledTimes(1);
  });

  it('moves to another relay with a fresh token and restores subscriptions', async () => {
    const sidecar = new FakeSidecar();
    let bootstrapNumber = 0;
    const provider: PrivateChannelBootstrapProvider = {
      getBootstrap: vi.fn(async () => ({
        ...descriptor,
        logicalSessionId: `logical-${++bootstrapNumber}`,
        attachToken: `one-time-token-${bootstrapNumber}`,
      })),
    };
    const relayProvider = vi.fn(async (excluded?: ReadonlySet<string>) => ({
      relayAddress: excluded?.has('8.8.8.8:47322')
        ? '1.1.1.1:47322'
        : '8.8.8.8:47322',
      relayServerName: 'relay.test',
      relayCertSha256: '12'.repeat(32),
    }));
    const events: MoqTransportEvent[] = [];
    const transport = new MoqMasqueTransport(
      (event) => events.push(event),
      sidecar as never,
      relayProvider,
      provider
    );
    await transport.open(context);
    await transport.subscribe(
      'subscription-1',
      ['qortal', 'apps', 'sample', 'peer-456'],
      'events'
    );

    sidecar.emit('event', {
      event: 'error',
      sessionId: 'moq-session',
      code: 'MOQ_READ_FAILED',
      subscriptionId: 'subscription-1',
      data: Buffer.alloc(0),
    });
    await transport.publish(new Uint8Array([9]));

    expect(
      sidecar.openMoqSession.mock.calls.map(([config]) => config.relayAddress)
    ).toEqual(['8.8.8.8:47322', '1.1.1.1:47322']);
    expect(
      sidecar.openMoqSession.mock.calls.map(([config]) => config.attachToken)
    ).toEqual(['one-time-token-1', 'one-time-token-2']);
    expect(sidecar.subscribeMoqTrack).toHaveBeenLastCalledWith(
      'moq-session-2',
      'subscription-1',
      ['qortal', 'apps', 'sample', 'peer-456'],
      'events'
    );
    expect(sidecar.publishMoqObject).toHaveBeenCalledWith(
      'moq-session-2',
      new Uint8Array([9])
    );
    expect(events).toEqual([]);
  });
});
