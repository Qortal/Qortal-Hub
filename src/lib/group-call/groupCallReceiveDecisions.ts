import type { GcallN1BufferEnforceTier } from './gcallN1PlayoutGate';
import type { PlayoutStarvationSeverity } from './gcallPlayoutStarvation';
import { OPUS_FRAME_DURATION_MS } from './gcallVoiceAudioConstants';

export const JITTER_EMPTY_HYSTERESIS_TICKS = 3;
export const GCALL_N1_INBOUND_MEDIA_MISSING_MIN_MS = 4_000;
export const GCALL_N1_INBOUND_MEDIA_WATCHDOG_COOLDOWN_MS = 4_000;
export const GCALL_N1_INBOUND_MEDIA_MISSING_MIN_FRESH_SENDS = 24;
export const GCALL_N1_INBOUND_MEDIA_REANNOUNCE_MIN_MS =
  GCALL_N1_INBOUND_MEDIA_MISSING_MIN_MS;
export const GCALL_N1_INBOUND_MEDIA_REANNOUNCE_COOLDOWN_MS = 4_000;
export const GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_LAST_RECV_MAX_MS = 1_500;
export const GCALL_N1_STEADY_STARVED_HOLD_OPUS_MAX_MS = 80;
export const GCALL_N1_STEADY_STARVED_HOLD_OPUS_FALLBACK_MS =
  OPUS_FRAME_DURATION_MS * 2;
export const GCALL_N1_STEADY_STARVED_HOLD_PCM_MAX_MS = 64;
export const GCALL_N1_STEADY_STARVED_HOLD_UNDERTARGET_MIN = 0.7;
export const GCALL_N1_STEADY_THIN_DEADZONE_TRIGGER_MS = 2_000;
export const GCALL_N1_STEADY_THIN_DEADZONE_OPUS_MAX_MS =
  OPUS_FRAME_DURATION_MS * 2;
export const GCALL_N1_STEADY_THIN_DEADZONE_HOLD_MIN_MS = 60;
export const GCALL_N1_STEADY_THIN_DEADZONE_HOLD_MAX_MS = 100;
export const GCALL_N1_STEADY_THIN_DEADZONE_HOLD_TARGET_RATIO = 0.55;
const RECEIVE_DECISIONS_ADAPTIVE_BASE_TARGET_MS = 100;

export interface RecentRecoveryStabilitySummary {
  sampleCount: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  underrunCount: number;
  stable: boolean;
  severeInstability: boolean;
}

function shouldDropActiveJitterSource(opts: {
  emptyTicks: number;
  playoutActive: boolean;
  hysteresisTicks?: number;
}): boolean {
  const hysteresisTicks = opts.hysteresisTicks ?? JITTER_EMPTY_HYSTERESIS_TICKS;
  return opts.emptyTicks >= hysteresisTicks && !opts.playoutActive;
}

function shouldDropNonParticipantRemoteAudioSource(opts: {
  sourceAddr: string;
  localAddress: string;
  participantAddresses: Iterable<string>;
  nowMs: number;
  startupMediaGateUntilMs: number;
  topologySettleUntilMs: number;
  startupSessionGraceUntilMs: number;
  authoritySettleUntilMs: number;
}): boolean {
  const sourceAddr = opts.sourceAddr.trim();
  if (!sourceAddr) return true;

  const localAddress = opts.localAddress.trim();
  if (localAddress && sourceAddr === localAddress) return false;

  for (const participantAddress of opts.participantAddresses) {
    if (participantAddress.trim() === sourceAddr) return false;
  }

  const graceUntilMs = Math.max(
    opts.startupMediaGateUntilMs,
    opts.topologySettleUntilMs,
    opts.startupSessionGraceUntilMs,
    opts.authoritySettleUntilMs
  );
  return opts.nowMs >= graceUntilMs;
}

function shouldHoldN1SteadyStarvedAccumulation(opts: {
  steadySingleRemote: boolean;
  sourceRecentlyPushed: boolean;
  hasReadyFrame: boolean;
  opusBufferedMs: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
}): boolean {
  if (
    !opts.steadySingleRemote ||
    !opts.sourceRecentlyPushed ||
    !opts.hasReadyFrame ||
    opts.opusBufferedMs > GCALL_N1_STEADY_STARVED_HOLD_OPUS_MAX_MS
  ) {
    return false;
  }
  if (
    opts.recentStability !== null &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_STEADY_STARVED_HOLD_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_STEADY_STARVED_HOLD_UNDERTARGET_MIN
  ) {
    return true;
  }
  return (
    opts.playoutStarvationSeverity === 'strong' &&
    opts.opusBufferedMs <= GCALL_N1_STEADY_STARVED_HOLD_OPUS_FALLBACK_MS
  );
}

function computeN1SteadyThinDeadzoneHoldMs(targetMs: number): number {
  const normalizedTargetMs = Math.max(
    RECEIVE_DECISIONS_ADAPTIVE_BASE_TARGET_MS,
    Number.isFinite(targetMs)
      ? targetMs
      : RECEIVE_DECISIONS_ADAPTIVE_BASE_TARGET_MS
  );
  const ratioHoldMs =
    Math.ceil(
      (normalizedTargetMs * GCALL_N1_STEADY_THIN_DEADZONE_HOLD_TARGET_RATIO) /
        OPUS_FRAME_DURATION_MS
    ) * OPUS_FRAME_DURATION_MS;
  return Math.max(
    GCALL_N1_STEADY_THIN_DEADZONE_HOLD_MIN_MS,
    Math.min(GCALL_N1_STEADY_THIN_DEADZONE_HOLD_MAX_MS, ratioHoldMs)
  );
}

function shouldHoldN1SteadyThinDeadzoneAccumulation(opts: {
  steadySingleRemote: boolean;
  sourceRecentlyPushed: boolean;
  hasReadyFrame: boolean;
  tier: GcallN1BufferEnforceTier;
  opusBufferedMs: number;
  targetMs: number;
  thinLiveForMs: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  playoutStarvationSeverity: PlayoutStarvationSeverity;
}): boolean {
  if (
    !opts.steadySingleRemote ||
    !opts.sourceRecentlyPushed ||
    !opts.hasReadyFrame ||
    opts.tier === 'normal' ||
    opts.thinLiveForMs < GCALL_N1_STEADY_THIN_DEADZONE_TRIGGER_MS ||
    opts.opusBufferedMs >= computeN1SteadyThinDeadzoneHoldMs(opts.targetMs)
  ) {
    return false;
  }
  if (
    opts.opusBufferedMs <= GCALL_N1_STEADY_THIN_DEADZONE_OPUS_MAX_MS &&
    opts.targetMs >= RECEIVE_DECISIONS_ADAPTIVE_BASE_TARGET_MS
  ) {
    return true;
  }
  if (
    opts.recentStability !== null &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.avgPcmBufferedMs <=
      GCALL_N1_STEADY_STARVED_HOLD_PCM_MAX_MS &&
    opts.recentStability.playoutUnderTargetFraction >=
      GCALL_N1_STEADY_STARVED_HOLD_UNDERTARGET_MIN
  ) {
    return true;
  }
  return opts.playoutStarvationSeverity === 'strong';
}

function shouldEnableN1DrainReceivePriorityMode(opts: {
  recoverySingleRemote: boolean;
  prerollActive: boolean;
  forceReceivePriorityModeActive: boolean;
  hasReceivePrioritySendCapState: boolean;
  lastRecvAgeMs: number;
  recentStability: RecentRecoveryStabilitySummary | null;
  severeForcedReleaseRebuildActive?: boolean;
}): boolean {
  if (!opts.recoverySingleRemote || opts.prerollActive) return false;
  if (opts.forceReceivePriorityModeActive) return true;
  if (!opts.hasReceivePrioritySendCapState) return false;
  if (
    !Number.isFinite(opts.lastRecvAgeMs) ||
    opts.lastRecvAgeMs >
      GCALL_N1_SUSTAINED_SEVERE_REBUILD_RELIEF_LAST_RECV_MAX_MS
  ) {
    return false;
  }
  if (opts.severeForcedReleaseRebuildActive === true) return true;
  return opts.recentStability !== null && !opts.recentStability.stable;
}

function shouldTriggerN1InboundMediaWatchdog(opts: {
  roomConnected: boolean;
  hasRoomKey: boolean;
  remotePeerCount: number;
  activeSourceCount: number;
  packetsReceived: number;
  packetsDecoded: number;
  relayPacketsSent: number;
  reticulumAudioPacketFreshSends: number;
  missingForMs: number;
  lastActionAgeMs: number;
}): boolean {
  if (!opts.roomConnected || !opts.hasRoomKey) return false;
  if (opts.remotePeerCount !== 1) return false;
  if (opts.activeSourceCount !== 0) return false;
  const outboundFreshSends = Math.max(
    opts.relayPacketsSent,
    opts.reticulumAudioPacketFreshSends
  );
  if (outboundFreshSends < GCALL_N1_INBOUND_MEDIA_MISSING_MIN_FRESH_SENDS) {
    return false;
  }
  const missingForMs = Number.isFinite(opts.missingForMs)
    ? opts.missingForMs
    : 0;
  const lastActionAgeMs = Number.isFinite(opts.lastActionAgeMs)
    ? opts.lastActionAgeMs
    : Number.POSITIVE_INFINITY;
  return (
    missingForMs >= GCALL_N1_INBOUND_MEDIA_MISSING_MIN_MS &&
    lastActionAgeMs >= GCALL_N1_INBOUND_MEDIA_WATCHDOG_COOLDOWN_MS
  );
}

function shouldTriggerN1InboundMediaReannounce(opts: {
  roomConnected: boolean;
  hasRoomKey: boolean;
  remotePeerCount: number;
  activeSourceCount: number;
  relayPacketsSent: number;
  reticulumAudioPacketFreshSends: number;
  missingForMs: number;
  lastReannounceAgeMs: number;
}): boolean {
  if (!opts.roomConnected || !opts.hasRoomKey) return false;
  if (opts.remotePeerCount !== 1 || opts.activeSourceCount !== 0) return false;
  const outboundFreshSends = Math.max(
    opts.relayPacketsSent,
    opts.reticulumAudioPacketFreshSends
  );
  if (outboundFreshSends < GCALL_N1_INBOUND_MEDIA_MISSING_MIN_FRESH_SENDS) {
    return false;
  }
  const missingForMs = Number.isFinite(opts.missingForMs)
    ? opts.missingForMs
    : 0;
  const lastReannounceAgeMs = Number.isFinite(opts.lastReannounceAgeMs)
    ? opts.lastReannounceAgeMs
    : Number.POSITIVE_INFINITY;
  return (
    missingForMs >= GCALL_N1_INBOUND_MEDIA_REANNOUNCE_MIN_MS &&
    lastReannounceAgeMs >= GCALL_N1_INBOUND_MEDIA_REANNOUNCE_COOLDOWN_MS
  );
}

function shouldSuppressStartupDecodeFailure(opts: {
  nowMs: number;
  startupMediaGateUntilMs: number;
}): boolean {
  return opts.startupMediaGateUntilMs > opts.nowMs;
}
