import type { GcallN1BufferEnforceTier } from './gcallN1PlayoutGate';
import {
  GCALL_N1_SEVERE_RELEASE_REBUILD_MIN_DECODE_CAP,
  GCALL_N1_STALL_ESCAPE_MS,
} from './gcallN1PlayoutGate';
import type { PlayoutStarvationSeverity } from './gcallPlayoutStarvation';
import { OPUS_FRAME_DURATION_MS } from './gcallVoiceAudioConstants';
import type { RecentRecoveryStabilitySummary } from './groupCallRecoveryDecisions';

const ADAPTIVE_BASE_TARGET_MS = 100;
const GCALL_N1_RECEIVE_PRIORITY_MODE_MIN_DECODE_CAP = 3;
const GCALL_N1_SEVERE_REBUILD_RELIEF_PCM_MAX_MS = 40;
const GCALL_N1_SEVERE_REBUILD_RELIEF_UNDERTARGET_MIN = 0.8;
const GCALL_N1_SEVERE_REBUILD_RELIEF_DELTA_MAX_MS = -60;
const GCALL_N1_SEVERE_REBUILD_RELIEF_OPUS_MAX_MS = 60;
const GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_MIN_MS = 900;
const GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_PCM_MAX_MS = 60;
const GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_UNDERTARGET_MIN = 0.7;
const GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_DELTA_MAX_MS = -20;
const GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_OPUS_MS =
  OPUS_FRAME_DURATION_MS * 5;
const GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_RATIO = 0.75;
const GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_OPUS_CEIL_MS =
  OPUS_FRAME_DURATION_MS * 8;
const GCALL_N1_SEVERE_REBUILD_ACCUMULATION_PCM_MAX_MS = 24;
const GCALL_N1_SEVERE_REBUILD_ACCUMULATION_UNDERTARGET_MIN = 0.9;
const GCALL_N1_SEVERE_REBUILD_LOW_PCM_HOLD_PCM_CEIL_MS = 72;
const GCALL_N1_SEVERE_REBUILD_LOW_PCM_HOLD_TARGET_RATIO = 0.45;
const GCALL_N1_SEVERE_REBUILD_LOW_PCM_HOLD_UNDERTARGET_MIN = 0.7;
const GCALL_N1_LIVE_DEADZONE_STARVATION_MIN_SAMPLES = 8;
const GCALL_N1_LIVE_DEADZONE_STARVATION_LAST_RECV_MAX_MS = 1_500;
const GCALL_N1_SEVERE_READY_ESCAPE_FRAMES_MIN = 4;
const GCALL_N1_ONE_FRAME_DEADZONE_RELIEF_MIN_MS = 600;
const GCALL_N1_ONE_FRAME_DEADZONE_OPUS_MAX_MS = OPUS_FRAME_DURATION_MS + 1;
const GCALL_N1_ONE_FRAME_DEADZONE_FRAMES_MAX = 1;
const GCALL_N1_ONE_FRAME_DEADZONE_PCM_MAX_MS = 12;
const GCALL_N1_ONE_FRAME_DEADZONE_UNDERTARGET_MIN = 0.9;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_LAST_RECV_MAX_MS = 450;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MIN_OPUS_MS = 70;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MIN_OPUS_RATIO = 0.55;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_PCM_MAX_MS = 64;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_UNDERTARGET_MIN = 0.7;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_DELTA_MAX_MS = -45;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MISSING_FRAMES_MAX = 40;
const GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_OPUS_PCM_GAP_MIN_MS = 12;
const GCALL_N1_DEGRADED_REBUILD_LIVE_LAST_RECV_MAX_MS = 900;
const GCALL_N1_DEGRADED_REBUILD_PCM_MAX_MS = 24;
const GCALL_N1_DEGRADED_REBUILD_UNDERTARGET_MIN = 0.9;
const GCALL_N1_DEGRADED_REBUILD_DELTA_MAX_MS = -80;
const GCALL_N1_DEGRADED_REBUILD_OPUS_MAX_MS = 40;
const GCALL_N1_FORCE_FULL_RECOVERY_PCM_MAX_MS = 18;
const GCALL_N1_FORCE_FULL_RECOVERY_UNDERTARGET_MIN = 0.1;
const GCALL_N1_FORCE_FULL_RECOVERY_CONCEALMENT_TICKS_MIN = 120;
const GCALL_N1_FORCE_FULL_RECOVERY_MISSING_FRAMES_MIN = 120;
const GCALL_N1_FORCE_FULL_RECOVERY_AVG_INCOMING_PACKET_MS_MIN = 6;
const GCALL_N1_FORCE_FULL_RECOVERY_MAX_INCOMING_PACKET_MS_MIN = 120;
const GCALL_N1_FORCE_FULL_RECOVERY_AVG_BRIDGE_INGRESS_MS_MIN = 20;
const GCALL_N1_FORCE_FULL_RECOVERY_MAX_BRIDGE_INGRESS_MS_MIN = 200;
const GCALL_N1_FORCE_FULL_RECOVERY_DELTA_MAX_MS = -80;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_RESET_MIN_MS = 6_000;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_LAST_RECV_MAX_MS = 1_500;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_OPUS_FRAMES_MAX = 2;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_DRIP_MIN_MS = 3_000;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_PCM_MAX_MS = 4;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_UNDERTARGET_MIN = 0.95;
const GCALL_N1_SEVERE_REBUILD_DEADZONE_DELTA_MAX_MS = -80;
function computeN1SevereRebuildLowPcmHoldMaxMs(targetMs?: number): number {
  const normalizedTargetMs =
    Number.isFinite(targetMs) && targetMs !== undefined
      ? Math.max(ADAPTIVE_BASE_TARGET_MS, targetMs)
      : ADAPTIVE_BASE_TARGET_MS;
  return Math.max(
    GCALL_N1_SEVERE_REBUILD_ACCUMULATION_PCM_MAX_MS,
    Math.min(
      GCALL_N1_SEVERE_REBUILD_LOW_PCM_HOLD_PCM_CEIL_MS,
      normalizedTargetMs * GCALL_N1_SEVERE_REBUILD_LOW_PCM_HOLD_TARGET_RATIO
    )
  );
}

function computeN1SevereReadyEscapeMinFrames(targetMs: number): number {
  const normalizedTargetMs = Math.max(
    OPUS_FRAME_DURATION_MS,
    Number.isFinite(targetMs) ? targetMs : ADAPTIVE_BASE_TARGET_MS
  );
  return Math.max(
    GCALL_N1_SEVERE_READY_ESCAPE_FRAMES_MIN,
    Math.ceil(normalizedTargetMs / OPUS_FRAME_DURATION_MS)
  );
}

function computeN1AccumulationDecodeCap(opts: {
  accumulationActive: boolean;
  recoverySingleRemote: boolean;
  forcedReleaseRebuildActive?: boolean;
  opusBufferedMs: number;
  tier: GcallN1BufferEnforceTier;
  targetMs?: number;
}): number | null {
  if (!opts.accumulationActive) return null;
  const severeRebuildHoldOpusMs = computeN1SevereRebuildAccumulationHoldOpusMs(
    opts.targetMs
  );
  if (
    opts.recoverySingleRemote &&
    opts.opusBufferedMs <=
      (opts.forcedReleaseRebuildActive
        ? severeRebuildHoldOpusMs
        : OPUS_FRAME_DURATION_MS) &&
    (opts.forcedReleaseRebuildActive || opts.tier === 'deep')
  ) {
    return 0;
  }
  if (opts.recoverySingleRemote && opts.forcedReleaseRebuildActive) {
    return GCALL_N1_SEVERE_RELEASE_REBUILD_MIN_DECODE_CAP;
  }
  return 1;
}

function computeN1SevereRebuildAccumulationHoldOpusMs(
  targetMs?: number
): number {
  const normalizedTargetMs =
    Number.isFinite(targetMs) && targetMs !== undefined
      ? Math.max(GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_OPUS_MS, targetMs)
      : GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_OPUS_MS;
  return Math.max(
    GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_OPUS_MS,
    Math.min(
      GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_OPUS_CEIL_MS,
      normalizedTargetMs * GCALL_N1_SEVERE_REBUILD_ACCUMULATION_HOLD_RATIO
    )
  );
}

function computeEffectiveN1AccumulationDecodeCap(opts: {
  accumulationDecodeCap: number;
  n1PcmRebuildActive: boolean;
  n1ReceivePriorityModeActive: boolean;
}): number {
  if (opts.n1PcmRebuildActive) {
    return Math.max(
      GCALL_N1_SEVERE_RELEASE_REBUILD_MIN_DECODE_CAP,
      opts.accumulationDecodeCap
    );
  }
  if (opts.n1ReceivePriorityModeActive) {
    return Math.max(
      GCALL_N1_RECEIVE_PRIORITY_MODE_MIN_DECODE_CAP,
      opts.accumulationDecodeCap
    );
  }
  if (opts.accumulationDecodeCap === 0) return 0;
  return opts.accumulationDecodeCap;
}

function shouldPreserveN1SevereSingleRemoteTarget(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  severeWindowSource: boolean;
  isolatedSource: boolean;
  liveN1DeadzoneStrong: boolean;
  playoutStarvationSeverity?: PlayoutStarvationSeverity;
  starvationCooldownActive?: boolean;
}): boolean {
  return (
    opts.adaptiveNetworkMode === 'recovery' &&
    opts.activeSourceCount === 1 &&
    (opts.liveN1DeadzoneStrong ||
      (opts.severeWindowSource && opts.isolatedSource) ||
      opts.playoutStarvationSeverity === 'strong' ||
      opts.starvationCooldownActive === true)
  );
}

function shouldUseN1SevereSingleRemoteCeiling(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  severeWindowSource: boolean;
  isolatedSource: boolean;
  liveN1DeadzoneStrong: boolean;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
}): boolean {
  return (
    opts.adaptiveNetworkMode === 'recovery' &&
    opts.activeSourceCount === 1 &&
    (opts.liveN1DeadzoneStrong ||
      opts.playoutStarvationSeverity === 'strong' ||
      (opts.severeWindowSource && opts.isolatedSource))
  );
}

function shouldExtendN1SevereRebuildAccumulation(opts: {
  recoverySingleRemote: boolean;
  prerollActive: boolean;
  severeForcedReleaseRebuildActive: boolean;
  sourceRecentlyPushed: boolean;
  opusBufferedMs: number;
  targetMs?: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
}): boolean {
  const severeRebuildHoldOpusMs = computeN1SevereRebuildAccumulationHoldOpusMs(
    opts.targetMs
  );
  const lowPcmHoldMaxMs = computeN1SevereRebuildLowPcmHoldMaxMs(opts.targetMs);
  if (
    !opts.recoverySingleRemote ||
    opts.prerollActive ||
    !opts.severeForcedReleaseRebuildActive ||
    opts.opusBufferedMs > severeRebuildHoldOpusMs
  ) {
    return false;
  }
  if (
    opts.recentStability !== null &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_SEVERE_REBUILD_ACCUMULATION_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_REBUILD_ACCUMULATION_UNDERTARGET_MIN
  ) {
    return true;
  }
  if (
    opts.recentStability !== null &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.severeInstability &&
    opts.recentStability.avgPcmBufferedMs <= lowPcmHoldMaxMs &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_REBUILD_LOW_PCM_HOLD_UNDERTARGET_MIN
  ) {
    return true;
  }
  if (!opts.sourceRecentlyPushed) return false;
  return opts.playoutStarvationSeverity === 'strong';
}

function shouldPromoteLiveN1PlayoutDeadzoneToStrong(opts: {
  activeSourceCount: number;
  lastRecvAgeMs: number;
  recentStability: RecentRecoveryStabilitySummary;
}): boolean {
  return (
    opts.activeSourceCount === 1 &&
    Number.isFinite(opts.lastRecvAgeMs) &&
    opts.lastRecvAgeMs <= GCALL_N1_LIVE_DEADZONE_STARVATION_LAST_RECV_MAX_MS &&
    opts.recentStability.sampleCount >=
      GCALL_N1_LIVE_DEADZONE_STARVATION_MIN_SAMPLES &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_ONE_FRAME_DEADZONE_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_ONE_FRAME_DEADZONE_UNDERTARGET_MIN
  );
}

function shouldRetainN1RecoveryPrerollSatisfied(opts: {
  bufferedFrames: number;
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  lastPushAgeMs: number;
  recentPushMaxMs?: number;
}): boolean {
  const recentPushMaxMs = opts.recentPushMaxMs ?? GCALL_N1_STALL_ESCAPE_MS;
  return (
    opts.bufferedFrames === 0 &&
    opts.activeSourceCount === 1 &&
    opts.adaptiveNetworkMode === 'recovery' &&
    Number.isFinite(opts.lastPushAgeMs) &&
    opts.lastPushAgeMs <= recentPushMaxMs
  );
}

function shouldRelaxSingleRemoteWindowRecovery(opts: {
  activeSourceCount: number;
  shouldTightenRecovery: boolean;
  avgOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  concealmentTicks: number;
}): boolean {
  const target = Math.max(1, opts.adaptiveTargetMedianMs);
  const opusAdequacy = opts.avgOpusBufferedMs / target;
  const thinButUsableReserve =
    opts.avgPcmBufferedMs >= 140 &&
    opts.playoutUnderTargetFraction <= 0.4 &&
    opts.avgPlayoutDeltaMs >= -35 &&
    opts.concealmentTicks <= 25;
  return (
    opts.activeSourceCount === 1 &&
    !opts.shouldTightenRecovery &&
    (opusAdequacy >= 0.3 || thinButUsableReserve) &&
    opts.avgPcmBufferedMs >= 100 &&
    opts.playoutUnderTargetFraction <= 0.6 &&
    opts.avgPlayoutDeltaMs >= -80 &&
    opts.concealmentTicks <= 100
  );
}

function shouldKeepSingleRemoteWindowRecoveryLocal(opts: {
  activeSourceCount: number;
  lastRecvAgeMs: number;
  avgOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  adaptiveTargetMaxMs: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  missingFrames: number;
  packetsDroppedPendingDecrypt: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioPacketPathTimeouts: number;
}): boolean {
  const target = Math.max(
    1,
    opts.adaptiveTargetMedianMs || opts.adaptiveTargetMaxMs || 1
  );
  const freshLive =
    Number.isFinite(opts.lastRecvAgeMs) &&
    opts.lastRecvAgeMs <= GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_LAST_RECV_MAX_MS;
  const noHardRemoteFailure =
    opts.missingFrames <= GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MISSING_FRAMES_MAX &&
    opts.packetsDroppedPendingDecrypt <= 0 &&
    opts.reticulumAudioStaleDrops <= 0 &&
    opts.reticulumAudioPacketSendFailures <= 0 &&
    opts.reticulumAudioPacketPathTimeouts <= 0;
  return (
    opts.activeSourceCount === 1 &&
    freshLive &&
    noHardRemoteFailure &&
    (opts.avgOpusBufferedMs >=
      GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MIN_OPUS_MS ||
      opts.avgOpusBufferedMs / target >=
        GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MIN_OPUS_RATIO) &&
    opts.avgOpusBufferedMs >=
      opts.avgPcmBufferedMs +
        GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_OPUS_PCM_GAP_MIN_MS &&
    opts.avgPcmBufferedMs <= GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_PCM_MAX_MS &&
    opts.playoutUnderTargetFraction >=
      GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_DELTA_MAX_MS
  );
}

function shouldForceSingleRemoteFullRecovery(opts: {
  activeSourceCount: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  concealmentTicks: number;
  missingFrames: number;
  avgIncomingPacketMs?: number;
  maxIncomingPacketMs?: number;
  avgReticulumAudioBridgeToRendererIngressMs?: number;
  maxReticulumAudioBridgeToRendererIngressMs?: number;
}): boolean {
  const severePathEvidence =
    opts.missingFrames >= GCALL_N1_FORCE_FULL_RECOVERY_MISSING_FRAMES_MIN ||
    (opts.avgIncomingPacketMs ?? 0) >=
      GCALL_N1_FORCE_FULL_RECOVERY_AVG_INCOMING_PACKET_MS_MIN ||
    (opts.maxIncomingPacketMs ?? 0) >=
      GCALL_N1_FORCE_FULL_RECOVERY_MAX_INCOMING_PACKET_MS_MIN ||
    (opts.avgReticulumAudioBridgeToRendererIngressMs ?? 0) >=
      GCALL_N1_FORCE_FULL_RECOVERY_AVG_BRIDGE_INGRESS_MS_MIN ||
    (opts.maxReticulumAudioBridgeToRendererIngressMs ?? 0) >=
      GCALL_N1_FORCE_FULL_RECOVERY_MAX_BRIDGE_INGRESS_MS_MIN;
  return (
    opts.activeSourceCount === 1 &&
    opts.avgPcmBufferedMs <= GCALL_N1_FORCE_FULL_RECOVERY_PCM_MAX_MS &&
    opts.playoutUnderTargetFraction >=
      GCALL_N1_FORCE_FULL_RECOVERY_UNDERTARGET_MIN &&
    opts.concealmentTicks >=
      GCALL_N1_FORCE_FULL_RECOVERY_CONCEALMENT_TICKS_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_FORCE_FULL_RECOVERY_DELTA_MAX_MS &&
    severePathEvidence
  );
}

function shouldKeepSingleRemoteSevereRebuildDeadzoneLocal(opts: {
  activeSourceCount: number;
  lastRecvAgeMs: number;
  avgOpusBufferedMs: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  missingFrames: number;
  jitterBufferDepthFramesMean?: number;
  severeForcedReleaseRebuildActive?: boolean;
  severeForcedReleaseRebuildActiveForMs?: number;
  packetsDroppedPendingDecrypt: number;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioPacketPathTimeouts: number;
  reticulumAudioBridgeQueuedFramesHighWater?: number;
}): boolean {
  const freshLive =
    Number.isFinite(opts.lastRecvAgeMs) &&
    opts.lastRecvAgeMs <= GCALL_N1_SEVERE_REBUILD_DEADZONE_LAST_RECV_MAX_MS;
  const hardRemoteFailure =
    opts.packetsDroppedPendingDecrypt > 0 ||
    opts.reticulumAudioQueuePressureDrops > 0 ||
    opts.reticulumAudioStaleDrops > 0 ||
    opts.reticulumAudioPacketSendFailures > 0 ||
    opts.reticulumAudioPacketPathTimeouts > 0 ||
    (opts.reticulumAudioBridgeQueuedFramesHighWater ?? 0) >= 12;
  const thinJitter =
    opts.avgOpusBufferedMs <=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_OPUS_FRAMES_MAX *
        OPUS_FRAME_DURATION_MS ||
    (opts.jitterBufferDepthFramesMean ?? Number.POSITIVE_INFINITY) <=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_OPUS_FRAMES_MAX;
  const severeRebuildActiveLongEnough =
    opts.severeForcedReleaseRebuildActive === true &&
    (opts.severeForcedReleaseRebuildActiveForMs ?? 0) >=
      GCALL_N1_ONE_FRAME_DEADZONE_RELIEF_MIN_MS;
  return (
    opts.activeSourceCount === 1 &&
    freshLive &&
    !hardRemoteFailure &&
    opts.missingFrames <= GCALL_N1_LOCAL_ONLY_WINDOW_RECOVERY_MISSING_FRAMES_MAX &&
    thinJitter &&
    opts.avgPcmBufferedMs <= GCALL_N1_SEVERE_REBUILD_DEADZONE_PCM_MAX_MS &&
    opts.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_SEVERE_REBUILD_DEADZONE_DELTA_MAX_MS &&
    (severeRebuildActiveLongEnough ||
      opts.avgOpusBufferedMs <=
        GCALL_N1_SEVERE_REBUILD_DEADZONE_OPUS_FRAMES_MAX *
          OPUS_FRAME_DURATION_MS)
  );
}

export function shouldSuppressSingleRemoteBufferedWindowRecovery(opts: {
  activeSourceCount: number;
  avgPcmBufferedMs: number;
  adaptiveTargetMedianMs: number;
  avgPlayoutDeltaMs: number;
  playoutUnderTargetFraction: number;
  jitterNotReadyFraction: number;
  jitterRawEmptyFraction: number;
  packetsDropped: number;
  packetsDroppedPendingDecrypt: number;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioPacketPathTimeouts: number;
}): boolean {
  const target = Math.max(
    1,
    opts.adaptiveTargetMedianMs || ADAPTIVE_BASE_TARGET_MS
  );
  const hardTransportFailure =
    opts.packetsDropped > 0 ||
    opts.packetsDroppedPendingDecrypt > 0 ||
    opts.reticulumAudioQueuePressureDrops > 0 ||
    opts.reticulumAudioStaleDrops > 0 ||
    opts.reticulumAudioPacketSendFailures > 0 ||
    opts.reticulumAudioPacketPathTimeouts > 0;
  return (
    opts.activeSourceCount === 1 &&
    !hardTransportFailure &&
    opts.avgPcmBufferedMs >= target + 24 &&
    opts.avgPlayoutDeltaMs >= 20 &&
    opts.playoutUnderTargetFraction <= 0.25 &&
    opts.jitterNotReadyFraction <= 0.05 &&
    opts.jitterRawEmptyFraction <= 0.05
  );
}

export function shouldKeepSingleRemoteDegradedRebuildLocal(opts: {
  activeSourceCount: number;
  pathDegradedUntilMs: number;
  nowMs: number;
  lastRecvAgeMs: number;
  recentStability: RecentRecoveryStabilitySummary;
  avgOpusBufferedMs: number;
  avgPlayoutDeltaMs: number;
  windowAvgPcmBufferedMs?: number;
  windowPlayoutUnderTargetFraction?: number;
  windowJitterBufferDepthFramesMean?: number;
  severeForcedReleaseRebuildActive?: boolean;
  severeForcedReleaseRebuildActiveForMs?: number;
  packetsDroppedPendingDecrypt: number;
  reticulumAudioQueuePressureDrops?: number;
  reticulumAudioStaleDrops: number;
  reticulumAudioPacketSendFailures: number;
  reticulumAudioBridgeQueuedFramesHighWater?: number;
}): boolean {
  const explicitDegradedRebuild =
    opts.pathDegradedUntilMs > opts.nowMs &&
    opts.severeForcedReleaseRebuildActive === true &&
    opts.recentStability.sampleCount >= 2 &&
    !opts.recentStability.stable &&
    opts.recentStability.avgPcmBufferedMs <= 24 &&
    opts.recentStability.playoutUnderTargetFraction >= 0.9 &&
    opts.avgPlayoutDeltaMs <= -80 &&
    opts.avgOpusBufferedMs <= 40;
  const stuckSevereRebuild =
    opts.severeForcedReleaseRebuildActive === true &&
    opts.recentStability.sampleCount >= 2 &&
    !opts.recentStability.stable &&
    opts.recentStability.severeInstability === true &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_SEVERE_REBUILD_RELIEF_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_REBUILD_RELIEF_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <= GCALL_N1_SEVERE_REBUILD_RELIEF_DELTA_MAX_MS &&
    opts.avgOpusBufferedMs <= GCALL_N1_SEVERE_REBUILD_RELIEF_OPUS_MAX_MS;
  const sustainedSevereRebuild =
    opts.severeForcedReleaseRebuildActive === true &&
    (opts.severeForcedReleaseRebuildActiveForMs ?? 0) >=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_MIN_MS &&
    opts.recentStability.sampleCount >= 2 &&
    !opts.recentStability.stable &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_DELTA_MAX_MS;
  const oneFrameDeadzoneSevereRebuild =
    opts.severeForcedReleaseRebuildActive === true &&
    (opts.severeForcedReleaseRebuildActiveForMs ?? 0) >=
      GCALL_N1_ONE_FRAME_DEADZONE_RELIEF_MIN_MS &&
    opts.avgPlayoutDeltaMs <=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_DELTA_MAX_MS &&
    (opts.avgOpusBufferedMs <= GCALL_N1_ONE_FRAME_DEADZONE_OPUS_MAX_MS ||
      (opts.windowJitterBufferDepthFramesMean ?? Number.POSITIVE_INFINITY) <=
        GCALL_N1_ONE_FRAME_DEADZONE_FRAMES_MAX) &&
    ((opts.recentStability.sampleCount >= 2 &&
      opts.recentStability.avgPcmBufferedMs <=
        GCALL_N1_ONE_FRAME_DEADZONE_PCM_MAX_MS &&
      opts.recentStability.playoutUnderTargetFraction >=
        GCALL_N1_ONE_FRAME_DEADZONE_UNDERTARGET_MIN) ||
      ((opts.windowAvgPcmBufferedMs ?? Number.POSITIVE_INFINITY) <=
        GCALL_N1_ONE_FRAME_DEADZONE_PCM_MAX_MS &&
        (opts.windowPlayoutUnderTargetFraction ?? 0) >=
          GCALL_N1_ONE_FRAME_DEADZONE_UNDERTARGET_MIN));
  return (
    opts.activeSourceCount === 1 &&
    (explicitDegradedRebuild ||
      stuckSevereRebuild ||
      sustainedSevereRebuild ||
      oneFrameDeadzoneSevereRebuild) &&
    Number.isFinite(opts.lastRecvAgeMs) &&
    opts.lastRecvAgeMs <= GCALL_N1_DEGRADED_REBUILD_LIVE_LAST_RECV_MAX_MS &&
    opts.packetsDroppedPendingDecrypt <= 0 &&
    (opts.reticulumAudioQueuePressureDrops ?? 0) <= 0 &&
    opts.reticulumAudioStaleDrops <= 0 &&
    opts.reticulumAudioPacketSendFailures <= 0 &&
    (opts.reticulumAudioBridgeQueuedFramesHighWater ?? 0) < 12
  );
}

export function shouldForceN1SustainedSevereRebuildReceiveRelief(opts: {
  activeSourceCount: number;
  lastRecvAgeMs: number;
  recentStability: RecentRecoveryStabilitySummary;
  avgPlayoutDeltaMs: number;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
  avgOpusBufferedMs?: number;
  jitterBufferedFrames?: number;
  severeForcedReleaseRebuildActive?: boolean;
  severeForcedReleaseRebuildActiveForMs?: number;
}): boolean {
  if (
    opts.activeSourceCount !== 1 ||
    opts.severeForcedReleaseRebuildActive !== true ||
    (opts.severeForcedReleaseRebuildActiveForMs ?? 0) <
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_MIN_MS ||
    !Number.isFinite(opts.lastRecvAgeMs) ||
    opts.lastRecvAgeMs > 1_500
  ) {
    return false;
  }
  const exactOneFrameDeadzone =
    (opts.severeForcedReleaseRebuildActiveForMs ?? 0) >=
      GCALL_N1_ONE_FRAME_DEADZONE_RELIEF_MIN_MS &&
    ((opts.jitterBufferedFrames ?? Number.POSITIVE_INFINITY) <=
      GCALL_N1_ONE_FRAME_DEADZONE_FRAMES_MAX ||
      (opts.avgOpusBufferedMs ?? Number.POSITIVE_INFINITY) <=
        GCALL_N1_ONE_FRAME_DEADZONE_OPUS_MAX_MS);
  if (exactOneFrameDeadzone) return true;
  if (opts.playoutStarvationSeverity === 'strong') return true;
  return (
    opts.recentStability.sampleCount >= 2 &&
    !opts.recentStability.stable &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_UNDERTARGET_MIN &&
    opts.avgPlayoutDeltaMs <=
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_DELTA_MAX_MS
  );
}

function shouldForceN1SevereRebuildReadyEscape(opts: {
  recoverySingleRemote: boolean;
  prerollActive: boolean;
  severeForcedReleaseRebuildActive: boolean;
  severeForcedReleaseRebuildActiveForMs: number;
  sourceRecentlyPushed: boolean;
  hasReadyFrame: boolean;
  bufferedFrames: number;
  targetMs: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
}): boolean {
  const minEscapeFrames = computeN1SevereReadyEscapeMinFrames(opts.targetMs);
  if (
    !opts.recoverySingleRemote ||
    opts.prerollActive ||
    !opts.severeForcedReleaseRebuildActive ||
    opts.severeForcedReleaseRebuildActiveForMs <
      GCALL_N1_ONE_FRAME_DEADZONE_RELIEF_MIN_MS ||
    !opts.sourceRecentlyPushed ||
    opts.bufferedFrames <= 0
  ) {
    return false;
  }
  const exactTwoFrameDeadzone =
    opts.severeForcedReleaseRebuildActiveForMs >=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_DRIP_MIN_MS &&
    opts.bufferedFrames === GCALL_N1_SEVERE_REBUILD_DEADZONE_OPUS_FRAMES_MAX &&
    opts.recentStability !== null &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_UNDERTARGET_MIN;
  if (exactTwoFrameDeadzone) return true;
  if (opts.hasReadyFrame || opts.bufferedFrames < minEscapeFrames) {
    return false;
  }
  if (
    opts.recentStability !== null &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_ONE_FRAME_DEADZONE_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_ONE_FRAME_DEADZONE_UNDERTARGET_MIN
  ) {
    return true;
  }
  return opts.playoutStarvationSeverity === 'strong';
}

function shouldResetN1SevereRebuildDeadzone(opts: {
  recoverySingleRemote: boolean;
  prerollActive: boolean;
  severeForcedReleaseRebuildActive: boolean;
  severeForcedReleaseRebuildActiveForMs: number;
  sourceRecentlyPushed: boolean;
  lastRecvAgeMs: number;
  bufferedFrames: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
}): boolean {
  if (
    !opts.recoverySingleRemote ||
    opts.prerollActive ||
    !opts.severeForcedReleaseRebuildActive ||
    opts.severeForcedReleaseRebuildActiveForMs <
      GCALL_N1_SEVERE_REBUILD_DEADZONE_RESET_MIN_MS ||
    !opts.sourceRecentlyPushed ||
    !Number.isFinite(opts.lastRecvAgeMs) ||
    opts.lastRecvAgeMs > GCALL_N1_SEVERE_REBUILD_DEADZONE_LAST_RECV_MAX_MS ||
    opts.recentStability === null ||
    opts.recentStability.sampleCount < 2
  ) {
    return false;
  }
  const stillExactDeadzone =
    opts.bufferedFrames <= GCALL_N1_SEVERE_REBUILD_DEADZONE_OPUS_FRAMES_MAX;
  return (
    stillExactDeadzone &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_SEVERE_REBUILD_DEADZONE_UNDERTARGET_MIN &&
    (opts.playoutStarvationSeverity === 'strong' ||
      opts.recentStability.severeInstability)
  );
}

function shouldBlockN1RecoveryExitForCurrentJitter(opts: {
  activeSourceCount: number;
  bufferedFrames: number;
  hasReadyFrame: boolean;
}): boolean {
  return (
    opts.activeSourceCount === 1 &&
    opts.bufferedFrames > 0 &&
    (!opts.hasReadyFrame ||
      opts.bufferedFrames <
        computeN1SevereReadyEscapeMinFrames(ADAPTIVE_BASE_TARGET_MS))
  );
}
