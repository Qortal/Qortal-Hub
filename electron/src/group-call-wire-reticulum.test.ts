import { describe, expect, it } from 'vitest';
import {
  RT_GCALL_MAX_WIRE_JSON_BYTES,
  decodeJoinWire,
  decodeKeyRequestFromGq1,
  decodeKeyWireFromGk1,
  decodeKeyRotateFromGr1,
  decodeKeyRotateWireSingle,
  decodeTopologyFromGt1,
  decodeTopologyWireSingle,
  encodeJoinWire,
  encodeKeyRequestWire,
  encodeKeyWire,
  encodeKeyRotateWire,
  encodeTopologyWire,
  parseGr0,
  parseGr1,
  parseGk0,
  parseGk1,
  parseGq0,
  parseGq1,
  parseGt0,
  parseGt1,
} from './group-call-wire-reticulum';

function bridgeWireJsonBytes(frame: Record<string, unknown>): number {
  return Buffer.byteLength(
    JSON.stringify({
      ...frame,
      r: '0'.repeat(64),
    }),
    'utf8'
  );
}

describe('group-call-wire-reticulum', () => {
  it('round-trips compact join wire', () => {
    const env = {
      type: 'GC_JOIN' as const,
      roomId: 'gcall-qortal-1',
      chatId: 'c1',
      fromAddress: 'Qa',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 12_345,
      joinGeneration: 7,
    };
    const w = encodeJoinWire(env);
    expect(w.t).toBe('GJ');
    const back = decodeJoinWire(w as Record<string, unknown>);
    expect(back).toEqual({
      type: 'GC_JOIN',
      roomId: 'gcall-qortal-1',
      chatId: 'c1',
      fromAddress: 'Qa',
      fromPublicKey: 'pk',
      signature: 'sig',
      timestamp: 12_345,
      joinGeneration: 7,
    });
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

  it('round-trips or fragments key rotate', () => {
    const keys: Record<string, string> = { Qa: 'ek-a', Qb: 'ek-b' };
    const env = {
      type: 'GC_KEY_ROTATE' as const,
      roomId: 'kr',
      fromAddress: 'Qroot',
      fromPublicKey: 'pk',
      encryptedKeys: keys,
      keyMessageVersion: 3,
      callSessionId: 'sid',
      mediaSessionGeneration: 2,
      keyCommitment: 'kc',
      encryptedKeysDigest: 'deadbeef',
      signature: 'sig',
      timestamp: 5,
    };
    const frames = encodeKeyRotateWire(env);
    if (frames.length === 1) {
      const back = decodeKeyRotateWireSingle(
        frames[0] as Record<string, unknown>
      );
      expect(back?.encryptedKeys).toEqual(keys);
      return;
    }
    const meta = parseGr0(frames[0] as Record<string, unknown>);
    expect(meta).not.toBeNull();
    const parts = new Map<number, string>();
    for (let i = 1; i < frames.length; i++) {
      const p = parseGr1(frames[i] as Record<string, unknown>);
      expect(p).not.toBeNull();
      parts.set(p!.x, p!.p);
    }
    const back = decodeKeyRotateFromGr1(meta!, parts);
    expect(back?.encryptedKeys).toEqual(keys);
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

  it('encodeKeyRotateWire returns empty array when GR0 meta cannot fit wire limit', () => {
    const longRoom = `gcall-${'x'.repeat(500)}`;
    const keys: Record<string, string> = { Qa: 'ek' };
    const env = {
      type: 'GC_KEY_ROTATE' as const,
      roomId: longRoom,
      fromAddress: 'Qroot',
      fromPublicKey: 'pk',
      encryptedKeys: keys,
      keyMessageVersion: 3,
      callSessionId: 'sid',
      mediaSessionGeneration: 2,
      keyCommitment: 'kc',
      encryptedKeysDigest: 'deadbeef',
      signature: 'sig',
      timestamp: 5,
    };
    const frames = encodeKeyRotateWire(env);
    expect(frames).toEqual([]);
  });
});
