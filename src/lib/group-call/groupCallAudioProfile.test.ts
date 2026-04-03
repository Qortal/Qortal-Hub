import { describe, expect, it } from 'vitest';
import {
  getGroupCallAudioTuning,
  type GroupCallAudioQualityProfile,
} from './groupCallAudioProfile';

describe('getGroupCallAudioTuning', () => {
  it.each<[GroupCallAudioQualityProfile, number, number]>([
    ['low-latency', 24_000, 4],
    ['high-stability', 32_000, 6],
  ])(
    '%s profile maps bitrate %i and jitter start %i',
    (profile, bitrate, start) => {
      const t = getGroupCallAudioTuning(profile);
      expect(t.profile).toBe(profile);
      expect(t.opusBitrate).toBe(bitrate);
      expect(t.jitterStartBufferSize).toBe(start);
      expect(t.adaptiveMaxTargetMs).toBe(profile === 'high-stability' ? 220 : 180);
      expect(t.wasmFecMaxGapReset).toBe(profile === 'high-stability' ? 40 : 32);
    }
  );
});
