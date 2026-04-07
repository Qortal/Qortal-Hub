import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { CallManager } from './call';
import { GroupCallManager } from './group-call';
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

  sendCall = vi.fn(async () => true);
}

class GroupBridgeStub extends EventEmitter {
  getState(): 'ready' {
    return 'ready';
  }

  sendGroupCall = vi.fn(async () => true);
  sendGroupCallDetailed = vi.fn(async () => ({ ok: true as const }));
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
    expect(bridge.sendCall).toHaveBeenCalledTimes(1);
    manager.stop();
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
