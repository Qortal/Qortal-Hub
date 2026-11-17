import { afterEach, describe, expect, it } from 'vitest';
import {
  GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN,
  GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_SINGLE_REMOTE,
  GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_TIER2,
  GCALL_RECOVERY_JITTER_START_MIN,
  GCALL_RECOVERY_JITTER_START_MIN_SINGLE_REMOTE,
  GCALL_RECOVERY_JITTER_START_MIN_TIER2,
  applyGcallJitterBurstHeadroom,
  createGcallJitterBurstHeadroomState,
  getEffectiveJitterTuning,
  getGroupCallAudioTuning,
  stepGcallJitterBurstHeadroom,
} from './groupCallAudioProfile';

describe('getEffectiveJitterTuning', () => {
  it('is identity for low-latency mode', () => {
    const t = getGroupCallAudioTuning('low-latency');
    expect(getEffectiveJitterTuning(t, 'low-latency')).toEqual({
      jitterBufferSize: t.jitterBufferSize,
      jitterStartBufferSize: t.jitterStartBufferSize,
    });
  });

  it('uses deeper steady jitter geometry for high-stability mode', () => {
    const t = getGroupCallAudioTuning('high-stability');
    expect(t.jitterBufferSize).toBe(8);
    expect(t.jitterStartBufferSize).toBe(7);
    expect(getEffectiveJitterTuning(t, 'low-latency')).toEqual({
      jitterBufferSize: 8,
      jitterStartBufferSize: 7,
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

  it('uses single-remote intermediate floors when recovery and N===1', () => {
    const t = getGroupCallAudioTuning('low-latency');
    const e = getEffectiveJitterTuning(t, 'recovery', { activeSourceCount: 1 });
    expect(e.jitterBufferSize).toBe(GCALL_RECOVERY_JITTER_BUFFER_SIZE_MIN_SINGLE_REMOTE);
    expect(e.jitterStartBufferSize).toBe(GCALL_RECOVERY_JITTER_START_MIN_SINGLE_REMOTE);
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

describe('gcall jitter burst headroom', () => {
  it('expands effective jitter capacity in bounded levels', () => {
    expect(
      applyGcallJitterBurstHeadroom(
        { jitterBufferSize: 8, jitterStartBufferSize: 7 },
        0
      )
    ).toEqual({ jitterBufferSize: 8, jitterStartBufferSize: 7 });
    expect(
      applyGcallJitterBurstHeadroom(
        { jitterBufferSize: 8, jitterStartBufferSize: 7 },
        1
      )
    ).toEqual({ jitterBufferSize: 12, jitterStartBufferSize: 9 });
    expect(
      applyGcallJitterBurstHeadroom(
        { jitterBufferSize: 8, jitterStartBufferSize: 7 },
        2
      )
    ).toEqual({ jitterBufferSize: 16, jitterStartBufferSize: 11 });
    expect(
      applyGcallJitterBurstHeadroom(
        { jitterBufferSize: 12, jitterStartBufferSize: 11 },
        2
      )
    ).toEqual({ jitterBufferSize: 20, jitterStartBufferSize: 15 });
    expect(
      applyGcallJitterBurstHeadroom(
        { jitterBufferSize: 12, jitterStartBufferSize: 10 },
        3
      )
    ).toEqual({ jitterBufferSize: 40, jitterStartBufferSize: 18 });
  });

  it('can expand burst capacity without raising the ready threshold', () => {
    expect(
      applyGcallJitterBurstHeadroom(
        { jitterBufferSize: 12, jitterStartBufferSize: 11 },
        2,
        { boostStartThreshold: false }
      )
    ).toEqual({ jitterBufferSize: 20, jitterStartBufferSize: 11 });
  });

  it('arms burst headroom on direct trim pressure', () => {
    const state = createGcallJitterBurstHeadroomState();
    const armed = stepGcallJitterBurstHeadroom({
      state,
      enabled: true,
      nowMs: 2_000,
      trimCount: 8,
      depthHighWater: 16,
      maxDepthFrames: 16,
      playoutUnderTargetFraction: 0.05,
      avgPlayoutRate: 1,
    });
    expect(armed.reason).toBe('trim-pressure');
    expect(armed.state.level).toBe(1);
    expect(armed.state.holdUntilMs).toBeGreaterThan(2_000);
  });

  it('keeps near-cap-only pressure gated by playout stress', () => {
    const state = createGcallJitterBurstHeadroomState();
    expect(
      stepGcallJitterBurstHeadroom({
        state,
        enabled: true,
        nowMs: 1_000,
        trimCount: 0,
        depthHighWater: 16,
        maxDepthFrames: 16,
        playoutUnderTargetFraction: 0.05,
        avgPlayoutRate: 1,
      }).state.level
    ).toBe(0);

    const firstStressedNearCap = stepGcallJitterBurstHeadroom({
      state,
      enabled: true,
      nowMs: 2_000,
      trimCount: 0,
      depthHighWater: 16,
      maxDepthFrames: 16,
      playoutUnderTargetFraction: 0.35,
      avgPlayoutRate: 0.99,
    });
    expect(firstStressedNearCap.state.level).toBe(0);

    const secondStressedNearCap = stepGcallJitterBurstHeadroom({
      state: firstStressedNearCap.state,
      enabled: true,
      nowMs: 2_020,
      trimCount: 0,
      depthHighWater: 16,
      maxDepthFrames: 16,
      playoutUnderTargetFraction: 0.35,
      avgPlayoutRate: 0.99,
    });
    expect(secondStressedNearCap.reason).toBe('near-cap-pressure');
    expect(secondStressedNearCap.state.level).toBe(1);
  });

  it('escalates strong trim pressure to level 2', () => {
    const armed = stepGcallJitterBurstHeadroom({
      state: createGcallJitterBurstHeadroomState(),
      enabled: true,
      nowMs: 1_000,
      trimCount: 12,
      depthHighWater: 16,
      maxDepthFrames: 16,
      playoutUnderTargetFraction: 0.1,
      avgPlayoutRate: 0.97,
    });
    expect(armed.reason).toBe('trim-pressure');
    expect(armed.state.level).toBe(2);
  });

  it('escalates very large trim bursts to emergency level 3', () => {
    const armed = stepGcallJitterBurstHeadroom({
      state: createGcallJitterBurstHeadroomState(),
      enabled: true,
      nowMs: 1_000,
      trimCount: 120,
      depthHighWater: 40,
      maxDepthFrames: 40,
      playoutUnderTargetFraction: 0.05,
      avgPlayoutRate: 1,
    });
    expect(armed.reason).toBe('trim-pressure');
    expect(armed.state.level).toBe(3);
  });

  it('decays one level after the hold window and a calm period', () => {
    const initial = {
      level: 2 as const,
      holdUntilMs: 5_000,
      calmSinceMs: 5_000,
      nearCapPressureCount: 0,
    };
    const decayed = stepGcallJitterBurstHeadroom({
      state: initial,
      enabled: true,
      nowMs: 16_000,
      trimCount: 0,
      depthHighWater: 6,
      maxDepthFrames: 24,
      playoutUnderTargetFraction: 0.05,
      avgPlayoutRate: 0.995,
    });
    expect(decayed.reason).toBe('calm-decay');
    expect(decayed.state.level).toBe(1);
  });
});
