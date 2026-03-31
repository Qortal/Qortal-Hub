import { describe, expect, it } from 'vitest';
import {
  RT_CALL_MAX_JSON_BYTES,
  buildCkAck,
  buildCkResend,
  buildSdpWireFrames,
} from './call-wire-reticulum';
import {
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  byteLengthUtf8JsonWithBridgeSender,
} from './reticulum-wire-size';

function withBridgeR(obj: Record<string, unknown>): number {
  return byteLengthUtf8JsonWithBridgeSender(obj);
}

describe('call-wire-reticulum SDP sizing', () => {
  it('aligns RT_CALL_MAX_JSON_BYTES with shared Reticulum cap', () => {
    expect(RT_CALL_MAX_JSON_BYTES).toBe(RT_RETICULUM_MAX_WIRE_JSON_BYTES);
  });

  it('buildSdpWireFrames keeps every CS0/CS1 under cap with bridge sender', () => {
    const sdp = 'v=0\r\n' + 'a=x'.repeat(1200) + '\r\n';
    const built = buildSdpWireFrames(
      'call-id-uuid-1234',
      'o',
      sdp,
      'a'.repeat(64),
      'k'.repeat(56),
      1_700_000_000,
      'g'.repeat(88)
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
