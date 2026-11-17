import type { PlayoutStarvationSeverity } from './gcallPlayoutStarvation';
import {
  ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS_SINGLE_REMOTE,
  ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX_SINGLE_REMOTE,
  type RecentRecoveryStabilitySummary,
} from './groupCallRecoveryDecisions';
import {
  shouldForceN1SustainedSevereRebuildReceiveRelief,
  shouldKeepSingleRemoteDegradedRebuildLocal,
  shouldSuppressSingleRemoteBufferedWindowRecovery,
} from './groupCallSingleRemoteRecoveryDecisions';

const ADAPTIVE_BASE_TARGET_MS = 100;
const ADAPTIVE_MIN_TARGET_MS = 100;
const GCALL_SINGLE_REMOTE_OVERBUFFER_TARGET_DROP_MS = 15;
const GCALL_SINGLE_REMOTE_OVERBUFFER_DRAIN_HEADROOM_MS = 35;
const GCALL_N1_WEAK_LIVE_HOLD_PCM_MAX_MS = 132;
const GCALL_N1_WEAK_LIVE_HOLD_UNDERTARGET_MIN = 0.4;
const GCALL_N1_WEAK_LIVE_HOLD_HEADROOM_MS = 32;
const GCALL_N1_WEAK_LIVE_HOLD_RECENT_PUSH_MAX_MS = 160;
const GCALL_N1_WEAK_LIVE_HOLD_RELEASE_MS = 650;
const GCALL_N1_WEAK_LIVE_HOLD_TARGET_RATIO_MAX = 0.82;
const GCALL_N1_RECEIVE_PRIORITY_CAP_PCM_STRONG_MAX_MS = 28;
const GCALL_N1_RECEIVE_PRIORITY_CAP_PCM_MAX_MS = 44;
const GCALL_N1_RECEIVE_PRIORITY_CAP_UNDERTARGET_STRONG_MIN = 0.85;
const GCALL_N1_RECEIVE_PRIORITY_CAP_UNDERTARGET_MIN = 0.75;
const GCALL_N1_RECEIVE_PRIORITY_CAP_DELTA_STRONG_MAX_MS = -70;
const GCALL_N1_RECEIVE_PRIORITY_CAP_DELTA_MAX_MS = -50;
const GCALL_N1_RECEIVE_PRIORITY_CAP_REMOTE_DECODE_AGE_MAX_MS = 350;
const GCALL_N1_RECEIVE_PRIORITY_CAP_STRONG_BPS = 24_000;
const GCALL_N1_RECEIVE_PRIORITY_CAP_MILD_BPS = 28_000;
const GCALL_N1_RECEIVE_PRIORITY_MODE_MIN_OPUS_MS = 60;
const GCALL_N1_RECEIVE_PRIORITY_MODE_PCM_MAX_MS = 52;
const GCALL_N1_RECEIVE_PRIORITY_MODE_UNDERTARGET_MIN = 0.78;
const GCALL_N1_RECEIVE_PRIORITY_MODE_DELTA_MAX_MS = -60;
const GCALL_N1_RECEIVE_PRIORITY_CAP_MIN_HOLD_MS = 900;
const GCALL_N1_RECEIVE_PRIORITY_CAP_EXIT_STABLE_MS = 650;
const GCALL_N1_RECEIVE_PRIORITY_CAP_EXIT_DELTA_MIN_MS = -20;
const GCALL_N1_SEVERE_PLAYOUT_WARM_COOLDOWN_MS = 8_000;
const GCALL_N1_SEVERE_PLAYOUT_WARM_BACKOFF_AFTER_FIRES = 3;
const GCALL_N1_SEVERE_PLAYOUT_WARM_BACKOFF_COOLDOWN_MS = 30_000;
const GCALL_N1_SEVERE_PLAYOUT_WARM_LAST_RECV_MAX_MS = 1_500;
const GCALL_N1_SEVERE_PLAYOUT_WARM_PCM_MAX_MS = 90;
const GCALL_N1_SEVERE_PLAYOUT_WARM_UNDERTARGET_MIN = 0.55;
const GCALL_N1_SEVERE_PLAYOUT_WARM_DELTA_MAX_MS = -45;
const GCALL_N1_SEVERE_PLAYOUT_WARM_INSTABILITY_UNDERTARGET_MIN = 0.72;
const GCALL_N1_SEVERE_PLAYOUT_WARM_INSTABILITY_DELTA_MAX_MS = -60;
const GCALL_N1_SEVERE_PLAYOUT_WARM_INSTABILITY_UNDERRUN_MIN = 1;
const GCALL_N1_ROUGH_LINK_REMOTE_DECODE_AGE_MAX_MS = 500;
const GCALL_N1_ROUGH_LINK_MIN_OPUS_MS = 60;
const GCALL_N1_ROUGH_LINK_PCM_MAX_MS = 120;
const GCALL_N1_ROUGH_LINK_UNDERTARGET_MIN = 0.4;
const GCALL_N1_ROUGH_LINK_DELTA_MAX_MS = -10;
const GCALL_N1_ROUGH_LINK_MISSING_FRAMES_MIN = 20;
const GCALL_N1_ROUGH_LINK_CONCEALMENT_TICKS_MIN = 10;
const GCALL_N1_ROUGH_LINK_INCOMING_PACKET_MS_MIN = 18;
const GCALL_N1_ROUGH_LINK_REBUILD_UNDERTARGET_MIN = 0.45;
const GCALL_N1_ROUGH_LINK_REBUILD_DELTA_MAX_MS = -10;
const GCALL_N1_ROUGH_LINK_CAP_BPS = 20_000;

export function shouldKeepMultiSourceWindowRecoveryLocal(opts: {
  activeSourceCount: number;
  shouldTightenRecovery: boolean;
  severePressure: boolean;
  packetsDroppedPendingDecrypt: number;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioDecodedQueueDepthHighWater: number;
  reticulumAudioBinaryOutQueueDepthHighWater: number;
  reticulumAudioBridgeQueuedFramesHighWater: number;
  degradedSourceCount: number;
}): boolean {
  if (
    opts.activeSourceCount < 2 ||
    !opts.shouldTightenRecovery ||
    !opts.severePressure ||
    opts.degradedSourceCount < 2
  ) {
    return false;
  }
  return (
    opts.packetsDroppedPendingDecrypt > 0 ||
    opts.reticulumAudioQueuePressureDrops > 0 ||
    opts.reticulumAudioDecodedQueueDepthHighWater >= 16 ||
    opts.reticulumAudioBinaryOutQueueDepthHighWater >= 24 ||
    opts.reticulumAudioBridgeQueuedFramesHighWater >= 12
  );
}

export function computeN1RoughLinkBitrateCapBps(opts: {
  activeSourceCount: number;
  pathDegradedUntilMs: number;
  nowMs: number;
  lastRecvAgeMs: number;
  recentStability: RecentRecoveryStabilitySummary;
  avgOpusBufferedMs: number;
  avgPlayoutDeltaMs: number;
  missingFrames: number;
  concealmentTicks: number;
  avgIncomingPacketMs: number;
  lastRemoteDecodeAtMs: number;
  nominalBitrateBps: number;
  severeForcedReleaseRebuildActive?: boolean;
}): number | null {
  if (
    opts.activeSourceCount !== 1 ||
    !Number.isFinite(opts.nominalBitrateBps) ||
    opts.nominalBitrateBps <= 0 ||
    opts.pathDegradedUntilMs <= opts.nowMs ||
    opts.recentStability.sampleCount < 2
  ) {
    return null;
  }
  const forceDegradedRebuildRelief = shouldKeepSingleRemoteDegradedRebuildLocal(
    {
      activeSourceCount: opts.activeSourceCount,
      pathDegradedUntilMs: opts.pathDegradedUntilMs,
      nowMs: opts.nowMs,
      lastRecvAgeMs: opts.lastRecvAgeMs,
      recentStability: opts.recentStability,
      avgOpusBufferedMs: opts.avgOpusBufferedMs,
      avgPlayoutDeltaMs: opts.avgPlayoutDeltaMs,
      severeForcedReleaseRebuildActive: opts.severeForcedReleaseRebuildActive,
      packetsDroppedPendingDecrypt: 0,
      reticulumAudioStaleDrops: 0,
      reticulumAudioPacketSendFailures: 0,
    }
  );
  if (forceDegradedRebuildRelief) {
    return Math.min(opts.nominalBitrateBps, GCALL_N1_ROUGH_LINK_CAP_BPS);
  }
  if (opts.avgOpusBufferedMs < GCALL_N1_ROUGH_LINK_MIN_OPUS_MS) {
    return null;
  }
  const lastRemoteDecodeAgeMs =
    opts.lastRemoteDecodeAtMs > 0
      ? opts.nowMs - opts.lastRemoteDecodeAtMs
      : Number.POSITIVE_INFINITY;
  if (lastRemoteDecodeAgeMs > GCALL_N1_ROUGH_LINK_REMOTE_DECODE_AGE_MAX_MS) {
    return null;
  }
  const pathEvidence =
    opts.missingFrames >= GCALL_N1_ROUGH_LINK_MISSING_FRAMES_MIN ||
    opts.concealmentTicks >= GCALL_N1_ROUGH_LINK_CONCEALMENT_TICKS_MIN ||
    opts.avgIncomingPacketMs >= GCALL_N1_ROUGH_LINK_INCOMING_PACKET_MS_MIN;
  const struggling =
    opts.recentStability.avgPcmBufferedMs <= GCALL_N1_ROUGH_LINK_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_ROUGH_LINK_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_ROUGH_LINK_DELTA_MAX_MS;
  const rebuildStruggling =
    opts.severeForcedReleaseRebuildActive === true &&
    opts.recentStability.avgPcmBufferedMs <= GCALL_N1_ROUGH_LINK_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_ROUGH_LINK_REBUILD_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_ROUGH_LINK_REBUILD_DELTA_MAX_MS &&
    !opts.recentStability.stable;
  if ((!pathEvidence && !rebuildStruggling) || !struggling) return null;
  return Math.min(opts.nominalBitrateBps, GCALL_N1_ROUGH_LINK_CAP_BPS);
}

export function computeWeakSingleRemoteRecoveryHoldState(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  recentStability: RecentRecoveryStabilitySummary;
  lastPushAgeMs: number;
  nowMs: number;
  holdUntilMs: number;
  recentPushMaxMs?: number;
}): { holdActive: boolean; nextHoldUntilMs: number } {
  const recentPushMaxMs =
    opts.recentPushMaxMs ?? GCALL_N1_WEAK_LIVE_HOLD_RECENT_PUSH_MAX_MS;
  if (opts.adaptiveNetworkMode !== 'recovery' || opts.activeSourceCount !== 1) {
    return { holdActive: false, nextHoldUntilMs: 0 };
  }
  const recentStability = opts.recentStability;
  const sourceRecentlyPushed =
    Number.isFinite(opts.lastPushAgeMs) && opts.lastPushAgeMs <= recentPushMaxMs;
  const weakLiveRecovery =
    recentStability.sampleCount >= 2 &&
    !recentStability.stable &&
    Number.isFinite(recentStability.avgPcmBufferedMs) &&
    recentStability.avgPcmBufferedMs <= GCALL_N1_WEAK_LIVE_HOLD_PCM_MAX_MS &&
    recentStability.playoutUnderTargetFraction >=
      GCALL_N1_WEAK_LIVE_HOLD_UNDERTARGET_MIN &&
    sourceRecentlyPushed;
  if (weakLiveRecovery) {
    return {
      holdActive: true,
      nextHoldUntilMs: opts.nowMs + GCALL_N1_WEAK_LIVE_HOLD_RELEASE_MS,
    };
  }
  if (
    sourceRecentlyPushed &&
    Number.isFinite(opts.holdUntilMs) &&
    opts.holdUntilMs > opts.nowMs
  ) {
    return { holdActive: true, nextHoldUntilMs: opts.holdUntilMs };
  }
  return { holdActive: false, nextHoldUntilMs: 0 };
}

export function computeWeakSingleRemoteRecoveryTargetHoldMaxMs(opts: {
  currentAdaptiveMaxTargetMs: number;
  holdActive: boolean;
  recentStability: RecentRecoveryStabilitySummary;
}): number | null {
  if (
    !opts.holdActive ||
    !Number.isFinite(opts.currentAdaptiveMaxTargetMs) ||
    opts.currentAdaptiveMaxTargetMs <= ADAPTIVE_MIN_TARGET_MS
  ) {
    return null;
  }
  const targetRatioCap = Math.round(
    opts.currentAdaptiveMaxTargetMs * GCALL_N1_WEAK_LIVE_HOLD_TARGET_RATIO_MAX
  );
  const feasibleMaxMs = Math.max(
    ADAPTIVE_MIN_TARGET_MS,
    Math.min(
      targetRatioCap,
      Math.round(
        opts.recentStability.avgPcmBufferedMs +
          GCALL_N1_WEAK_LIVE_HOLD_HEADROOM_MS
      )
    )
  );
  return Math.min(opts.currentAdaptiveMaxTargetMs, feasibleMaxMs);
}

export function computeSingleRemoteOverbufferTargetMaxMs(opts: {
  currentAdaptiveMaxTargetMs: number;
  activeSourceCount: number;
  avgPcmBufferedMs: number;
  avgPlayoutDeltaMs: number;
  playoutUnderTargetFraction: number;
  jitterNotReadyFraction: number;
  jitterRawEmptyFraction: number;
  observedTargetMs: number;
  packetsDropped: number;
  packetsDroppedPendingDecrypt: number;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioPacketPathTimeouts: number;
}): number | null {
  if (
    !Number.isFinite(opts.currentAdaptiveMaxTargetMs) ||
    opts.currentAdaptiveMaxTargetMs <= ADAPTIVE_MIN_TARGET_MS
  ) {
    return null;
  }
  if (
    !shouldSuppressSingleRemoteBufferedWindowRecovery({
      activeSourceCount: opts.activeSourceCount,
      avgPcmBufferedMs: opts.avgPcmBufferedMs,
      adaptiveTargetMedianMs: opts.observedTargetMs,
      avgPlayoutDeltaMs: opts.avgPlayoutDeltaMs,
      playoutUnderTargetFraction: opts.playoutUnderTargetFraction,
      jitterNotReadyFraction: opts.jitterNotReadyFraction,
      jitterRawEmptyFraction: opts.jitterRawEmptyFraction,
      packetsDropped: opts.packetsDropped,
      packetsDroppedPendingDecrypt: opts.packetsDroppedPendingDecrypt,
      reticulumAudioQueuePressureDrops: opts.reticulumAudioQueuePressureDrops,
      reticulumAudioStaleDrops: opts.reticulumAudioStaleDrops,
      reticulumAudioPacketSendFailures: opts.reticulumAudioPacketSendFailures,
      reticulumAudioPacketPathTimeouts: opts.reticulumAudioPacketPathTimeouts,
    })
  ) {
    return null;
  }
  const observedTarget = Math.max(
    ADAPTIVE_MIN_TARGET_MS,
    opts.observedTargetMs || ADAPTIVE_BASE_TARGET_MS
  );
  const targetDropCap = Math.max(
    ADAPTIVE_MIN_TARGET_MS,
    observedTarget - GCALL_SINGLE_REMOTE_OVERBUFFER_TARGET_DROP_MS
  );
  const drainHeadroomCap = Math.max(
    ADAPTIVE_MIN_TARGET_MS,
    opts.avgPcmBufferedMs - GCALL_SINGLE_REMOTE_OVERBUFFER_DRAIN_HEADROOM_MS
  );
  const cap = Math.min(
    opts.currentAdaptiveMaxTargetMs,
    targetDropCap,
    drainHeadroomCap
  );
  return Math.max(ADAPTIVE_MIN_TARGET_MS, Math.round(cap));
}

export function computeN1ReceivePrioritySendBitrateCapBps(opts: {
  activeSourceCount: number;
  recentStability: RecentRecoveryStabilitySummary;
  avgPlayoutDeltaMs: number;
  starvationSeverity: PlayoutStarvationSeverity;
  lastRemoteDecodeAtMs: number;
  nowMs: number;
  localSendPressure: boolean;
  nominalBitrateBps: number;
}): number | null {
  if (
    opts.activeSourceCount !== 1 ||
    !opts.localSendPressure ||
    opts.recentStability.sampleCount < 2 ||
    !Number.isFinite(opts.avgPlayoutDeltaMs) ||
    !Number.isFinite(opts.nominalBitrateBps) ||
    opts.nominalBitrateBps <= 0
  ) {
    return null;
  }
  const lastRemoteDecodeAgeMs =
    opts.lastRemoteDecodeAtMs > 0
      ? opts.nowMs - opts.lastRemoteDecodeAtMs
      : Number.POSITIVE_INFINITY;
  if (
    lastRemoteDecodeAgeMs >
    GCALL_N1_RECEIVE_PRIORITY_CAP_REMOTE_DECODE_AGE_MAX_MS
  ) {
    return null;
  }
  const severeCollapse =
    opts.starvationSeverity === 'strong' &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_RECEIVE_PRIORITY_CAP_PCM_STRONG_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_RECEIVE_PRIORITY_CAP_UNDERTARGET_STRONG_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_RECEIVE_PRIORITY_CAP_DELTA_STRONG_MAX_MS;
  if (severeCollapse) {
    return Math.min(
      opts.nominalBitrateBps,
      GCALL_N1_RECEIVE_PRIORITY_CAP_STRONG_BPS
    );
  }
  const weakCollapse =
    opts.starvationSeverity !== 'none' &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_RECEIVE_PRIORITY_CAP_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_RECEIVE_PRIORITY_CAP_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_RECEIVE_PRIORITY_CAP_DELTA_MAX_MS;
  if (!weakCollapse) return null;
  return Math.min(
    opts.nominalBitrateBps,
    GCALL_N1_RECEIVE_PRIORITY_CAP_MILD_BPS
  );
}

export interface N1ReceivePrioritySendBitrateCapState {
  holdUntilMs: number;
  stableSinceMs: number | null;
}

export function shouldEnterN1ReceivePriorityMode(opts: {
  recentStability: RecentRecoveryStabilitySummary;
  avgPlayoutDeltaMs: number;
  avgOpusBufferedMs: number;
  starvationSeverity: PlayoutStarvationSeverity;
  sourceLive: boolean;
  directCapBps: number | null;
  severeForcedReleaseRebuildActive?: boolean;
  forceDegradedRebuildRelief?: boolean;
}): boolean {
  if (!opts.sourceLive) return false;
  if (opts.forceDegradedRebuildRelief === true) {
    return true;
  }
  if (opts.recentStability.sampleCount < 2) {
    return false;
  }
  if (
    opts.severeForcedReleaseRebuildActive === true &&
    opts.recentStability.playoutUnderTargetFraction >= 0.45 &&
    opts.avgPlayoutDeltaMs <= -5 &&
    !opts.recentStability.stable
  ) {
    return true;
  }
  if (opts.avgOpusBufferedMs < GCALL_N1_RECEIVE_PRIORITY_MODE_MIN_OPUS_MS) {
    return false;
  }
  if (opts.directCapBps !== null) return true;
  return (
    opts.starvationSeverity === 'strong' &&
    opts.avgOpusBufferedMs >= GCALL_N1_RECEIVE_PRIORITY_MODE_MIN_OPUS_MS &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_RECEIVE_PRIORITY_MODE_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_RECEIVE_PRIORITY_MODE_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_RECEIVE_PRIORITY_MODE_DELTA_MAX_MS &&
    !opts.recentStability.stable
  );
}

export function shouldTriggerN1SeverePlayoutPathWarm(opts: {
  remotePeerCount: number;
  activeSourceCount: number;
  lastRecvAgeMs: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  avgPlayoutDeltaMs: number;
  starvationSeverity: PlayoutStarvationSeverity;
  lastActionAgeMs: number;
  consecutiveFires?: number;
}): boolean {
  if (opts.remotePeerCount !== 1 || opts.activeSourceCount !== 1) return false;
  if (
    !Number.isFinite(opts.lastRecvAgeMs) ||
    opts.lastRecvAgeMs > GCALL_N1_SEVERE_PLAYOUT_WARM_LAST_RECV_MAX_MS
  ) {
    return false;
  }
  const lastActionAgeMs = Number.isFinite(opts.lastActionAgeMs)
    ? opts.lastActionAgeMs
    : Number.POSITIVE_INFINITY;
  const consecutiveFires = Math.max(0, opts.consecutiveFires ?? 0);
  const cooldownMs =
    consecutiveFires >= GCALL_N1_SEVERE_PLAYOUT_WARM_BACKOFF_AFTER_FIRES
      ? GCALL_N1_SEVERE_PLAYOUT_WARM_BACKOFF_COOLDOWN_MS
      : GCALL_N1_SEVERE_PLAYOUT_WARM_COOLDOWN_MS;
  if (lastActionAgeMs < cooldownMs) {
    return false;
  }
  const recent = opts.recentStability;
  if (recent === null || recent.sampleCount < 2 || recent.stable) return false;
  const severelyUnderfed =
    recent.avgPcmBufferedMs <= GCALL_N1_SEVERE_PLAYOUT_WARM_PCM_MAX_MS &&
    recent.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_PLAYOUT_WARM_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_SEVERE_PLAYOUT_WARM_DELTA_MAX_MS;
  const instabilityWarmEligible =
    recent.severeInstability &&
    recent.underrunCount >=
      GCALL_N1_SEVERE_PLAYOUT_WARM_INSTABILITY_UNDERRUN_MIN &&
    recent.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_PLAYOUT_WARM_INSTABILITY_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <=
      GCALL_N1_SEVERE_PLAYOUT_WARM_INSTABILITY_DELTA_MAX_MS;
  return (
    severelyUnderfed &&
    (opts.starvationSeverity === 'strong' || instabilityWarmEligible)
  );
}

export function tickN1ReceivePrioritySendBitrateCapState(opts: {
  previousState: N1ReceivePrioritySendBitrateCapState | null;
  activeSourceCount: number;
  pathDegradedUntilMs: number;
  recentStability: RecentRecoveryStabilitySummary;
  avgPlayoutDeltaMs: number;
  avgOpusBufferedMs: number;
  jitterBufferedFrames?: number;
  starvationSeverity: PlayoutStarvationSeverity;
  lastRemoteDecodeAtMs: number;
  lastRecvAgeMs: number;
  nowMs: number;
  localSendPressure: boolean;
  nominalBitrateBps: number;
  severeForcedReleaseRebuildActive?: boolean;
  severeForcedReleaseRebuildActiveForMs?: number;
}): {
  capBps: number | null;
  nextState: N1ReceivePrioritySendBitrateCapState | null;
} {
  if (
    opts.activeSourceCount !== 1 ||
    !Number.isFinite(opts.nominalBitrateBps) ||
    opts.nominalBitrateBps <= 0
  ) {
    return { capBps: null, nextState: null };
  }
  const lastRemoteDecodeAgeMs =
    opts.lastRemoteDecodeAtMs > 0
      ? opts.nowMs - opts.lastRemoteDecodeAtMs
      : Number.POSITIVE_INFINITY;
  const forceSustainedSevereRebuildRelief =
    shouldForceN1SustainedSevereRebuildReceiveRelief({
      activeSourceCount: opts.activeSourceCount,
      lastRecvAgeMs: opts.lastRecvAgeMs,
      recentStability: opts.recentStability,
      avgPlayoutDeltaMs: opts.avgPlayoutDeltaMs,
      playoutStarvationSeverity: opts.starvationSeverity,
      avgOpusBufferedMs: opts.avgOpusBufferedMs,
      jitterBufferedFrames: opts.jitterBufferedFrames,
      severeForcedReleaseRebuildActive: opts.severeForcedReleaseRebuildActive,
      severeForcedReleaseRebuildActiveForMs:
        opts.severeForcedReleaseRebuildActiveForMs,
    });
  const forceDegradedRebuildRelief = shouldKeepSingleRemoteDegradedRebuildLocal(
    {
      activeSourceCount: opts.activeSourceCount,
      pathDegradedUntilMs: opts.pathDegradedUntilMs,
      nowMs: opts.nowMs,
      lastRecvAgeMs: opts.lastRecvAgeMs,
      recentStability: opts.recentStability,
      avgOpusBufferedMs: opts.avgOpusBufferedMs,
      avgPlayoutDeltaMs: opts.avgPlayoutDeltaMs,
      severeForcedReleaseRebuildActive: opts.severeForcedReleaseRebuildActive,
      severeForcedReleaseRebuildActiveForMs:
        opts.severeForcedReleaseRebuildActiveForMs,
      packetsDroppedPendingDecrypt: 0,
      reticulumAudioStaleDrops: 0,
      reticulumAudioPacketSendFailures: 0,
    }
  );
  const forceReceiveRelief =
    forceDegradedRebuildRelief || forceSustainedSevereRebuildRelief;
  if (
    lastRemoteDecodeAgeMs >
      GCALL_N1_RECEIVE_PRIORITY_CAP_REMOTE_DECODE_AGE_MAX_MS &&
    !forceReceiveRelief
  ) {
    return { capBps: null, nextState: null };
  }

  const directCapBps = computeN1ReceivePrioritySendBitrateCapBps({
    activeSourceCount: opts.activeSourceCount,
    recentStability: opts.recentStability,
    avgPlayoutDeltaMs: opts.avgPlayoutDeltaMs,
    starvationSeverity: opts.starvationSeverity,
    lastRemoteDecodeAtMs: opts.lastRemoteDecodeAtMs,
    nowMs: opts.nowMs,
    localSendPressure: opts.localSendPressure,
    nominalBitrateBps: opts.nominalBitrateBps,
  });
  if (
    shouldEnterN1ReceivePriorityMode({
      recentStability: opts.recentStability,
      avgPlayoutDeltaMs: opts.avgPlayoutDeltaMs,
      avgOpusBufferedMs: opts.avgOpusBufferedMs,
      starvationSeverity: opts.starvationSeverity,
      sourceLive: true,
      directCapBps,
      severeForcedReleaseRebuildActive: opts.severeForcedReleaseRebuildActive,
      forceDegradedRebuildRelief: forceReceiveRelief,
    })
  ) {
    return {
      capBps: Math.min(
        opts.nominalBitrateBps,
        GCALL_N1_RECEIVE_PRIORITY_CAP_STRONG_BPS
      ),
      nextState: {
        holdUntilMs: Math.max(
          opts.previousState?.holdUntilMs ?? 0,
          opts.nowMs + GCALL_N1_RECEIVE_PRIORITY_CAP_MIN_HOLD_MS
        ),
        stableSinceMs: null,
      },
    };
  }

  if (opts.previousState === null) {
    return { capBps: null, nextState: null };
  }

  const exitStable =
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.stable &&
    opts.recentStability.avgPcmBufferedMs >=
      ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS_SINGLE_REMOTE &&
    opts.recentStability.playoutUnderTargetFraction <=
      ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX_SINGLE_REMOTE &&
    opts.avgPlayoutDeltaMs >= GCALL_N1_RECEIVE_PRIORITY_CAP_EXIT_DELTA_MIN_MS &&
    opts.starvationSeverity === 'none';
  const stableSinceMs = exitStable
    ? (opts.previousState.stableSinceMs ?? opts.nowMs)
    : null;
  const heldActive = opts.nowMs < opts.previousState.holdUntilMs;
  const stableLongEnough =
    stableSinceMs !== null &&
    opts.nowMs - stableSinceMs >= GCALL_N1_RECEIVE_PRIORITY_CAP_EXIT_STABLE_MS;
  if (!heldActive && stableLongEnough) {
    return { capBps: null, nextState: null };
  }

  return {
    capBps: Math.min(
      opts.nominalBitrateBps,
      GCALL_N1_RECEIVE_PRIORITY_CAP_STRONG_BPS
    ),
    nextState: {
      holdUntilMs: opts.previousState.holdUntilMs,
      stableSinceMs,
    },
  };
}
