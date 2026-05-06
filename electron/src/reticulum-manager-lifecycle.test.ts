import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { CallManager, startCallManager, stopCallManager } from './call';
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

  fanoutCallDetailed = vi.fn(
    async (_messages: Record<string, unknown>[], _excludePeerHashes?: string[]) =>
      ({ ok: true as const })
  );
  sendCall = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) => true
  );
}

class GroupBridgeStub extends EventEmitter {
  getState(): 'ready' {
    return 'ready';
  }

  fanoutGroupCallDetailed = vi.fn(
    async (_messages: Record<string, unknown>[], _excludePeerHashes?: string[]) =>
      ({ ok: true as const })
  );
  sendGroupCall = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) => true
  );
  sendGroupCallDetailed = vi.fn(
    async (_peerHash: string, _message: Record<string, unknown>) =>
      ({ ok: true as const })
  );
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
  return {
    on: vi.fn(),
    off: vi.fn(),
    getRouteForAddress: vi.fn(() => null),
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
    const manager = new CallManager(
      presenceStub() as any,
      null
    );
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

    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(350 * 4);
    expect(bridge.fanoutCallDetailed).toHaveBeenCalledTimes(5);
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

    const third = startCallManager(presence as any, new CallBridgeStub() as any);
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
    const sentWire = (firstFanout![0] as Record<string, unknown>[])[0] as Record<string, unknown>;
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
    const manager = new GroupCallManager(
      presenceStub() as any,
      null
    );
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

    manager.stop();
    expect(secondBridge.listenerCount('group-call-message')).toBe(0);
    expect(secondBridge.listenerCount('group-audio-packet')).toBe(0);
    expect(secondBridge.listenerCount('group-audio-link-established')).toBe(0);
    expect(secondBridge.listenerCount('group-audio-link-closed')).toBe(0);
  });
});
