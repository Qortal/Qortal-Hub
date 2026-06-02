import { describe, expect, it } from 'vitest';
import {
  decodeReticulumAudioMessage,
  encodeReticulumAudioBatch,
  ReticulumAudioIpcError,
} from './reticulum-audio-ipc';

describe('reticulum-audio-ipc', () => {
  it('round-trips a single outbound-style frame', () => {
    const payload = Buffer.from([0x80, 0x01, 0x02]);
    const wire = encodeReticulumAudioBatch([
      { linkId: 'link-uuid-1', roomId: 'room-a', payload },
    ]);
    const frames = decodeReticulumAudioMessage(wire);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.linkId).toBe('link-uuid-1');
    expect(frames[0]!.roomId).toBe('room-a');
    expect(frames[0]!.peerPresenceHash).toBe('');
    expect(frames[0]!.peerDestinationHash).toBe('');
    expect(Buffer.compare(frames[0]!.payload, payload)).toBe(0);
  });

  it('round-trips inbound-style frame with peer hashes', () => {
    const payload = Buffer.from('opus', 'utf8');
    const wire = encodeReticulumAudioBatch([
      {
        linkId: 'L1',
        roomId: 'r1',
        peerPresenceHash: 'a'.repeat(64),
        peerDestinationHash: 'b'.repeat(32),
        receivedAtWallMs: 1_234_567,
        payload,
      },
    ]);
    const frames = decodeReticulumAudioMessage(wire);
    expect(frames[0]!.peerPresenceHash).toHaveLength(64);
    expect(frames[0]!.peerDestinationHash).toHaveLength(32);
    expect(frames[0]!.receivedAtWallMs).toBe(1_234_567);
  });

  it('round-trips multiple frames in one batch', () => {
    const wire = encodeReticulumAudioBatch([
      { linkId: 'a', roomId: 'r', payload: Buffer.from([1]) },
      { linkId: 'b', roomId: 'r2', payload: Buffer.from([2, 3]) },
    ]);
    const frames = decodeReticulumAudioMessage(wire);
    expect(frames).toHaveLength(2);
    expect(Buffer.from(frames[1]!.payload)).toEqual(Buffer.from([2, 3]));
  });

  it('rejects bad magic', () => {
    const buf = Buffer.alloc(20);
    buf.write('XXXX', 0, 4, 'ascii');
    expect(() => decodeReticulumAudioMessage(buf)).toThrow(ReticulumAudioIpcError);
  });
});
