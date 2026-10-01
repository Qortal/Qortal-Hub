import { describe, expect, it } from 'vitest';
import {
  decodeQAppRnsControl,
  encodeQAppRnsControl,
  encodeQAppRnsFrame,
  QAppRnsFrameParser,
  QAppRnsFrameType,
  QAppRnsProtocolError,
} from './qapp-reticulum-framing';
import vectors from '../../protocol-v1-vectors.json';

describe('Q-App Reticulum framing', () => {
  it('matches the frozen DATA, ACK, and CONTROL golden vectors', () => {
    const cases = [
      [vectors.data_frame, QAppRnsFrameType.Data],
      [vectors.ack_frame, QAppRnsFrameType.Ack],
      [vectors.control_frame, QAppRnsFrameType.Control],
    ] as const;
    for (const [vector, type] of cases) {
      const encoded = encodeQAppRnsFrame(
        type,
        BigInt(`0x${vector.message_id_hex}`),
        Buffer.from(vector.payload_hex, 'hex')
      );
      expect(encoded.toString('hex')).toBe(vector.frame_hex);
      const [decoded] = new QAppRnsFrameParser().push(encoded);
      expect(decoded.type).toBe(type);
      expect(decoded.messageId).toBe(BigInt(`0x${vector.message_id_hex}`));
      expect(decoded.payload.toString('hex')).toBe(vector.payload_hex);
    }
    expect(encodeQAppRnsControl('PING').toString('hex')).toBe(
      vectors.control_frame.payload_hex
    );
    expect(decodeQAppRnsControl(encodeQAppRnsControl('PING'))).toEqual({
      type: 'PING',
    });
    expect(
      decodeQAppRnsControl(encodeQAppRnsControl('CLOSE', 'rns-one'))
    ).toEqual({ type: 'CLOSE', connectionId: 'rns-one' });
  });

  it('round-trips the maximum unsigned message ID', () => {
    const frame = encodeQAppRnsFrame(
      QAppRnsFrameType.Data,
      0xffffffffffffffffn,
      Buffer.alloc(0)
    );
    expect(new QAppRnsFrameParser().push(frame)[0].messageId).toBe(
      0xffffffffffffffffn
    );
  });

  it('parses complete, binary, and zero-length frames', () => {
    const parser = new QAppRnsFrameParser();
    const binary = Buffer.from([0, 255, 7]);
    const frames = parser.push(
      Buffer.concat([
        encodeQAppRnsFrame(QAppRnsFrameType.Data, 1n, binary),
        encodeQAppRnsFrame(QAppRnsFrameType.Ack, 1n, Buffer.alloc(0)),
      ])
    );
    expect(frames.map((frame) => frame.type)).toEqual([1, 2]);
    expect(frames[0].payload).toEqual(binary);
    expect(frames[1].payload).toHaveLength(0);
  });

  it('handles every possible split point', () => {
    const encoded = encodeQAppRnsFrame(
      QAppRnsFrameType.Data,
      42n,
      Buffer.from('partial payload')
    );
    for (let split = 1; split < encoded.length; split += 1) {
      const parser = new QAppRnsFrameParser();
      expect(parser.push(encoded.subarray(0, split))).toEqual([]);
      const frames = parser.push(encoded.subarray(split));
      expect(frames).toHaveLength(1);
      expect(frames[0].messageId).toBe(42n);
      expect(frames[0].payload.toString()).toBe('partial payload');
    }
  });

  it('parses several frames from one read', () => {
    const parser = new QAppRnsFrameParser();
    const bytes = Buffer.concat(
      [1n, 2n, 3n].map((id) =>
        encodeQAppRnsFrame(QAppRnsFrameType.Data, id, Buffer.from(`${id}`))
      )
    );
    expect(parser.push(bytes).map((frame) => frame.messageId)).toEqual([
      1n,
      2n,
      3n,
    ]);
  });

  it('rejects malformed and oversized lengths without retaining input', () => {
    const malformed = Buffer.alloc(14);
    malformed[0] = 1;
    malformed[1] = 1;
    malformed.writeUInt32BE(65, 10);
    const parser = new QAppRnsFrameParser(64, 128);
    expect(() => parser.push(malformed)).toThrow(QAppRnsProtocolError);
    expect(parser.bufferedBytes).toBe(0);
  });

  it('rejects unsupported protocol versions and frame types', () => {
    for (const offset of [0, 1]) {
      const malformed = encodeQAppRnsFrame(
        QAppRnsFrameType.Data,
        1n,
        Buffer.alloc(0)
      );
      malformed[offset] = 99;
      expect(() => new QAppRnsFrameParser().push(malformed)).toThrow(
        QAppRnsProtocolError
      );
    }
  });

  it('rejects unsupported CONTROL payloads', () => {
    expect(() =>
      decodeQAppRnsControl(Buffer.from('{"type":"WELCOME"}'))
    ).toThrow(QAppRnsProtocolError);
    expect(() => encodeQAppRnsControl('CLOSE')).toThrow(QAppRnsProtocolError);
    expect(() => decodeQAppRnsControl(Buffer.from('{"type":"CLOSE"}'))).toThrow(
      QAppRnsProtocolError
    );
  });
});
