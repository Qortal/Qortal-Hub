import { describe, expect, it } from 'vitest';
import {
  RT_GCALL_MAX_WIRE_JSON_BYTES,
  decodeClusterHeartbeatWire,
  decodeJoinIdentityWire,
  decodeJoinWire,
  decodeJoinWireFailureReason,
  decodeKeyRequestFromGq1,
  decodeKeyWireFromGk1,
  decodeTopologyFromGt1,
  decodeTopologyWireSingle,
  encodeClusterHeartbeatWire,
  encodeJoinIdentityWire,
  encodeJoinWire,
  encodeKeyRequestWire,
  encodeKeyWire,
  encodeTopologyWire,
  parseGk0,
  parseGk1,
  parseGq0,
  parseGq1,
  parseGt0,
  parseGt1,
} from './group-call-wire-reticulum';
import {
  byteLengthUtf8JsonWithBridgeSender,
  wireFitsReticulum,
} from './reticulum-wire-size';

function bridgeWireJsonBytes(frame: Record<string, unknown>): number {
  return byteLengthUtf8JsonWithBridgeSender(frame);
}

describe('group-call-wire-reticulum', () => {
  it('encodes GC_CLUSTER_HEARTBEAT within Reticulum MDU (compact GH)', () => {
    const addr =
      'QWmV5a3nQKqEYvR8sT2uX4wZ6bC1dF3gH7jK9mP0qS5tU8vW2xY4zA6bC8dE0fG2h';
    const pk =
      '2mK9pL4nR7qS1tU5vW8xY3zA6bC0dE4fG7hJ1kM5nP9qR3sT6uV0wX4yZ8aB2cD6eF9g';
    const sig =
      '5hJ8kM2nP6qR1sT4uV7wX0yZ3aB6cD9eF2gH5jK8mN1pQ4rS7tU0vW3xY6zA9bC2dE5fG8h';
    const w = encodeClusterHeartbeatWire({
      roomId: 'gcall-qortal-812',
      topologyEpoch: 42,
      clusterForwarder: addr,
      clusterIndex: 0,
      seq: 9001,
      fromAddress: addr,
      fromPublicKey: pk,
      signature: sig,
      timestamp: 1_775_201_000_000,
    });
    expect(w).not.toHaveProperty('k');
    expect(w).not.toHaveProperty('f');
    expect(wireFitsReticulum(w)).toBe(true);
    const back = decodeClusterHeartbeatWire(w);
    expect(back).not.toBeNull();
    expect(back!.clusterForwarder).toBe(addr);
    expect(back!.fromAddress).toBe(addr);
    expect(back!.fromPublicKey).toBe('');
    expect(back!.signature).toBe(sig);
  });

  it('decodes legacy GH wire with f and k', () => {
    const addr = 'Qa';
    const legacy = {
      t: 'GH',
      R: 'gcall-qortal-1',
      e: 1,
      f: addr,
      i: 0,
      s: 1,
      a: addr,
      k: 'pk',
      m: 100,
      g: 'sig',
    };
    const back = decodeClusterHeartbeatWire(legacy);
    expect(back).toEqual({
      type: 'GC_CLUSTER_HEARTBEAT',
      roomId: 'gcall-qortal-1',
      topologyEpoch: 1,
      clusterForwarder: addr,
      clusterIndex: 0,
      seq: 1,
      fromAddress: addr,
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 100,
    });
  });

  it('round-trips compact join wire', () => {
    const d32 = 'a'.repeat(32);
    const env = {
      type: 'GC_JOIN' as const,
      roomId: 'gcall-qortal-1',
      chatId: 'c1',
      fromAddress: 'Qa',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 12_345,
      reticulumDestinationHash: d32,
      joinGeneration: 7,
    };
    const w = encodeJoinWire(env);
    expect(w.t).toBe('GJ');
    expect(w.d).toBe(d32);
    const back = decodeJoinWire(w as Record<string, unknown>);
    expect(back).toEqual({
      type: 'GC_JOIN',
      roomId: 'gcall-qortal-1',
      chatId: 'c1',
      fromAddress: 'Qa',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 12_345,
      reticulumDestinationHash: d32,
      joinGeneration: 7,
    });
    expect(decodeJoinWireFailureReason(w as Record<string, unknown>)).toBeNull();
  });

  it('decodeJoinWireFailureReason explains bad d', () => {
    const w = {
      t: 'GJ',
      R: 'r1',
      H: 'h1',
      a: 'Qa',
      k: 'pk',
      m: 1,
      g: 'sig',
      d: 'deadbeef',
    };
    expect(decodeJoinWire(w as Record<string, unknown>)).toBeNull();
    expect(decodeJoinWireFailureReason(w as Record<string, unknown>)).toBe(
      'bad_d_not_hex32(len=8)'
    );
  });

  it('decodeJoinWire returns null without d', () => {
    expect(
      decodeJoinWire({
        t: 'GJ',
        R: 'gcall-qortal-1',
        H: 'c1',
        a: 'Qa',
        k: 'pk',
        m: 1,
        g: 'sig',
      } as Record<string, unknown>)
    ).toBeNull();
  });

  it('GC_JOIN with required d fits Reticulum MDU (compact field sizes)', () => {
    const d32 = 'a'.repeat(32);
    const w = encodeJoinWire({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      fromAddress: 'Qa',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 12_345,
      reticulumDestinationHash: d32,
      joinGeneration: 7,
    });
    expect(wireFitsReticulum(w)).toBe(true);
  });

  it('GC_JOIN+GI split: GJ without rk and GI with unpadded rk both fit Reticulum MDU', () => {
    const d32 = 'a'.repeat(32);
    const rk = Buffer.alloc(64, 7).toString('base64');
    const gj = encodeJoinWire({
      roomId: 'gcall-qortal-812',
      chatId: 'group:812',
      fromAddress: 'Qa',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 12_345,
      reticulumDestinationHash: d32,
      joinGeneration: 7,
    });
    expect(gj.rk).toBeUndefined();
    expect(wireFitsReticulum(gj)).toBe(true);
    const gi = encodeJoinIdentityWire({
      fromAddress: 'Qa',
      signature: 'sig_rk',
      timestamp: 12_345,
      reticulumDestinationHash: d32,
      joinGeneration: 7,
      reticulumIdentityPublicKeyBase64: rk,
    });
    expect(gi.t).toBe('GI');
    expect(wireFitsReticulum(gi)).toBe(true);
    const backGi = decodeJoinIdentityWire(gi as Record<string, unknown>);
    expect(backGi?.reticulumIdentityPublicKeyBase64).toBe(rk.replace(/=+$/u, ''));
  });

  it('round-trips single-packet topology', () => {
    const env = {
      type: 'GC_TOPOLOGY' as const,
      roomId: 'r1',
      topologyEpoch: 3,
      rootForwarder: 'Qroot',
      standbyForwarder: 'Qs',
      clusters: [
        {
          members: ['Qroot', 'Qs'],
          forwarder: 'Qroot',
          standby: 'Qs',
          standby2: '',
        },
      ],
      lastSeen: 99,
      fromAddress: 'Qroot',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 100,
    };
    const frames = encodeTopologyWire(env);
    expect(frames.length).toBe(1);
    expect(frames[0]!.t).toBe('GT');
    const back = decodeTopologyWireSingle(frames[0] as Record<string, unknown>);
    expect(back?.topologyEpoch).toBe(3);
    expect(back?.clusters).toHaveLength(1);
  });

  it('reassembles fragmented topology (GT0/GT1)', () => {
    const env = {
      type: 'GC_TOPOLOGY' as const,
      roomId: 'rfrag',
      topologyEpoch: 1,
      rootForwarder: 'a',
      standbyForwarder: 'b',
      clusters: [
        {
          members: ['a', 'b', 'c'],
          forwarder: 'a',
          standby: 'b',
          standby2: 'c',
        },
      ],
      lastSeen: 1,
      fromAddress: 'a',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 2,
    };
    const frames = encodeTopologyWire(env);
    if (frames.length === 1) {
      expect((frames[0] as { t?: string }).t).toBe('GT');
      return;
    }
    expect(frames[0]!.t).toBe('GT0');
    const meta = parseGt0(frames[0] as Record<string, unknown>);
    expect(meta).not.toBeNull();
    const parts = new Map<number, string>();
    for (let i = 1; i < frames.length; i++) {
      const p = parseGt1(frames[i] as Record<string, unknown>);
      expect(p).not.toBeNull();
      parts.set(p!.x, p!.p);
    }
    const back = decodeTopologyFromGt1(meta!, parts);
    expect(back?.roomId).toBe('rfrag');
    expect(back?.clusters[0]?.members).toEqual(['a', 'b', 'c']);
  });

  it('fragments medium topologies before they approach transport MTU', () => {
    const env = {
      type: 'GC_TOPOLOGY' as const,
      roomId: 'r-medium',
      topologyEpoch: 2,
      rootForwarder: 'Qroot',
      standbyForwarder: 'Qstandby',
      clusters: [
        {
          members: [
            'Q111111111111111111111111111111111',
            'Q222222222222222222222222222222222',
            'Q333333333333333333333333333333333',
            'Q444444444444444444444444444444444',
            'Q555555555555555555555555555555555',
          ],
          forwarder: 'Q111111111111111111111111111111111',
          standby: 'Q222222222222222222222222222222222',
          standby2: 'Q333333333333333333333333333333333',
        },
      ],
      lastSeen: 123,
      fromAddress: 'Qroot',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 456,
    };
    const predictedSingle = {
      t: 'GT',
      R: env.roomId,
      e: env.topologyEpoch,
      o: env.rootForwarder,
      u: env.standbyForwarder,
      l: env.lastSeen,
      a: env.fromAddress,
      k: env.fromPublicKey,
      m: env.timestamp,
      g: env.signature,
      c: env.clusters,
    };

    expect(
      bridgeWireJsonBytes(predictedSingle)
    ).toBeGreaterThan(RT_GCALL_MAX_WIRE_JSON_BYTES);

    const frames = encodeTopologyWire(env);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.t).toBe('GT0');
    for (const frame of frames) {
      expect(bridgeWireJsonBytes(frame)).toBeLessThanOrEqual(
        RT_GCALL_MAX_WIRE_JSON_BYTES
      );
    }
  });

  it('keeps fragmented topology metadata under wire limit with realistic sender fields', () => {
    const env = {
      type: 'GC_TOPOLOGY' as const,
      roomId: 'gcall-qortal-812',
      topologyEpoch: 2,
      rootForwarder: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
      standbyForwarder: 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
      clusters: [
        {
          members: [
            'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
            'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
            'Q111111111111111111111111111111111',
            'Q222222222222222222222222222222222',
            'Q333333333333333333333333333333333',
          ],
          forwarder: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
          standby: 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
          standby2: 'Q111111111111111111111111111111111',
        },
      ],
      lastSeen: 1_734_567_890_123,
      fromAddress: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
      fromPublicKey: 'A'.repeat(56),
      signature: 'b'.repeat(128),
      timestamp: 1_734_567_890_234,
    };

    const frames = encodeTopologyWire(env);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.t).toBe('GT0');
    for (const frame of frames) {
      expect(bridgeWireJsonBytes(frame)).toBeLessThanOrEqual(
        RT_GCALL_MAX_WIRE_JSON_BYTES
      );
    }

    const meta = parseGt0(frames[0] as Record<string, unknown>);
    expect(meta).not.toBeNull();
    const parts = new Map<number, string>();
    for (let i = 1; i < frames.length; i++) {
      const p = parseGt1(frames[i] as Record<string, unknown>);
      expect(p).not.toBeNull();
      parts.set(p!.x, p!.p);
    }
    const back = decodeTopologyFromGt1(meta!, parts);
    expect(back).toMatchObject({
      roomId: env.roomId,
      topologyEpoch: env.topologyEpoch,
      rootForwarder: env.rootForwarder,
      standbyForwarder: env.standbyForwarder,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      signature: env.signature,
      timestamp: env.timestamp,
    });
    expect(back?.clusters).toEqual(env.clusters);
  });

  it('fragments realistic encrypted keys under wire limit', () => {
    const frames = encodeKeyWire({
      roomId: 'gcall-qortal-812',
      toAddress: 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
      fromAddress: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
      fromPublicKey: 'A'.repeat(56),
      encryptedKey: 'Z'.repeat(520),
      keyMessageVersion: 3,
      callSessionId: 'session-123',
      mediaSessionGeneration: 2,
      keyCommitment: 'c'.repeat(64),
      encryptedKeyDigest: 'd'.repeat(64),
      signature: 'b'.repeat(128),
      timestamp: 1_734_567_890_234,
    });

    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.t).toBe('GK0');
    for (const frame of frames) {
      expect(bridgeWireJsonBytes(frame)).toBeLessThanOrEqual(
        RT_GCALL_MAX_WIRE_JSON_BYTES
      );
    }

    const meta = parseGk0(frames[0] as Record<string, unknown>);
    expect(meta).not.toBeNull();
    const parts = new Map<number, string>();
    for (let i = 1; i < frames.length; i++) {
      const p = parseGk1(frames[i] as Record<string, unknown>);
      expect(p).not.toBeNull();
      parts.set(p!.x, p!.p);
    }
    const back = decodeKeyWireFromGk1(meta!, parts);
    expect(back).toMatchObject({
      roomId: 'gcall-qortal-812',
      toAddress: 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
      fromAddress: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
      encryptedKey: 'Z'.repeat(520),
      keyMessageVersion: 3,
      callSessionId: 'session-123',
      mediaSessionGeneration: 2,
    });
  });

  it('fragments large GC_KEY_REQUEST (GQ0/GQ1) under wire limit', () => {
    const frames = encodeKeyRequestWire({
      roomId: 'gcall-qortal-812',
      toAddress: 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
      fromAddress: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
      fromPublicKey: 'A'.repeat(56),
      callSessionId: 'session-123',
      mediaSessionGeneration: 2,
      keyMessageVersion: 3,
      signature: 'b'.repeat(128),
      timestamp: 1_734_567_890_234,
    });

    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]!.t).toBe('GQ0');
    for (const frame of frames) {
      expect(bridgeWireJsonBytes(frame)).toBeLessThanOrEqual(
        RT_GCALL_MAX_WIRE_JSON_BYTES
      );
    }

    const meta = parseGq0(frames[0] as Record<string, unknown>);
    expect(meta).not.toBeNull();
    const parts = new Map<number, string>();
    for (let i = 1; i < frames.length; i++) {
      const p = parseGq1(frames[i] as Record<string, unknown>);
      expect(p).not.toBeNull();
      parts.set(p!.x, p!.p);
    }
    const back = decodeKeyRequestFromGq1(meta!, parts);
    expect(back).toMatchObject({
      roomId: 'gcall-qortal-812',
      toAddress: 'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
      fromAddress: 'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
      fromPublicKey: 'A'.repeat(56),
      callSessionId: 'session-123',
      mediaSessionGeneration: 2,
      keyMessageVersion: 3,
      signature: 'b'.repeat(128),
      timestamp: 1_734_567_890_234,
    });
  });

});
