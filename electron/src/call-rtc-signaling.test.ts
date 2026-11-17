import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { CallManager } from './call';
import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSenderOnly,
} from './reticulum-wire-size';

const LOCAL_DEVICE = 'a'.repeat(32);
const REMOTE_DEVICE = 'b'.repeat(32);
const RELAY_DEVICE = 'c'.repeat(32);

class BridgeStub extends EventEmitter {
  sent: Array<{ peer: string; wire: Record<string, unknown> }> = [];

  getState(): string {
    return 'ready';
  }

  async sendCallDetailed(
    peer: string,
    wire: Record<string, unknown>
  ): Promise<{ ok: true }> {
    this.sent.push({ peer, wire });
    return { ok: true };
  }
}

function makeManager(bridge: BridgeStub): CallManager {
  const manager = new CallManager({} as never, bridge as never);
  (manager as any).verifyPool = {
    start: vi.fn(),
    stop: vi.fn(),
    verify: vi.fn(async () => true),
  };
  manager.start();
  return manager;
}

function installActiveCall(
  manager: CallManager,
  direction: 'inbound' | 'outbound'
): void {
  (manager as any).activeCalls.set('call-rtc-test', {
    callId: 'call-rtc-test',
    localAddress: direction === 'outbound' ? 'Q-local' : 'Q-remote',
    remoteAddress: direction === 'outbound' ? 'Q-remote' : 'Q-local',
    reticulumPeerPresenceHash:
      direction === 'outbound' ? REMOTE_DEVICE : LOCAL_DEVICE,
    acceptedReticulumPeerHash:
      direction === 'outbound' ? REMOTE_DEVICE : undefined,
    chatId: 'direct:Q-local:Q-remote',
    direction,
    state: 'active',
    startedAt: Date.now(),
  });
}

describe('direct-call WebRTC signaling', () => {
  it('does not send negotiation after the active call changes during signature verification', async () => {
    const bridge = new BridgeStub();
    const manager = makeManager(bridge);
    installActiveCall(manager, 'outbound');
    let finishVerification!: (verified: boolean) => void;
    (manager as any).verifyPool.verify = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishVerification = resolve;
        })
    );
    const payload = JSON.stringify({
      kind: 'ice',
      generation: 'generation-1234',
      candidate: { candidate: 'candidate:test' },
    });
    const pending = manager.sendRtcSignal({
      callId: 'call-rtc-test',
      generation: 'generation-1234',
      signalId: 'signal_race1',
      signalType: 'candidate',
      payload,
      payloadHash: createHash('sha256').update(payload).digest('hex'),
      timestamp: Date.now(),
      signature: 'signed',
      publicKey: 'public-key',
    });

    (manager as any).activeCalls.delete('call-rtc-test');
    finishVerification(true);

    await expect(pending).resolves.toEqual({
      success: false,
      error: 'call-route-changed',
    });
    expect(bridge.sent).toHaveLength(0);
    manager.stop();
  });

  it('fragments negotiation into size-safe wires sent only to the selected device', async () => {
    const bridge = new BridgeStub();
    const manager = makeManager(bridge);
    installActiveCall(manager, 'outbound');
    const payload = JSON.stringify({
      kind: 'description',
      generation: 'generation-1234',
      description: {
        type: 'offer',
        sdp: `v=0\r\n${'a=candidate:test\r\n'.repeat(80)}`,
      },
    });
    const payloadHash = createHash('sha256').update(payload).digest('hex');

    const result = await manager.sendRtcSignal({
      callId: 'call-rtc-test',
      generation: 'generation-1234',
      signalId: 'signal_12345',
      signalType: 'offer',
      payload,
      payloadHash,
      timestamp: Date.now(),
      signature: 'signed',
      publicKey: 'public-key',
    });

    expect(result).toEqual({ success: true });
    expect(bridge.sent.length).toBeGreaterThan(2);
    for (const sent of bridge.sent) {
      expect(sent.peer).toBe(REMOTE_DEVICE);
      expect(sent.wire).not.toHaveProperty('U');
      expect(sent.wire).not.toHaveProperty('X');
      expect(sent.wire).not.toHaveProperty('L');
      expect(
        byteLengthUtf8JsonWithBridgeSenderOnly(sent.wire)
      ).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    }
    manager.stop();
  });

  it('accepts a complete signed signal on the exact direct link but rejects a relay', async () => {
    const senderBridge = new BridgeStub();
    const sender = makeManager(senderBridge);
    installActiveCall(sender, 'outbound');
    const payload = JSON.stringify({
      kind: 'ice',
      generation: 'generation-1234',
      candidate: { candidate: 'candidate:test', sdpMid: '0' },
    });
    await sender.sendRtcSignal({
      callId: 'call-rtc-test',
      generation: 'generation-1234',
      signalId: 'signal_67890',
      signalType: 'candidate',
      payload,
      payloadHash: createHash('sha256').update(payload).digest('hex'),
      timestamp: Date.now(),
      signature: 'signed',
      publicKey: 'public-key',
    });

    const receiverBridge = new BridgeStub();
    const receiver = makeManager(receiverBridge);
    installActiveCall(receiver, 'inbound');
    const received = vi.fn();
    receiver.on('call:rtc-signal', received);

    for (const sent of senderBridge.sent) {
      receiverBridge.emit(
        'call-message',
        sent.wire,
        LOCAL_DEVICE,
        RELAY_DEVICE
      );
    }
    await Promise.resolve();
    expect(received).not.toHaveBeenCalled();

    for (const sent of senderBridge.sent) {
      receiverBridge.emit(
        'call-message',
        sent.wire,
        LOCAL_DEVICE,
        LOCAL_DEVICE
      );
    }
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-rtc-test',
        generation: 'generation-1234',
        signalType: 'candidate',
        payload,
      })
    );

    sender.stop();
    receiver.stop();
  });
});
