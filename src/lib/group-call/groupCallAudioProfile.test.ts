import { afterEach, describe, expect, it } from 'vitest';
import {
  GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN,
  GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_TIER2,
  GCALL_RECOVERY_JITTER_START_MIN,
  GCALL_RECOVERY_JITTER_START_MIN_TIER2,
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

describe('getEffectiveJitterTuning tier-2 (Phase D)', () => {
  afterEach(() => {
    try {
      localStorage.removeItem('gcallJitterTier2');
    } catch {
      /* ignore */
    }
  });

  it('tier-2 floors by default when recovery and N>=2', () => {
    const t = getGroupCallAudioTuning('low-latency');
    const e = getEffectiveJitterTuning(t, 'recovery', {
      tier2MultiSource: true,
      activeSourceCount: 2,
    });
    expect(e.jitterBufferSize).toBe(GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_TIER2);
    expect(e.jitterStartBufferSize).toBe(GCALL_RECOVERY_JITTER_START_MIN_TIER2);
  });

  it('stays phase-C when tier-2 explicitly opted out', () => {
    localStorage.setItem('gcallJitterTier2', '0');
    const t = getGroupCallAudioTuning('low-latency');
    const e = getEffectiveJitterTuning(t, 'recovery', {
      tier2MultiSource: true,
      activeSourceCount: 2,
    });
    expect(e.jitterBufferSize).toBe(GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN);
    expect(e.jitterStartBufferSize).toBe(GCALL_RECOVERY_JITTER_START_MIN);
  });
});
