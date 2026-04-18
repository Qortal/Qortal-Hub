import { describe, expect, it } from 'vitest';
import {
  GCALL_N1_EARLY_RELEASE_ACCUMULATION_MS,
  GCALL_N1_LATE_COLLAPSE_REARM_COOLDOWN_MS,
  GCALL_N1_SEVERE_EARLY_RELEASE_ACCUMULATION_MS,
  computeN1LiveRecoveryBurstCap,
  computeN1PcmRebuildBurstCap,
  computeN1RecoveryEarlyReleaseMinBufferMs,
  computeN1BufferEnforceTier,
  computeN1BufferRatio,
  computeN1MinStartMs,
  isSevereN1RecoveryPrerollRelease,
  shouldForceN1RecoveryPrerollSatisfied,
  shouldBoostN1PcmRebuild,
  shouldKeepN1SevereForcedReleaseRebuild,
  shouldRearmN1LateCollapseRecovery,
  computeN1SteadyMinHoldMs,
  computeN1SteadyReserveMs,
  computeN1SteadyTierBurstCap,
  computeN1TierBurstCap,
  shouldHoldN1SteadyReserve,
  stepN1SteadyBufferEnforceTier,
  stepN1BufferEnforceTier,
  GCALL_N1_RATIO_DEEP,
  GCALL_N1_RATIO_MODERATE,
} from './gcallN1PlayoutGate';

describe('gcallN1PlayoutGate', () => {
  it('computeN1MinStartMs clamps to floor/ceil', () => {
    expect(computeN1MinStartMs(50)).toBe(100);
    expect(computeN1MinStartMs(120)).toBe(120);
    expect(computeN1MinStartMs(145)).toBe(145);
    expect(computeN1MinStartMs(400)).toBe(185);
  });

  it('computeN1SteadyMinHoldMs keeps a small steady-state reserve', () => {
    expect(computeN1SteadyMinHoldMs(0)).toBe(30);
    expect(computeN1SteadyMinHoldMs(120)).toBe(36);
    expect(computeN1SteadyMinHoldMs(145)).toBe(40);
    expect(computeN1SteadyMinHoldMs(400)).toBe(40);
  });

  it('computeN1SteadyReserveMs rounds the reserve up to a reachable Opus frame boundary', () => {
    expect(computeN1SteadyReserveMs(0)).toBe(40);
    expect(computeN1SteadyReserveMs(120)).toBe(40);
    expect(computeN1SteadyReserveMs(145)).toBe(40);
  });

  it('holds the exact two-frame steady reserve for live one-on-one paths', () => {
    expect(
      shouldHoldN1SteadyReserve({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        opusBufferedMs: 40,
        reserveMs: computeN1SteadyReserveMs(145),
      })
    ).toBe(true);
    expect(
      shouldHoldN1SteadyReserve({
        steadySingleRemote: true,
        sourceRecentlyPushed: true,
        hasReadyFrame: true,
        opusBufferedMs: 60,
        reserveMs: computeN1SteadyReserveMs(145),
      })
    ).toBe(false);
    expect(
      shouldHoldN1SteadyReserve({
        steadySingleRemote: true,
        sourceRecentlyPushed: false,
        hasReadyFrame: true,
        opusBufferedMs: 40,
        reserveMs: computeN1SteadyReserveMs(145),
      })
    ).toBe(false);
  });

  it('allows recovery preroll to release early for a live thin source', () => {
    expect(computeN1RecoveryEarlyReleaseMinBufferMs(145)).toBe(44);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 200,
        lastPushAgeMs: 40,
        opusBufferedMs: 44,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(true);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 120,
        lastPushAgeMs: 40,
        opusBufferedMs: 44,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(false);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 200,
        lastPushAgeMs: 180,
        opusBufferedMs: 44,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(false);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 200,
        lastPushAgeMs: 40,
        opusBufferedMs: 30,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(false);
    expect(
      shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs: 500,
        lastPushAgeMs: 40,
        opusBufferedMs: 20,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(true);
    expect(
      isSevereN1RecoveryPrerollRelease({
        blockedForMs: 500,
        lastPushAgeMs: 40,
        opusBufferedMs: 20,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(true);
    expect(
      isSevereN1RecoveryPrerollRelease({
        blockedForMs: 500,
        lastPushAgeMs: 40,
        opusBufferedMs: 44,
        sourceActive: true,
        targetMs: 145,
      })
    ).toBe(false);
    expect(GCALL_N1_EARLY_RELEASE_ACCUMULATION_MS).toBeGreaterThan(
      computeN1RecoveryEarlyReleaseMinBufferMs(145)
    );
    expect(GCALL_N1_SEVERE_EARLY_RELEASE_ACCUMULATION_MS).toBeGreaterThan(
      GCALL_N1_EARLY_RELEASE_ACCUMULATION_MS
    );
  });

  it('computeN1BufferRatio uses max target floor', () => {
    const a = computeN1BufferRatio(45, 145);
    expect(a.denomMs).toBe(145);
    expect(a.ratio).toBeCloseTo(45 / 145, 5);
    const b = computeN1BufferRatio(50, 0);
    expect(b.denomMs).toBe(100);
    expect(b.ratio).toBe(0.5);
  });

  it('computeN1BufferEnforceTier matches bands', () => {
    expect(computeN1BufferEnforceTier(GCALL_N1_RATIO_DEEP - 0.01)).toBe('deep');
    expect(computeN1BufferEnforceTier((GCALL_N1_RATIO_DEEP + GCALL_N1_RATIO_MODERATE) / 2)).toBe(
      'moderate'
    );
    expect(computeN1BufferEnforceTier(0.6)).toBe('normal');
  });

  it('stepN1BufferEnforceTier adds hysteresis around the boundaries', () => {
    expect(stepN1BufferEnforceTier('deep', 0.33)).toBe('deep');
    expect(stepN1BufferEnforceTier('deep', 0.4)).toBe('moderate');
    expect(stepN1BufferEnforceTier('moderate', 0.3)).toBe('moderate');
    expect(stepN1BufferEnforceTier('moderate', 0.27)).toBe('deep');
    expect(stepN1BufferEnforceTier('moderate', 0.5)).toBe('moderate');
    expect(stepN1BufferEnforceTier('moderate', 0.53)).toBe('normal');
    expect(stepN1BufferEnforceTier('normal', 0.47)).toBe('normal');
    expect(stepN1BufferEnforceTier('normal', 0.45)).toBe('moderate');
  });

  it('stepN1SteadyBufferEnforceTier is weaker than recovery hysteresis', () => {
    expect(stepN1SteadyBufferEnforceTier('deep', 0.27)).toBe('deep');
    expect(stepN1SteadyBufferEnforceTier('deep', 0.3)).toBe('moderate');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.23)).toBe('moderate');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.21)).toBe('deep');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.41)).toBe('moderate');
    expect(stepN1SteadyBufferEnforceTier('moderate', 0.43)).toBe('normal');
    expect(stepN1SteadyBufferEnforceTier('normal', 0.36)).toBe('normal');
    expect(stepN1SteadyBufferEnforceTier('normal', 0.35)).toBe('moderate');
  });

  it('computeN1TierBurstCap', () => {
    expect(computeN1TierBurstCap('deep', 11)).toBe(1);
    expect(
      computeN1TierBurstCap('deep', 11, { recoverySingleRemote: true })
    ).toBe(4);
    expect(computeN1TierBurstCap('moderate', 11)).toBe(6);
    expect(computeN1TierBurstCap('normal', 11)).toBe(11);
  });

  it('computeN1SteadyTierBurstCap is gentler than recovery shaping', () => {
    expect(computeN1SteadyTierBurstCap('deep', 11)).toBe(2);
    expect(computeN1SteadyTierBurstCap('moderate', 11)).toBe(5);
    expect(computeN1SteadyTierBurstCap('normal', 11)).toBe(7);
  });

  it('computeN1LiveRecoveryBurstCap protects weak live recovery paths from over-draining', () => {
    expect(
      computeN1LiveRecoveryBurstCap({
        tier: 'deep',
        scaledBurstCap: 11,
        opusBufferedMs: 30,
        minStartMs: 100,
        sourceRecentlyPushed: true,
      })
    ).toBe(2);
    expect(
      computeN1LiveRecoveryBurstCap({
        tier: 'moderate',
        scaledBurstCap: 11,
        opusBufferedMs: 60,
        minStartMs: 100,
        sourceRecentlyPushed: true,
      })
    ).toBe(3);
    expect(
      computeN1LiveRecoveryBurstCap({
        tier: 'moderate',
        scaledBurstCap: 11,
        opusBufferedMs: 120,
        minStartMs: 100,
        sourceRecentlyPushed: true,
      })
    ).toBe(6);
    expect(
      computeN1LiveRecoveryBurstCap({
        tier: 'deep',
        scaledBurstCap: 11,
        opusBufferedMs: 30,
        minStartMs: 100,
        sourceRecentlyPushed: false,
      })
    ).toBe(4);
  });

  it('switches to PCM rebuild mode when single-remote playout stays badly starved', () => {
    expect(
      shouldBoostN1PcmRebuild({
        sourceRecentlyPushed: true,
        sampleCount: 4,
        avgPcmBufferedMs: 42.67,
        playoutUnderTargetFraction: 0.807,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(computeN1PcmRebuildBurstCap('deep', 11)).toBe(5);
    expect(computeN1PcmRebuildBurstCap('moderate', 11)).toBe(6);
    expect(computeN1PcmRebuildBurstCap('normal', 11)).toBe(7);
    expect(
      shouldBoostN1PcmRebuild({
        sourceRecentlyPushed: true,
        sampleCount: 4,
        avgPcmBufferedMs: 90,
        playoutUnderTargetFraction: 0.4,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
  });

  it('keeps severe forced release in rebuild mode until playout reserve actually recovers', () => {
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_000,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 20,
        targetMs: 145,
        sampleCount: 0,
        avgPcmBufferedMs: 0,
        playoutUnderTargetFraction: 1,
        recentStable: false,
        severeInstability: true,
      })
    ).toBe(true);
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_000,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 44,
        targetMs: 145,
        sampleCount: 3,
        avgPcmBufferedMs: 95,
        playoutUnderTargetFraction: 0.2,
        recentStable: true,
        severeInstability: false,
      })
    ).toBe(true);
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_300,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 44,
        targetMs: 145,
        sampleCount: 3,
        avgPcmBufferedMs: 95,
        playoutUnderTargetFraction: 0.2,
        recentStable: false,
        severeInstability: false,
      })
    ).toBe(true);
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_300,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 44,
        targetMs: 145,
        sampleCount: 3,
        avgPcmBufferedMs: 95,
        playoutUnderTargetFraction: 0.2,
        recentStable: true,
        severeInstability: false,
      })
    ).toBe(false);
  });

  it('exits severe forced release when PCM has clearly recovered even if Opus reserve is modest', () => {
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_300,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 30,
        targetMs: 145,
        sampleCount: 4,
        avgPcmBufferedMs: 150,
        playoutUnderTargetFraction: 0.12,
        recentStable: false,
        severeInstability: false,
      })
    ).toBe(false);
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_300,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 30,
        targetMs: 145,
        sampleCount: 4,
        avgPcmBufferedMs: 150,
        playoutUnderTargetFraction: 0.12,
        recentStable: false,
        severeInstability: true,
      })
    ).toBe(true);
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_300,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 30,
        targetMs: 145,
        sampleCount: 4,
        avgPcmBufferedMs: 150,
        playoutUnderTargetFraction: 0.28,
        recentStable: false,
        severeInstability: false,
      })
    ).toBe(false);
    expect(
      shouldKeepN1SevereForcedReleaseRebuild({
        nowMs: 1_300,
        rebuildUntilMs: 1_260,
        opusBufferedMs: 30,
        targetMs: 145,
        sampleCount: 4,
        avgPcmBufferedMs: 150,
        playoutUnderTargetFraction: 0.35,
        recentStable: false,
        severeInstability: false,
      })
    ).toBe(true);
  });

  it('re-arms single-remote recovery when a live call collapses back to a one-frame floor', () => {
    expect(
      shouldRearmN1LateCollapseRecovery({
        nowMs: 1_000,
        cooldownUntilMs: 0,
        sourceRecentlyPushed: true,
        opusBufferedMs: 20,
        sampleCount: 4,
        avgPcmBufferedMs: 20.049,
        playoutUnderTargetFraction: 0.91,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldRearmN1LateCollapseRecovery({
        nowMs: 1_000,
        cooldownUntilMs: 1_000 + GCALL_N1_LATE_COLLAPSE_REARM_COOLDOWN_MS,
        sourceRecentlyPushed: true,
        opusBufferedMs: 20,
        sampleCount: 4,
        avgPcmBufferedMs: 20.049,
        playoutUnderTargetFraction: 0.91,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(false);
    expect(
      shouldRearmN1LateCollapseRecovery({
        nowMs: 1_000,
        cooldownUntilMs: 0,
        sourceRecentlyPushed: true,
        opusBufferedMs: 55,
        sampleCount: 4,
        avgPcmBufferedMs: 20.049,
        playoutUnderTargetFraction: 0.91,
        playoutStarvationSeverity: 'strong',
      })
    ).toBe(true);
    expect(
      shouldRearmN1LateCollapseRecovery({
        nowMs: 1_000,
        cooldownUntilMs: 0,
        sourceRecentlyPushed: true,
        opusBufferedMs: 65,
        sampleCount: 4,
        avgPcmBufferedMs: 100,
        playoutUnderTargetFraction: 0.4,
        playoutStarvationSeverity: 'mild',
      })
    ).toBe(false);
  });
});
