import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  CallManager,
  resolveDirectCallSourceEndpoint,
  startCallManager,
  stopCallManager,
} from './call';
import { GroupCallManager } from './group-call';
import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSender,
} from './reticulum-wire-size';
import {
  buildEnvelope,
  setPresenceManagerTransports,
  startPresenceManager,
  stopPresenceManager,
} from './presence';

class CallBridgeStub extends EventEmitter {
  getState(): 'ready' {
    return 'ready';
  }

  getLocalDestinationHash(): string {
    return 'a'.repeat(32);
  }

  fanoutCallDetailed = vi.fn(
    async (
      _messages: Record<string, unknown>[],
      _excludePeerHashes?: string[]
    ) => ({ ok: true as const })
  );
  sendCall = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) => true
  );
  sendCallDetailed = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) => ({
      ok: true as const,
    })
  );
}

class GroupBridgeStub extends EventEmitter {
  getState(): 'ready' {
    return 'ready';
  }

  fanoutGroupCallDetailed = vi.fn(
    async (
      _messages: Record<string, unknown>[],
      _excludePeerHashes?: string[]
    ) => ({ ok: true as const })
  );
  sendGroupCall = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) => true
  );
  sendGroupCallDetailed = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) => ({
      ok: true as const,
    })
  );
  configureGroupAudioForwarding = vi.fn(async () => ({ ok: true as const }));
}

class PresenceTransportStub {
  readonly kind = 'reticulum' as const;
  subscriptions = 0;
  publish = vi.fn(async () => true);

  subscribe(): () => void {
    this.subscriptions += 1;
    return () => {
      this.subscriptions -= 1;
    };
  }
}

function presenceStub() {
  const getRouteForAddress = vi.fn(() => null as any);
  return {
    on: vi.fn(),
    off: vi.fn(),
    getRouteForAddress,
    getRoutesForAddress: vi.fn(() => {
      const route = getRouteForAddress();
      return route ? [route] : [];
    }),
    getReticulumActiveNeighborHashes: vi.fn(() => []),
    getNodeIdForAddress: vi.fn(() => null),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  stopPresenceManager();
});

describe('Reticulum manager late bridge binding', () => {
  it('never selects an unrelated relay as a direct-call endpoint', () => {
    const deviceA = 'a'.repeat(32);
    const deviceB = 'b'.repeat(32);
    const relay = 'c'.repeat(32);

    expect(resolveDirectCallSourceEndpoint([deviceA], relay, relay)).toBe(
      deviceA
    );
    expect(
      resolveDirectCallSourceEndpoint([deviceA, deviceB], relay, relay)
    ).toBeNull();
    expect(
      resolveDirectCallSourceEndpoint([deviceA, deviceB], deviceB, relay)
    ).toBe(deviceB);
  });

  it('rebinds PresenceManager transports and republishes cached local presence', async () => {
    const firstTransport = new PresenceTransportStub();
    const secondTransport = new PresenceTransportStub();
    const manager = startPresenceManager([]);
    const cachedEnvelope = buildEnvelope(
      'PRESENCE_ANNOUNCE',
      {
        address: 'Q-test',
        publicKey: 'pub',
        sessionId: 'session-1',
        status: 'online',
        clientVersion: 'test',
      },
      Date.now(),
      'sig'
    );
    (manager as any).lastLocalEnvelope = cachedEnvelope;

    setPresenceManagerTransports([firstTransport]);
    expect(firstTransport.subscriptions).toBe(1);
    expect(firstTransport.publish).toHaveBeenCalledTimes(1);
    expect(firstTransport.publish).toHaveBeenCalledWith(cachedEnvelope);

    setPresenceManagerTransports([secondTransport]);
    expect(firstTransport.subscriptions).toBe(0);
    expect(secondTransport.subscriptions).toBe(1);
    expect(secondTransport.publish).toHaveBeenCalledTimes(1);
    expect(secondTransport.publish).toHaveBeenCalledWith(cachedEnvelope);

    stopPresenceManager();
    expect(secondTransport.subscriptions).toBe(0);
  });

  it('prefers a fresh Reticulum route even when a newer non-Reticulum session exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(200_000);
    const manager = startPresenceManager([]);
    const address = 'Q-peer';

    (manager as any).sessions.set(`${address}:reticulum`, {
      address,
      publicKey: 'pk-reticulum',
      sessionId: 'reticulum',
      lastSeen: 180_000,
      firstSeen: 180_000,
      originNodeId: 'reticulum:peer-hash',
      viaPeerId: 'reticulum:peer-hash',
      route: { kind: 'reticulum', destinationHash: 'peer-hash' },
      routeLastValidated: 180_000,
      routeExpiresAt: 225_000,
      clientVersion: 'test',
      status: 'online',
      signatureValid: true,
    });
    (manager as any).sessions.set(`${address}:local`, {
      address,
      publicKey: 'pk-local',
      sessionId: 'local',
      lastSeen: 195_000,
      firstSeen: 195_000,
      originNodeId: 'local',
      viaPeerId: 'local',
      route: { kind: 'local' },
      routeLastValidated: 195_000,
      routeExpiresAt: null,
      clientVersion: 'test',
      status: 'online',
      signatureValid: true,
    });
    (manager as any).sessionKeysByAddress.set(
      address,
      new Set([`${address}:reticulum`, `${address}:local`])
    );

    expect(manager.isAddressOnline(address)).toBe(true);
    expect(manager.getRouteForAddress(address)).toEqual({
      kind: 'reticulum',
      destinationHash: 'peer-hash',
    });
  });

  it('attaches and detaches the CallManager bridge listener after start', () => {
    const manager = new CallManager(presenceStub() as any, null);
    const firstBridge = new CallBridgeStub();
    const secondBridge = new CallBridgeStub();

    manager.start();
    expect(firstBridge.listenerCount('call-message')).toBe(0);

    manager.setReticulumBridge(firstBridge as any);
    expect(firstBridge.listenerCount('call-message')).toBe(1);

    manager.setReticulumBridge(secondBridge as any);
    expect(firstBridge.listenerCount('call-message')).toBe(0);
    expect(secondBridge.listenerCount('call-message')).toBe(1);

    manager.stop();
    expect(secondBridge.listenerCount('call-message')).toBe(0);
  });

  it('does not initiate direct calls over a mesh-only route', async () => {
    vi.useFakeTimers();
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'mesh-node',
      id: 'mesh-peer',
    });
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presence as any, bridge as any);

    manager.start();
    const pending = manager.initiateCall(
      'Q-peer',
      'direct:Q-local:Q-peer',
      'Q-local',
      'sig',
      'pub',
      'call-1',
      Date.now()
    );
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(pending).resolves.toBeNull();
    expect(bridge.fanoutCallDetailed).not.toHaveBeenCalled();
    expect(bridge.sendCall).not.toHaveBeenCalled();
    manager.stop();
  });

  it('initiates direct calls over Reticulum when a route is present', async () => {
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'reticulum',
      destinationHash: 'a'.repeat(32),
    });
    presence.getReticulumActiveNeighborHashes.mockReturnValue(['b'.repeat(32)]);
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presence as any, bridge as any);

    manager.start();
    await expect(
      manager.initiateCall(
        'Q-peer',
        'direct:Q-local:Q-peer',
        'Q-local',
        'sig',
        'pub',
        'call-2',
        Date.now()
      )
    ).resolves.toBe('call-2');
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(1);
    expect(bridge.sendCall).not.toHaveBeenCalled();
    manager.stop();
  });

  it('emits a durable no-answer outcome when an outgoing direct call times out', async () => {
    vi.useFakeTimers();
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'reticulum',
      destinationHash: 'a'.repeat(32),
    });
    const manager = new CallManager(
      presence as any,
      new CallBridgeStub() as any
    );
    const history = vi.fn();
    manager.on('call:history', history);
    manager.start();

    await manager.initiateCall(
      'Q-peer',
      'direct:Q-local:Q-peer',
      'Q-local',
      'sig',
      'pub',
      'call-timeout',
      1_000
    );
    await vi.advanceTimersByTimeAsync(60_000);

    expect(history).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-timeout',
        direction: 'outbound',
        outcome: 'no_answer',
      })
    );
    manager.stop();
  });

  it('keeps a routed call request alive through a brief bridge readiness flap', async () => {
    vi.useFakeTimers();
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'reticulum',
      destinationHash: 'a'.repeat(32),
    });
    const bridge = new CallBridgeStub();
    let ready = false;
    vi.spyOn(bridge, 'getState').mockImplementation(() =>
      ready ? 'ready' : ('starting' as any)
    );
    const manager = new CallManager(presence as any, bridge as any);

    manager.start();
    await expect(
      manager.initiateCall(
        'Q-peer',
        'direct:Q-local:Q-peer',
        'Q-local',
        'sig',
        'pub',
        'call-bridge-flap',
        Date.now()
      )
    ).resolves.toBe('call-bridge-flap');
    expect(bridge.fanoutCallDetailed).not.toHaveBeenCalled();

    ready = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it('repeats CALL_ACCEPT so the caller is not stuck waiting after one lost packet', async () => {
    vi.useFakeTimers();
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);

    manager.start();
    (manager as any).activeCalls.set('call-accept-repeat', {
      callId: 'call-accept-repeat',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-hash',
      chatId: 'direct:Q-local:Q-peer',
      direction: 'inbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    manager.acceptCall('call-accept-repeat', 'sig', 'pub', Date.now());

    expect(bridge.sendCallDetailed).toHaveBeenCalledTimes(1);
    expect(bridge.sendCallDetailed).toHaveBeenLastCalledWith(
      'peer-hash',
      expect.objectContaining({ t: 'CA', c: 'call-accept-repeat' })
    );
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          t: 'CA',
          c: 'call-accept-repeat',
          U: 'Q-peer',
          L: 4,
        }),
      ],
      []
    );
    await vi.advanceTimersByTimeAsync(350 * 4);
    expect(bridge.sendCallDetailed).toHaveBeenCalledTimes(5);
    manager.stop();
  });

  it('keeps CALL_ACCEPT delivery alive while the pinned return link opens', async () => {
    vi.useFakeTimers();
    const bridge = new CallBridgeStub();
    const routeReadyAt = Date.now() + 5_000;
    bridge.sendCallDetailed.mockImplementation(async () =>
      Date.now() >= routeReadyAt
        ? { ok: true as const }
        : {
            ok: false as const,
            reason: 'send-command-failed' as const,
            error: 'Packet send returned False',
          }
    );
    const manager = new CallManager(presenceStub() as any, bridge as any);

    manager.start();
    (manager as any).activeCalls.set('call-link-opening', {
      callId: 'call-link-opening',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-hash',
      chatId: 'direct:Q-local:Q-peer',
      direction: 'inbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    expect(
      manager.acceptCall('call-link-opening', 'sig', 'pub', Date.now())
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(5_100);

    expect(bridge.sendCallDetailed).toHaveBeenCalledWith(
      'peer-hash',
      expect.objectContaining({ t: 'CA', c: 'call-link-opening' })
    );
    const latestSend = bridge.sendCallDetailed.mock.results.at(-1);
    expect(latestSend?.type).toBe('return');
    await expect(latestSend?.value).resolves.toEqual({ ok: true });
    manager.stop();
  });

  it('uses an acknowledged authenticated media link for active DM hangup without fanout', async () => {
    const peerHash = 'b'.repeat(32);
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    manager.start();
    (manager as any).activeCalls.set('call-direct-hangup', {
      callId: 'call-direct-hangup',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: peerHash,
      acceptedReticulumPeerHash: peerHash,
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'active',
      startedAt: Date.now(),
    });
    manager.setDmCallLinkControlSender(async (input) => {
      queueMicrotask(() => {
        manager.acknowledgeDmCallLinkHangup({
          kind: 'hangup-ack',
          callId: input.callId,
          chatId: input.chatId,
          controlId: input.controlId,
          fromAddress: input.toAddress,
          toAddress: input.fromAddress,
          timestamp: Date.now(),
          verifiedPeerDestinationHash: peerHash,
        });
      });
      return { success: true };
    });

    await manager.hangUp(
      'call-direct-hangup',
      'hangup-signature',
      'local-public-key',
      Date.now()
    );

    expect(bridge.sendCallDetailed).not.toHaveBeenCalled();
    expect(bridge.fanoutCallDetailed).not.toHaveBeenCalled();
    expect((manager as any).activeCalls.has('call-direct-hangup')).toBe(false);
    manager.stop();
  });

  it('fans out active DM hangup when the dedicated media link is not acknowledged', async () => {
    vi.useFakeTimers();
    const peerHash = 'c'.repeat(32);
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    manager.start();
    (manager as any).activeCalls.set('call-hangup-fallback', {
      callId: 'call-hangup-fallback',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: peerHash,
      acceptedReticulumPeerHash: peerHash,
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'active',
      startedAt: Date.now(),
    });
    manager.setDmCallLinkControlSender(
      () => new Promise<{ success: boolean }>(() => {})
    );

    const hangup = manager.hangUp(
      'call-hangup-fallback',
      'hangup-signature',
      'local-public-key',
      Date.now()
    );
    await vi.advanceTimersByTimeAsync(901);
    await hangup;

    expect(bridge.sendCallDetailed).toHaveBeenCalledWith(
      peerHash,
      expect.objectContaining({ t: 'CH', c: 'call-hangup-fallback' })
    );
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          t: 'CH',
          c: 'call-hangup-fallback',
          U: 'Q-peer',
          L: 4,
        }),
      ],
      []
    );
    manager.stop();
  });

  it('does not let a stuck acknowledgment enqueue delay remote DM hangup', async () => {
    vi.useFakeTimers();
    const peerHash = 'e'.repeat(32);
    const manager = new CallManager(
      presenceStub() as any,
      new CallBridgeStub() as any
    );
    (manager as any).verifyPool = {
      start: vi.fn(),
      verify: vi.fn(async () => true),
      stop: vi.fn(),
    };
    manager.start();
    (manager as any).activeCalls.set('call-stuck-ack', {
      callId: 'call-stuck-ack',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: peerHash,
      chatId: 'direct:Q-local:Q-peer',
      direction: 'inbound',
      state: 'active',
      startedAt: Date.now(),
    });
    const remoteHangups: unknown[] = [];
    manager.on('call:hangup', (payload) => remoteHangups.push(payload));

    const handled = manager.handleDmCallLinkHangup(
      {
        kind: 'hangup',
        callId: 'call-stuck-ack',
        chatId: 'direct:Q-local:Q-peer',
        controlId: 'control-stuck-ack',
        fromAddress: 'Q-peer',
        toAddress: 'Q-local',
        timestamp: Date.now(),
        publicKey: 'peer-public-key',
        signature: 'hangup-signature',
        verifiedPeerDestinationHash: peerHash,
      },
      () => new Promise<{ success: boolean }>(() => {})
    );
    await vi.advanceTimersByTimeAsync(501);

    await expect(handled).resolves.toBe(true);
    expect(remoteHangups).toEqual([{ callId: 'call-stuck-ack' }]);
    expect((manager as any).activeCalls.has('call-stuck-ack')).toBe(false);
    manager.stop();
  });

  it('accepts a wallet-verified hangup only from the selected DM media endpoint', async () => {
    const peerHash = 'd'.repeat(32);
    const manager = new CallManager(
      presenceStub() as any,
      new CallBridgeStub() as any
    );
    (manager as any).verifyPool = {
      start: vi.fn(),
      verify: vi.fn(async () => true),
      stop: vi.fn(),
    };
    manager.start();
    (manager as any).activeCalls.set('call-inbound-link-hangup', {
      callId: 'call-inbound-link-hangup',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: peerHash,
      chatId: 'direct:Q-local:Q-peer',
      direction: 'inbound',
      state: 'active',
      startedAt: Date.now(),
    });
    const ack = vi.fn(async () => ({ success: true }));
    const remoteHangups: unknown[] = [];
    manager.on('call:hangup', (payload) => remoteHangups.push(payload));

    await expect(
      manager.handleDmCallLinkHangup(
        {
          kind: 'hangup',
          callId: 'call-inbound-link-hangup',
          chatId: 'direct:Q-local:Q-peer',
          controlId: 'control-1',
          fromAddress: 'Q-peer',
          toAddress: 'Q-local',
          timestamp: Date.now(),
          publicKey: 'peer-public-key',
          signature: 'hangup-signature',
          verifiedPeerDestinationHash: peerHash,
        },
        ack
      )
    ).resolves.toBe(true);

    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'hangup-ack',
        callId: 'call-inbound-link-hangup',
        fromAddress: 'Q-local',
        toAddress: 'Q-peer',
      })
    );
    expect(remoteHangups).toEqual([{ callId: 'call-inbound-link-hangup' }]);
    expect((manager as any).activeCalls.has('call-inbound-link-hangup')).toBe(
      false
    );
    manager.stop();
  });

  it('refuses to report acceptance for a call that is no longer ringing', () => {
    const manager = new CallManager(
      presenceStub() as any,
      new CallBridgeStub() as any
    );
    manager.start();

    expect(manager.acceptCall('missing-call', 'sig', 'pub', Date.now())).toBe(
      false
    );
    manager.stop();
  });

  it('pins an inbound call reply to the authenticated source device instead of the preferred account route', () => {
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'reticulum',
      destinationHash: 'other-laptop',
    });
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presence as any, bridge as any);
    manager.setLocalAddresses(['Q-local']);
    manager.start();

    (manager as any).applyVerifiedIncomingRequest(
      {
        type: 'CALL_REQUEST',
        callId: 'call-source-device',
        fromAddress: 'Q-peer',
        fromPublicKey: 'peer-public-key',
        chatId: 'direct:Q-local:Q-peer',
        signature: 'request-signature',
        timestamp: Date.now(),
      },
      { senderDestinationHash: 'calling-laptop' }
    );

    manager.acceptCall(
      'call-source-device',
      'accept-signature',
      'local-public-key',
      Date.now()
    );

    expect(bridge.sendCallDetailed).toHaveBeenCalledWith(
      'calling-laptop',
      expect.objectContaining({ t: 'CA', c: 'call-source-device' })
    );
    expect(bridge.sendCallDetailed).not.toHaveBeenCalledWith(
      'other-laptop',
      expect.anything()
    );
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          t: 'CA',
          c: 'call-source-device',
          U: 'Q-peer',
          L: 4,
        }),
      ],
      []
    );
    manager.stop();
  });

  it('pins a multi-device call to the first accepting endpoint and cancels the others', async () => {
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    (manager as any).verifyPool = {
      start: vi.fn(),
      verify: vi.fn(async () => true),
      stop: vi.fn(),
    };
    manager.start();
    const accepted: unknown[] = [];
    manager.on('call:accepted', (payload) => accepted.push(payload));
    (manager as any).activeCalls.set('call-multi-accept', {
      callId: 'call-multi-accept',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-a',
      invitedReticulumPeerHashes: new Set(['peer-a', 'peer-b']),
      rejectedReticulumPeerHashes: new Set(),
      cancellationSignature: 'hangup-signature',
      cancellationPublicKey: 'local-public-key',
      cancellationTimestamp: 123,
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    (manager as any).handleAccept(
      {
        type: 'CALL_ACCEPT',
        callId: 'call-multi-accept',
        fromPublicKey: 'peer-public-key',
        signature: 'accept-signature',
        timestamp: 124,
      },
      'peer-a'
    );
    await Promise.resolve();
    await Promise.resolve();

    expect((manager as any).activeCalls.get('call-multi-accept')).toMatchObject(
      {
        state: 'active',
        acceptedReticulumPeerHash: 'peer-a',
        reticulumPeerPresenceHash: 'peer-a',
      }
    );
    expect(accepted).toHaveLength(1);
    expect(bridge.sendCallDetailed).toHaveBeenCalledWith(
      'peer-b',
      expect.objectContaining({ t: 'CH', c: 'call-multi-accept' })
    );

    (manager as any).handleAccept(
      {
        type: 'CALL_ACCEPT',
        callId: 'call-multi-accept',
        fromPublicKey: 'peer-public-key',
        signature: 'late-accept-signature',
        timestamp: 125,
      },
      'peer-b'
    );
    await Promise.resolve();
    expect(accepted).toHaveLength(1);
    manager.stop();
  });

  it('retries cancellation to other ringing devices after a transient send failure', async () => {
    vi.useFakeTimers();
    const bridge = new CallBridgeStub();
    bridge.sendCallDetailed
      .mockResolvedValueOnce({
        ok: false as const,
        reason: 'bridge-overloaded',
      })
      .mockResolvedValue({ ok: true as const });
    const manager = new CallManager(presenceStub() as any, bridge as any);
    (manager as any).verifyPool = {
      start: vi.fn(),
      verify: vi.fn(async () => true),
      stop: vi.fn(),
    };
    manager.start();
    (manager as any).activeCalls.set('call-cancel-retry', {
      callId: 'call-cancel-retry',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-a',
      invitedReticulumPeerHashes: new Set(['peer-a', 'peer-b']),
      rejectedReticulumPeerHashes: new Set(),
      cancellationSignature: 'hangup-signature',
      cancellationPublicKey: 'local-public-key',
      cancellationTimestamp: 123,
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    (manager as any).handleAccept(
      {
        type: 'CALL_ACCEPT',
        callId: 'call-cancel-retry',
        fromPublicKey: 'peer-public-key',
        signature: 'accept-signature',
        timestamp: 124,
      },
      'peer-a'
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.sendCallDetailed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(bridge.sendCallDetailed).toHaveBeenCalledTimes(2);
    expect(bridge.sendCallDetailed).toHaveBeenLastCalledWith(
      'peer-b',
      expect.objectContaining({ t: 'CH', c: 'call-cancel-retry' })
    );
    manager.stop();
  });

  it('waits for every invited endpoint before treating a call as rejected', async () => {
    vi.useFakeTimers();
    const manager = new CallManager(
      presenceStub() as any,
      new CallBridgeStub() as any
    );
    (manager as any).verifyPool = {
      verify: vi.fn(async () => true),
      stop: vi.fn(),
    };
    const rejected: unknown[] = [];
    manager.on('call:rejected', (payload) => rejected.push(payload));
    (manager as any).activeCalls.set('call-multi-reject', {
      callId: 'call-multi-reject',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-a',
      invitedReticulumPeerHashes: new Set(['peer-a', 'peer-b']),
      rejectedReticulumPeerHashes: new Set(),
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });
    const rejection = {
      type: 'CALL_REJECT',
      callId: 'call-multi-reject',
      fromPublicKey: 'peer-public-key',
      signature: 'reject-signature',
      timestamp: 126,
    };

    (manager as any).handleReject(rejection, 'peer-a');
    await Promise.resolve();
    expect((manager as any).activeCalls.has('call-multi-reject')).toBe(true);
    expect(rejected).toHaveLength(0);

    (manager as any).handleReject(rejection, 'peer-b');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);
    expect((manager as any).activeCalls.has('call-multi-reject')).toBe(false);
    expect(rejected).toHaveLength(1);
    manager.stop();
    vi.useRealTimers();
  });

  it('emits not_friend only when the rejection reason is authenticated', async () => {
    const manager = new CallManager(presenceStub() as any, null);
    (manager as any).verifyPool = {
      verify: vi.fn(async (payload: { kind: string }) => payload.kind === 'gc'),
      stop: vi.fn(),
    };
    const rejected: Array<{ reason?: string }> = [];
    manager.on('call:rejected', (payload) => rejected.push(payload));
    (manager as any).activeCalls.set('call-reason', {
      callId: 'call-reason',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-a',
      invitedReticulumPeerHashes: new Set(['peer-a']),
      rejectedReticulumPeerHashes: new Set(),
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    (manager as any).handleReject(
      {
        type: 'CALL_REJECT',
        callId: 'call-reason',
        reason: 'not_friend',
        fromPublicKey: 'peer-public-key',
        signature: 'reason-signature',
        timestamp: Date.now(),
      },
      'peer-a'
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(rejected).toEqual([{ callId: 'call-reason', reason: 'not_friend' }]);
  });

  it('falls back to a generic decline when a reason is not authenticated', async () => {
    vi.useFakeTimers();
    const manager = new CallManager(presenceStub() as any, null);
    (manager as any).verifyPool = {
      verify: vi.fn(
        async (payload: { kind: string }) => payload.kind === 'call_signed'
      ),
      stop: vi.fn(),
    };
    const rejected: Array<{ reason?: string }> = [];
    manager.on('call:rejected', (payload) => rejected.push(payload));
    (manager as any).activeCalls.set('call-forged-reason', {
      callId: 'call-forged-reason',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-a',
      invitedReticulumPeerHashes: new Set(['peer-a']),
      rejectedReticulumPeerHashes: new Set(),
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    (manager as any).handleReject(
      {
        type: 'CALL_REJECT',
        callId: 'call-forged-reason',
        reason: 'not_friend',
        fromPublicKey: 'peer-public-key',
        signature: 'legacy-signature',
        timestamp: Date.now(),
      },
      'peer-a'
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);

    expect(rejected).toEqual([
      { callId: 'call-forged-reason', reason: 'rejected' },
    ]);
    vi.useRealTimers();
  });

  it('sends a size-safe authenticated reason before the legacy rejection', () => {
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    const callId = '123e4567-e89b-12d3-a456-426614174000';
    manager.start();
    (manager as any).activeCalls.set(callId, {
      callId,
      localAddress: `Q${'a'.repeat(33)}`,
      remoteAddress: `Q${'b'.repeat(33)}`,
      reticulumPeerPresenceHash: 'b'.repeat(32),
      chatId: `direct:Q${'a'.repeat(33)}:Q${'b'.repeat(33)}`,
      direction: 'inbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    manager.rejectCall(
      callId,
      'not_friend',
      'L'.repeat(88),
      'P'.repeat(44),
      Date.now(),
      'R'.repeat(88)
    );

    expect(bridge.sendCallDetailed).toHaveBeenCalledTimes(2);
    const reasonWire = vi.mocked(bridge.sendCallDetailed).mock.calls[0]![1];
    const legacyWire = vi.mocked(bridge.sendCallDetailed).mock.calls[1]![1];
    expect(reasonWire).toMatchObject({
      t: 'CX',
      e: 'not_friend',
      g: 'R'.repeat(88),
    });
    expect(legacyWire).toMatchObject({ t: 'CX', g: 'L'.repeat(88) });
    expect(legacyWire).not.toHaveProperty('e');
    expect(byteLengthUtf8JsonWithBridgeSender(reasonWire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    manager.stop();
  });

  it('exposes accepted outbound calls for renderer subscribe replay', () => {
    const manager = new CallManager(presenceStub() as any, null);

    (manager as any).activeCalls.set('call-active-outbound', {
      callId: 'call-active-outbound',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-hash',
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'active',
      startedAt: Date.now(),
    });
    (manager as any).activeCalls.set('call-pending-outbound', {
      callId: 'call-pending-outbound',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'peer-hash',
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });

    expect(manager.getActiveOutboundAcceptedPayloads()).toEqual([
      { callId: 'call-active-outbound' },
    ]);
  });

  it('exposes only the authenticated active device route to the media join path', () => {
    const manager = new CallManager(presenceStub() as any, null);
    const chatId = 'direct:Q-local:Q-peer';

    (manager as any).activeCalls.set('active-outbound', {
      callId: 'active-outbound',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'initial-route',
      acceptedReticulumPeerHash: 'answering-laptop',
      chatId,
      direction: 'outbound',
      state: 'active',
      startedAt: Date.now(),
    });

    expect(
      manager.getActiveMediaPeerDestinationHash(
        chatId,
        'Q-local',
        'active-outbound'
      )
    ).toBe('answering-laptop');
    expect(
      manager.getActiveMediaPeerDestinationHash(
        chatId,
        'Q-local',
        'different-call'
      )
    ).toBeNull();
    expect(
      manager.getActiveMediaPeerDestinationHash(chatId, 'Q-other-account')
    ).toBeNull();

    (manager as any).activeCalls.set('active-inbound', {
      callId: 'active-inbound',
      localAddress: 'Q-local-2',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: 'calling-laptop',
      chatId: 'direct:Q-local-2:Q-peer',
      direction: 'inbound',
      state: 'active',
      startedAt: Date.now(),
    });

    expect(
      manager.getActiveMediaPeerDestinationHash(
        'direct:Q-local-2:Q-peer',
        'Q-local-2'
      )
    ).toBe('calling-laptop');
  });

  it('does not drop a compact inbound direct call before local addresses are registered', () => {
    vi.useFakeTimers();
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    const callId = '123e4567-e89b-12d3-a456-426614174001';
    const caller = `Q${'b'.repeat(33)}`;
    const local = `Q${'a'.repeat(33)}`;
    const publicKey = 'pub-caller';
    const signature = 'sig-caller';
    const timestamp = Date.now();
    const handleRequestSpy = vi
      .spyOn(manager as any, 'handleRequestReticulum')
      .mockImplementation(() => {});

    manager.start();

    bridge.emit(
      'call-message',
      {
        t: 'CR',
        c: callId,
        a: caller,
        k: publicKey,
        g: signature,
        m: timestamp,
        U: local,
        L: 4,
        X: 'overlay-cr-before-local-address',
      },
      'sender-hash',
      'sender-hash'
    );

    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(1);
    expect(handleRequestSpy).toHaveBeenCalledWith(
      'sender-hash',
      expect.objectContaining({
        type: 'CALL_REQUEST',
        callId,
        fromAddress: caller,
        chatId: `direct:${[local, caller].sort().join(':')}`,
      })
    );
    manager.stop();
  });

  it('relays inbound direct call overlays even when the target address is local', () => {
    vi.useFakeTimers();
    const bridge = new CallBridgeStub();
    const presence = presenceStub();
    const senderHash = 'b'.repeat(32);
    const transportHash = 'c'.repeat(32);
    presence.getRoutesForAddress.mockReturnValue([
      { kind: 'reticulum', destinationHash: senderHash },
    ]);
    const manager = new CallManager(presence as any, bridge as any);
    const callId = '123e4567-e89b-12d3-a456-426614174002';
    const caller = `Q${'c'.repeat(33)}`;
    const local = `Q${'a'.repeat(33)}`;
    const publicKey = 'pub-caller';
    const signature = 'sig-caller';
    const timestamp = Date.now();
    const handleRequestSpy = vi
      .spyOn(manager as any, 'handleRequestReticulum')
      .mockImplementation(() => {});

    manager.setLocalAddresses([local]);
    manager.start();

    bridge.emit(
      'call-message',
      {
        t: 'CR',
        c: callId,
        a: caller,
        k: publicKey,
        g: signature,
        m: timestamp,
        U: local,
        L: 4,
        X: 'overlay-cr-target-local',
      },
      senderHash,
      transportHash
    );

    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(1);
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          t: 'CR',
          c: callId,
          U: local,
          L: 3,
          X: 'overlay-cr-target-local',
        }),
      ],
      [transportHash]
    );
    expect(handleRequestSpy).toHaveBeenCalledWith(
      senderHash,
      expect.objectContaining({
        type: 'CALL_REQUEST',
        callId,
        fromAddress: caller,
        chatId: `direct:${[local, caller].sort().join(':')}`,
      })
    );
    manager.stop();
  });

  it('uses the authenticated direct link peer for legacy call frames without a stamped source', () => {
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    const handleRequestSpy = vi
      .spyOn(manager as any, 'handleRequestReticulum')
      .mockImplementation(() => {});

    manager.start();
    bridge.emit(
      'call-message',
      {
        t: 'CR',
        c: 'legacy-direct-call',
        a: 'Q-peer',
        k: 'peer-public-key',
        g: 'peer-signature',
        m: Date.now(),
        U: 'Q-local',
      },
      '',
      'authenticated-link-peer'
    );

    expect(handleRequestSpy).toHaveBeenCalledWith(
      'authenticated-link-peer',
      expect.objectContaining({ callId: 'legacy-direct-call' })
    );
    manager.stop();
  });

  it('does not let an old relay poison DM call routing or overlay dedupe', () => {
    const bridge = new CallBridgeStub();
    const presence = presenceStub() as any;
    const deviceA = 'a'.repeat(32);
    const deviceB = 'b'.repeat(32);
    const relay = 'c'.repeat(32);
    presence.getRoutesForAddress = vi.fn(() => [
      { kind: 'reticulum', destinationHash: deviceA },
      { kind: 'reticulum', destinationHash: deviceB },
    ]);
    const manager = new CallManager(presence, bridge as any);
    const handleAcceptSpy = vi
      .spyOn(manager as any, 'handleAccept')
      .mockImplementation(() => {});
    (manager as any).activeCalls.set('call-mixed-relay', {
      callId: 'call-mixed-relay',
      localAddress: 'Q-local',
      remoteAddress: 'Q-peer',
      reticulumPeerPresenceHash: deviceA,
      invitedReticulumPeerHashes: new Set([deviceA, deviceB]),
      chatId: 'direct:Q-local:Q-peer',
      direction: 'outbound',
      state: 'pending',
      startedAt: Date.now(),
    });
    manager.setLocalAddresses(['Q-local']);
    manager.start();

    const wire = {
      t: 'CA',
      c: 'call-mixed-relay',
      k: 'peer-public-key',
      g: 'peer-signature',
      m: Date.now(),
      U: 'Q-local',
      L: 2,
      X: 'same-overlay-id',
    };
    bridge.emit('call-message', wire, relay, relay);
    expect(handleAcceptSpy).not.toHaveBeenCalled();

    bridge.emit('call-message', wire, deviceB, relay);
    expect(handleAcceptSpy).toHaveBeenCalledTimes(1);
    expect(handleAcceptSpy).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call-mixed-relay' }),
      deviceB
    );
    manager.stop();
  });

  it('uses the signed route-bound call id through a legacy relay', () => {
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presenceStub() as any, bridge as any);
    const callerDestination = 'b'.repeat(32);
    const relayDestination = 'c'.repeat(32);
    const callId = `Cu7u7u7u7u7u7u7u7u7u7uwABCDEFGHIJKLM`;
    expect(callId).toHaveLength(36);
    const handleRequestSpy = vi
      .spyOn(manager as any, 'handleRequestReticulum')
      .mockImplementation(() => {});
    manager.setLocalAddresses(['Q-local']);
    manager.start();

    const wire = {
      t: 'CR',
      c: callId,
      a: 'Q-caller',
      k: 'caller-public-key',
      g: 'caller-signature',
      m: Date.now(),
      U: 'Q-local',
      L: 1,
      X: 'route-bound-call-overlay',
      r: relayDestination,
    };

    bridge.emit('call-message', wire, relayDestination, relayDestination);
    expect(handleRequestSpy).toHaveBeenCalledWith(
      callerDestination,
      expect.objectContaining({ callId })
    );
    manager.stop();
  });

  it('restores registered call local addresses after CallManager restart', () => {
    const presence = presenceStub();
    const firstBridge = new CallBridgeStub();
    const first = startCallManager(presence as any, firstBridge as any);
    first.setLocalAddresses(['Q-local']);

    stopCallManager();

    const secondBridge = new CallBridgeStub();
    const second = startCallManager(presence as any, secondBridge as any);

    expect((second as any).localAddresses.has('Q-local')).toBe(true);

    second.setLocalAddresses([]);
    stopCallManager();

    const third = startCallManager(
      presence as any,
      new CallBridgeStub() as any
    );
    expect((third as any).localAddresses.size).toBe(0);
  });

  it('compacts realistic direct call requests to fit Reticulum wire limits', async () => {
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'reticulum',
      destinationHash: 'a'.repeat(32),
    });
    presence.getReticulumActiveNeighborHashes.mockReturnValue(['b'.repeat(32)]);
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presence as any, bridge as any);

    const local = `Q${'a'.repeat(33)}`;
    const peer = `Q${'b'.repeat(33)}`;
    const chatId = `direct:${[local, peer].sort().join(':')}`;
    const signature = 'S'.repeat(88);
    const publicKey = 'P'.repeat(44);
    const callId = '123e4567-e89b-12d3-a456-426614174000';

    manager.start();
    await expect(
      manager.initiateCall(
        peer,
        chatId,
        local,
        signature,
        publicKey,
        callId,
        Date.now()
      )
    ).resolves.toBe(callId);

    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(1);
    const firstFanout = vi.mocked(bridge.fanoutCallDetailed).mock.calls[0];
    expect(firstFanout).toBeDefined();
    const sentWire = (
      firstFanout![0] as Record<string, unknown>[]
    )[0] as Record<string, unknown>;
    expect(sentWire).toMatchObject({
      t: 'CR',
      c: callId,
      a: local,
      k: publicKey,
      g: signature,
    });
    expect(firstFanout![1]).toEqual([]);
    expect(sentWire).not.toHaveProperty('H');
    expect(sentWire).not.toHaveProperty('type');
    expect(sentWire.X).toMatch(/^[0-9a-f]{16}$/);
    expect(byteLengthUtf8JsonWithBridgeSender(sentWire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    manager.stop();
  });

  it('keeps route-bound direct call requests within the encrypted MDU', async () => {
    const presence = presenceStub();
    presence.getRouteForAddress.mockReturnValue({
      kind: 'reticulum',
      destinationHash: 'b'.repeat(32),
    });
    const bridge = new CallBridgeStub();
    const manager = new CallManager(presence as any, bridge as any);
    const local = `Q${'a'.repeat(33)}`;
    const peer = `Q${'b'.repeat(33)}`;
    const chatId = `direct:${[local, peer].sort().join(':')}`;
    const callId = `CqqqqqqqqqqqqqqqqqqqqqgABCDEFGHIJKLM`;

    manager.start();
    await expect(
      manager.initiateCall(
        peer,
        chatId,
        local,
        'S'.repeat(88),
        'P'.repeat(44),
        callId,
        1_775_545_146_838
      )
    ).resolves.toBe(callId);

    const sentWire = vi.mocked(bridge.fanoutCallDetailed).mock.calls[0]![0][0]!;
    expect(sentWire.r).toBe('a'.repeat(32));
    expect(byteLengthUtf8JsonWithBridgeSender(sentWire)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    manager.stop();
  });

  it('reconstructs direct chatId from compact inbound call wire', () => {
    const manager = new CallManager(presenceStub() as any, null);
    const local = `Q${'a'.repeat(33)}`;
    const peer = `Q${'b'.repeat(33)}`;

    const parsed = (manager as any).parseCallEnvelope({
      t: 'CR',
      c: '123e4567-e89b-12d3-a456-426614174000',
      a: peer,
      k: 'P'.repeat(44),
      g: 'S'.repeat(88),
      m: 1775545146838,
      U: local,
    });

    expect(parsed).toEqual({
      type: 'CALL_REQUEST',
      callId: '123e4567-e89b-12d3-a456-426614174000',
      fromAddress: peer,
      fromPublicKey: 'P'.repeat(44),
      chatId: `direct:${[local, peer].sort().join(':')}`,
      signature: 'S'.repeat(88),
      timestamp: 1775545146838,
    });
  });

  it('attaches and detaches GroupCallManager bridge listeners after start', () => {
    const manager = new GroupCallManager(presenceStub() as any, null);
    const firstBridge = new GroupBridgeStub();
    const secondBridge = new GroupBridgeStub();

    manager.start();
    expect(firstBridge.listenerCount('group-call-message')).toBe(0);
    expect(firstBridge.listenerCount('group-audio-packet')).toBe(0);
    expect(firstBridge.listenerCount('group-audio-link-established')).toBe(0);
    expect(firstBridge.listenerCount('group-audio-link-closed')).toBe(0);

    manager.setReticulumBridge(firstBridge as any);
    expect(firstBridge.listenerCount('group-call-message')).toBe(1);
    expect(firstBridge.listenerCount('group-audio-packet')).toBe(1);
    expect(firstBridge.listenerCount('group-audio-link-established')).toBe(1);
    expect(firstBridge.listenerCount('group-audio-link-closed')).toBe(1);

    manager.setReticulumBridge(secondBridge as any);
    expect(firstBridge.listenerCount('group-call-message')).toBe(0);
    expect(firstBridge.listenerCount('group-audio-packet')).toBe(0);
    expect(firstBridge.listenerCount('group-audio-link-established')).toBe(0);
    expect(firstBridge.listenerCount('group-audio-link-closed')).toBe(0);
    expect(secondBridge.listenerCount('group-call-message')).toBe(1);
    expect(secondBridge.listenerCount('group-audio-packet')).toBe(1);
    expect(secondBridge.listenerCount('group-audio-link-established')).toBe(1);
    expect(secondBridge.listenerCount('group-audio-link-closed')).toBe(1);
    expect(firstBridge.configureGroupAudioForwarding).toHaveBeenCalledWith([], {
      startIfNeeded: false,
    });

    manager.stop();
    expect(secondBridge.listenerCount('group-call-message')).toBe(0);
    expect(secondBridge.listenerCount('group-audio-packet')).toBe(0);
    expect(secondBridge.listenerCount('group-audio-link-established')).toBe(0);
    expect(secondBridge.listenerCount('group-audio-link-closed')).toBe(0);
    expect(secondBridge.configureGroupAudioForwarding).toHaveBeenCalledWith(
      [],
      { startIfNeeded: false }
    );
  });
});
