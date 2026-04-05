import { describe, expect, it } from 'vitest';
import {
  GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN,
  GCALL_RECOVERY_JITTER_START_MIN,
  getEffectiveJitterTuning,
  getGroupCallAudioTuning,
} from './groupCallAudioProfile';

describe('getEffectiveJitterTuning', () => {
  it('is identity for low-latency mode', () => {
    const t = getGroupCallAudioTuning('low-latency');
    expect(getEffectiveJitterTuning(t, 'low-latency')).toEqual({
      jitterBufferSize: t.jitterBufferSize,
      jitterStartBufferSize: t.jitterStartBufferSize,
    });
  });

  it('raises floors in recovery mode', () => {
    const t = getGroupCallAudioTuning('low-latency');
    const e = getEffectiveJitterTuning(t, 'recovery');
    expect(e.jitterBufferSize).toBe(GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN);
    expect(e.jitterStartBufferSize).toBe(GCALL_RECOVERY_JITTER_START_MIN);
  });

  it('bumps high-stability profile up to recovery floors', () => {
    const t = getGroupCallAudioTuning('high-stability');
    const e = getEffectiveJitterTuning(t, 'recovery');
    expect(e.jitterBufferSize).toBe(GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN);
    expect(e.jitterStartBufferSize).toBe(GCALL_RECOVERY_JITTER_START_MIN);
  });
});
