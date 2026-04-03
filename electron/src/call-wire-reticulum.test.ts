import { describe, expect, it } from 'vitest';
import {
  RT_CALL_MAX_JSON_BYTES,
  buildCkAck,
  buildCkResend,
  buildSdpWireFrames,
  decodeReticulumCallWire,
  deriveDirectVoiceCallChatId,
  encodeReticulumCallWire,
} from './call-wire-reticulum';
import nacl from 'tweetnacl';
import type { CallRequestEnvelope } from './call';
import { deriveAddressFromPublicKey, encodeBytesBase58 } from './presence';
import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSenderAndTarget,
  wireFitsReticulum,
} from './reticulum-wire-size';

function withBridgeR(obj: Record<string, unknown>): number {
  return byteLengthUtf8JsonWithBridgeSenderAndTarget(obj, 'QtargetAddress1234567890123456789012');
}

describe('call-wire-reticulum SDP sizing', () => {
  it('aligns RT_CALL_MAX_JSON_BYTES with shared Reticulum cap', () => {
    expect(RT_CALL_MAX_JSON_BYTES).toBe(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
  });

  it('buildSdpWireFrames keeps every CS0/CS1 under cap with bridge sender', () => {
    const sdp = 'v=0\r\n' + 'a=x'.repeat(300) + '\r\n';
    const built = buildSdpWireFrames(
      'call-id-uuid-1234',
      'o',
      sdp,
      'a'.repeat(64),
      'k'.repeat(16),
      1_700_000_000,
      'g'.repeat(24),
      'Qabc12345678901234567890123456789'
    );
    expect(built).not.toBeNull();
    expect(withBridgeR(built!.cs0)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
    for (const cs1 of built!.cs1List) {
      expect(withBridgeR(cs1 as Record<string, unknown>)).toBeLessThanOrEqual(
        RT_RETICULUM_MAX_WIRE_JSON_BYTES
      );
    }
  });

  it('CK ack/resend frames fit under wire cap', () => {
    const ack = buildCkAck('cid', 'o', 'b'.repeat(64));
    expect(withBridgeR(ack)).toBeLessThanOrEqual(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
    const resend = buildCkResend('cid', 'o', 'c'.repeat(64), [0, 1, 2, 3]);
    expect(withBridgeR(resend)).toBeLessThanOrEqual(
      RT_RETICULUM_MAX_WIRE_JSON_BYTES
    );
  });
});

function attachReticulumOverlayMeta(
  wire: Record<string, unknown>,
  targetAddress: string,
  hopsRemaining: number,
  overlayId: string
): Record<string, unknown> {
  return {
    ...wire,
    U: targetAddress,
    L: Math.max(0, Math.trunc(hopsRemaining)),
    X: overlayId,
  };
}

describe('call-wire-reticulum CALL_REQUEST (CR) direct compact', () => {
  const kp = nacl.sign.keyPair();
  const fromPublicKey = encodeBytesBase58(kp.publicKey);
  const caller = deriveAddressFromPublicKey(fromPublicKey);
  const callee = 'Qbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const directChatId = deriveDirectVoiceCallChatId(caller, callee);

  const baseRequest: CallRequestEnvelope = {
    type: 'CALL_REQUEST',
    callId: '550e8400-e29b-41d4-a716-446655440000',
    fromAddress: caller,
    fromPublicKey,
    chatId: directChatId,
    timestamp: 1_700_000_000_000,
    signature: encodeBytesBase58(nacl.sign.detached(new Uint8Array(32).fill(7), kp.secretKey)),
  };

  it('omits a and h for direct chat and fits under Reticulum MDU with overlay', () => {
    const wire = encodeReticulumCallWire(baseRequest);
    expect(wire).not.toBeNull();
    expect(wire).not.toHaveProperty('h');
    expect(wire).not.toHaveProperty('a');

    const overlay = attachReticulumOverlayMeta(
      wire as Record<string, unknown>,
      callee,
      4,
      'overlay000000'
    );
    expect(wireFitsReticulum(overlay)).toBe(true);
  });

  it('decodes direct CR from k + U into the canonical chatId', () => {
    const wire = encodeReticulumCallWire(baseRequest) as Record<string, unknown>;
    const overlay = attachReticulumOverlayMeta(wire, callee, 4, 'overlay000000');

    const decoded = decodeReticulumCallWire(overlay);
    expect(decoded.kind).toBe('envelope');
    if (decoded.kind !== 'envelope') return;
    expect(decoded.envelope.type).toBe('CALL_REQUEST');
    const env = decoded.envelope as CallRequestEnvelope;
    expect(env.chatId).toBe(directChatId);
    expect(env.fromAddress).toBe(caller);
    expect(env.callId).toBe(baseRequest.callId);
  });

  it('rejects CR with legacy top-level a field', () => {
    const wire = encodeReticulumCallWire(baseRequest) as Record<string, unknown>;
    const decoded = decodeReticulumCallWire({
      ...wire,
      a: caller,
      U: callee,
      L: 4,
      X: 'overlay000000',
    });
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects legacy CR that embeds direct: in h', () => {
    const decoded = decodeReticulumCallWire({
      t: 'CR',
      i: baseRequest.callId,
      k: baseRequest.fromPublicKey,
      h: directChatId,
      m: baseRequest.timestamp,
      g: baseRequest.signature,
      U: callee,
      L: 4,
      X: 'overlay000000',
    });
    expect(decoded.kind).toBe('invalid');
  });

  it('keeps full h for non-direct (support) chat ids', () => {
    const supportChatId = 'support:agent:Qccccccccccccccccccccccccccccccc';
    const supportReq: CallRequestEnvelope = {
      ...baseRequest,
      chatId: supportChatId,
    };
    const wire = encodeReticulumCallWire(supportReq) as Record<string, unknown>;
    expect(wire.h).toBe(supportChatId);
    expect(wire).not.toHaveProperty('a');

    const overlay = attachReticulumOverlayMeta(
      wire,
      'Qddddddddddddddddddddddddddddddddd',
      4,
      'overlay000000'
    );
    const decoded = decodeReticulumCallWire(overlay);
    expect(decoded.kind).toBe('envelope');
    if (decoded.kind !== 'envelope') return;
    expect((decoded.envelope as CallRequestEnvelope).chatId).toBe(supportChatId);
  });
});
