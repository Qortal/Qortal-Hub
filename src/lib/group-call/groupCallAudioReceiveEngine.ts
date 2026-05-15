import {
  DmVoiceGcallInboundPlayout,
  type GcallAudioGapAttributionRecord,
} from '../call/dmVoiceGcallInboundPlayout';
import { applyCallAudioOutput } from '../call/audioDevices';
import {
  decodeAudioPackets,
  type DecodedAudioPacket,
} from './audioPacketCodec';
import {
  getGroupCallAudioTuning,
  type GroupCallAudioQualityProfile,
} from './groupCallAudioProfile';
import {
  GroupCallPerformanceTracker,
  type GroupCallMetricsSnapshot,
} from './router';
import { tracePipelineReceiveDroppedNoRoomKey } from './gcallAudioSurfaceTrace';
import { traceGcallAudioSurface } from './gcallAudioSurfaceTrace';
import { OPUS_FRAME_DURATION_MS } from './gcallVoiceAudioConstants';
import {
  classifyStrongStarvationCandidate,
  computeBufferAdequacy,
  computeMildEntryCandidate,
  stepPlayoutStarvationSeverity,
  strongCStarvationStreakTick,
  type PlayoutStarvationSeverity,
} from './gcallPlayoutStarvation';
import {
  GCALL_JITTER_STARVATION_PROTECTED_EXIT_CONSEC_TICKS,
  GCALL_JITTER_STARVATION_RECOVERY_TRACE_TICKS,
  computeMultiSourceAccumulationTargetFrames,
  isCollapsedForStarvation,
  isNearCollapsedForStarvation,
  shouldEnterProtectedMode,
  shouldExitProtectedMode,
  shouldHoldMultiSourceAccumulation,
  shouldPrioritizeWeakMultiSourceLeg,
  starvationRecoveryBarSatisfied,
} from './gcallJitterDrainPhaseD';
import {
  computeFeasibleMultiSourceRecoveryTargetMaxMs,
  computeFeasibleSingleRemoteRecoveryTargetMaxMs,
} from './gcallPlayoutPolicy';
import { computeStaticPlayoutTargetMsForTuning } from './gcallInboundPlayoutTarget';
import {
  createDmPeerRecoveryState,
  dmMarkPeerStable,
  dmMarkPeerUnstable,
  dmRecomputeAdaptiveNetworkMode,
  type DmPeerRecoveryState,
} from './gcallDmPeerRecovery';

const GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_PCM_MAX_MS = 24;
const GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_DELTA_MAX_MS = -70;
const GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_INGRESS_AGE_MIN_MS = 250;
const GCALL_AUDIO_SURFACE_RECOVERY_MODERATE_PCM_MAX_MS = 36;
const GCALL_AUDIO_SURFACE_RECOVERY_MODERATE_DELTA_MAX_MS = -45;
const GCALL_AUDIO_SURFACE_STABLE_PCM_MIN_MS = 64;
const GCALL_AUDIO_SURFACE_STABLE_STRONG_PCM_MIN_MS = 96;
const GCALL_AUDIO_SURFACE_STABLE_DELTA_MIN_MS = -35;
const GCALL_AUDIO_SURFACE_STABLE_STRONG_DELTA_MIN_MS = -20;
const GCALL_MULTI_SOURCE_TARGET_BOOST_MILD_MS = 20;
const GCALL_MULTI_SOURCE_TARGET_BOOST_STRONG_MS = 40;
const GCALL_MULTI_SOURCE_TARGET_BOOST_PROTECTED_MS = 72;
const GCALL_MULTI_SOURCE_TARGET_BOOST_COLLAPSE_MS = 120;
const GCALL_MULTI_SOURCE_RECOVERY_TARGET_FLOOR_MS = 144;
const GCALL_MULTI_SOURCE_PROTECTED_TARGET_FLOOR_MS = 176;
const GCALL_MULTI_SOURCE_COLLAPSE_TARGET_FLOOR_MS = 224;
const GCALL_MULTI_SOURCE_MAX_EXTRA_HOLD_FRAMES = 8;
const GCALL_MULTI_SOURCE_PROTECTED_MAX_EXTRA_HOLD_FRAMES = 12;
const GCALL_MULTI_SOURCE_COLLAPSE_MAX_EXTRA_HOLD_FRAMES = 14;
const GCALL_MULTI_SOURCE_NEAR_EMPTY_BUFFERED_MS_MAX = 12;
const GCALL_MULTI_SOURCE_DAMAGE_BUFFERED_MS_MAX = 72;
const GCALL_MULTI_SOURCE_DAMAGE_DELTA_MAX_MS = -48;
const GCALL_MULTI_SOURCE_COLLAPSE_DELTA_MAX_MS = -96;
const GCALL_MULTI_SOURCE_DAMAGE_MISSING_EMA_MIN = 0.08;
const GCALL_MULTI_SOURCE_DAMAGE_CONCEALMENT_EMA_MIN = 0.06;
const GCALL_MULTI_SOURCE_DAMAGE_UNDERTARGET_EMA_MIN = 0.04;
const GCALL_MULTI_SOURCE_DAMAGE_RATE_EMA_MAX = 0.998;
const GCALL_MULTI_SOURCE_CLEAN_BUFFERED_MS_MIN = 84;
const GCALL_MULTI_SOURCE_CLEAN_DELTA_MIN_MS = -18;
const GCALL_MULTI_SOURCE_CLEAN_CONCEALMENT_EMA_MAX = 0.03;
const GCALL_MULTI_SOURCE_CLEAN_MISSING_EMA_MAX = 0.04;
const GCALL_MULTI_SOURCE_CLEAN_UNDERTARGET_EMA_MAX = 0.01;
const GCALL_MULTI_SOURCE_CLEAN_RATE_EMA_MIN = 0.999;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_MILD_MS = 34;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_STEADY_ASSIST_MS = 56;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_STRONG_MS = 48;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_SEVERE_MS = 216;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_REPAIR_COLLAPSE_MS = 184;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_REPAIR_HEAVY_MS = 76;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_BUFFERED_NOT_READY_MS = 72;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_PERSISTENT_LEAN_MS = 120;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_SILENT_LEAN_MS = 84;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_POST_FAILOVER_ROOT_MS = 64;
const GCALL_SINGLE_SOURCE_MAX_EXTRA_HOLD_FRAMES = 8;
const GCALL_SINGLE_SOURCE_COLLAPSE_MAX_EXTRA_HOLD_FRAMES = 18;
const GCALL_SINGLE_SOURCE_RECOVERY_TARGET_FLOOR_MS = 172;
const GCALL_SINGLE_SOURCE_SEVERE_RECOVERY_TARGET_FLOOR_MS = 320;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_TARGET_FLOOR_MS = 196;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_FLOOR_MS = 280;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_FLOOR_MS = 176;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_FLOOR_MS = 224;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_FLOOR_MS = 192;
const GCALL_SINGLE_SOURCE_POST_FAILOVER_ROOT_FLOOR_MS = 172;
const GCALL_SINGLE_SOURCE_POST_FAILOVER_ROOT_BUFFERED_MS_MAX = 96;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_HOLD_MS = 2_500;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_BUFFERED_MS_MIN = 84;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_DELTA_MIN_MS = -16;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_RATE_EMA_MIN = 0.998;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_CONCEALMENT_EMA_MAX = 0.02;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_SMOOTH_BUFFERED_MS_MAX = 108;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_SMOOTH_DELTA_MAX_MS = -10;
const GCALL_SINGLE_SOURCE_POST_RECOVERY_SMOOTH_RATE_EMA_MAX = 0.999;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_BUFFERED_MS_MIN = 64;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_DAMAGE_BUFFERED_MS_MIN = 88;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_DAMAGE_DELTA_MIN_MS = -32;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN = 3;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_CONCEALMENT_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX = 0.02;
const GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_RATE_EMA_MIN = 0.992;
const GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN = 4;
const GCALL_SINGLE_SOURCE_PRESSURE_UNDERTARGET_EMA_MIN = 0.08;
const GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS = -35;
const GCALL_SINGLE_SOURCE_PRESSURE_BUFFERED_MS_MAX = 36;
const GCALL_SINGLE_SOURCE_PRESSURE_RELIEF_BUFFERED_MS_MIN = 56;
const GCALL_SINGLE_SOURCE_PRESSURE_LINGERING_PREBUFFER_FRAMES_MAX = 1;
const GCALL_SINGLE_SOURCE_PRESSURE_RATE_EMA_MAX = 0.992;
const GCALL_SINGLE_SOURCE_PRESSURE_RATE_BUFFERED_MS_MAX = 72;
const GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN = 0.02;
const GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_BUFFERED_MS_MAX = 56;
const GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN = 0.08;
const GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_BUFFERED_MS_MAX = 72;
const GCALL_SINGLE_SOURCE_STEADY_MISSING_EMA_MIN = 0.18;
const GCALL_SINGLE_SOURCE_STEADY_DAMAGE_BUFFERED_MS_MAX = 72;
const GCALL_SINGLE_SOURCE_STEADY_DAMAGE_DELTA_MAX_MS = -32;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CONCEALMENT_EMA_MIN = 0.18;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MISSING_EMA_MIN = 0.25;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_UNDERTARGET_EMA_MIN = 0.045;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_UNDERTARGET_BUFFERED_MS_MAX = 36;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX = 0.998;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_BUFFERED_MS_MAX = 96;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_BUFFERED_MS_MAX = 56;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_DELTA_MAX_MS = -70;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_UNDERTARGET_EMA_MIN = 0.08;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_STRONG_UNDERTARGET_EMA_MIN = 0.12;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_RATE_EMA_MAX = 0.996;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_SHALLOW_DAMAGE_BUFFERED_MS_MAX = 36;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_SHALLOW_DAMAGE_RATE_EMA_MAX = 0.9995;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_BUFFERED_MS_MAX = 72;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_UNDERTARGET_EMA_MIN = 0.075;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_RATE_EMA_MAX = 0.999;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_BUFFERED_MS_MAX = 156;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_DELTA_MAX_MS = -48;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_MISSING_EMA_MIN = 0.18;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_UNDERTARGET_EMA_MIN = 0.04;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_RATE_EMA_MAX = 0.998;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HOLD_MS = 11_000;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MAX_EXTRA_HOLD_FRAMES = 10;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_BUFFERED_MS_MIN = 40;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN = 2;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_CONCEALMENT_EMA_MAX = 0.08;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX = 0.08;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_RATE_EMA_MIN = 0.996;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_HOLD_MS = 8_000;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CONCEALMENT_EMA_MIN = 0.2;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_MISSING_EMA_MIN = 0.4;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_LATCH_BUFFERED_MS_MAX = 6;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_BUFFERED_MS_MAX = 20;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_DELTA_MAX_MS = -70;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_BUFFERED_MS_MIN = 52;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_DELTA_MIN_MS = -24;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_CONCEALMENT_EMA_MAX = 0.06;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_BUFFERED_MS_MIN = 32;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_CONCEALMENT_EMA_MAX = 0.18;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_UNDERTARGET_EMA_MAX = 0.1;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_RATE_EMA_MIN = 0.99;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_JITTER_FRAMES_MIN = 12;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_PREBUFFER_FRAMES_MAX = 1;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_PROFILE_AGE_MS = 50;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_MISSING_EMA_MAX = 0.22;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_UNDERTARGET_EMA_MAX = 0.01;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_CONCEALMENT_EMA_MAX = 0.01;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_RATE_EMA_MIN = 0.999;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_MISSING_FRAMES_MIN = 24;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_HOLD_MS = 6_500;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_BUFFERED_MS_MAX = 72;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_DELTA_MAX_MS = -48;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_REPAIR_COLLAPSE_BUFFERED_MS_MAX = 32;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_REPAIR_COLLAPSE_DELTA_MAX_MS = -96;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_BUFFERED_MS_MIN = 84;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_DELTA_MIN_MS = -18;
const GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_CONCEALMENT_EMA_MAX = 0.035;
const GCALL_SINGLE_SOURCE_DAMAGE_HOLD_HEALTHY_ESCAPE_DELTA_MIN_MS = -70;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_MISSING_FRAMES_MIN = 3;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_HOLD_MS = 7_500;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_BUFFERED_MS_MAX = 84;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_DELTA_MAX_MS = -32;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_REPAIR_HEAVY_BUFFERED_MS_MAX = 72;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_REPAIR_HEAVY_UNDERTARGET_EMA_MIN = 0.04;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_REPAIR_HEAVY_MISSING_EMA_MIN = 0.08;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_COLLAPSE_BUFFERED_MS_MAX = 12;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_COLLAPSE_DELTA_MAX_MS = -96;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_NOT_READY_BUFFERED_MS_MAX = 24;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_BUFFERED_MS_MIN = 84;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_DELTA_MIN_MS = -18;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_CONCEALMENT_EMA_MAX = 0.03;
const GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_MISSING_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_BUFFERED_MS_MIN = 136;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_DELTA_MIN_MS = -2;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_RATE_EMA_MIN = 0.9998;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_CONCEALMENT_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_UNDERTARGET_EMA_MAX = 0.01;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_HOLD_MS = 9_000;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_RECOVERY_BUFFERED_MS_MIN = 16;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN = 24;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_NOT_READY_BUFFERED_MS_MAX = 32;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_PREBUFFER_FRAMES_MAX = 1;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_INGRESS_AGE_MIN_MS = 220;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_UNDERTARGET_EMA_MIN = 0.06;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DELTA_MAX_MS = -40;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CONCEALMENT_EMA_MAX = 0.08;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DAMAGED_CONCEALMENT_EMA_MAX = 0.28;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_RATE_EMA_MAX = 0.999;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_PREBUFFER_FRAMES_MIN = 4;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_INGRESS_AGE_MAX_MS = 140;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_UNDERTARGET_EMA_MAX = 0.01;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_DELTA_MIN_MS = -8;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_HOLD_MS = 10_000;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_MAX_EXTRA_HOLD_FRAMES = 12;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_BUFFERED_MS_MAX = 24;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_PREBUFFER_FRAMES_MAX = 2;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_DELTA_MAX_MS = -48;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_INGRESS_AGE_MIN_MS = 220;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CONCEALMENT_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN = 28;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN = 3;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_INGRESS_AGE_MAX_MS = 200;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_HOLD_MS = 10_000;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX = 24;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX = 12;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_PREBUFFER_FRAMES_MAX = 2;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS = -110;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_RATE_EMA_MIN = 0.998;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CONCEALMENT_EMA_MAX = 0.03;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_CONCEALMENT_EMA_MAX = 0.08;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_UNDERTARGET_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_CONCEALMENT_EMA_MIN = 0.035;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_MIN = 0.12;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_HOLD_MIN = 0.08;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_UNDERTARGET_EMA_MIN = 0.02;
const GCALL_SINGLE_SOURCE_NEAR_EMPTY_RECOVERY_UNDERTARGET_EMA_MIN = 0.025;
const GCALL_SINGLE_SOURCE_NEAR_EMPTY_RECOVERY_RATE_EMA_MAX = 0.999;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_BUFFERED_MS_MIN = 40;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN = 4;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS = -16;
const GCALL_SINGLE_SOURCE_SEVERE_BUFFERED_MS_MAX = 12;
const GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS = -80;
const GCALL_SINGLE_SOURCE_SEVERE_INGRESS_AGE_MIN_MS = 900;
const GCALL_SINGLE_SOURCE_SEVERE_LATCH_MS = 14_000;
const GCALL_SINGLE_SOURCE_SEVERE_CLEAR_BUFFERED_MS_MIN = 148;
const GCALL_SINGLE_SOURCE_SEVERE_CLEAR_DELTA_MIN_MS = -4;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_JITTER_FRAMES_MIN = 14;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_PREBUFFER_FRAMES_MAX = 2;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_CONCEALMENT_EMA_MAX = 0.035;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_MISSING_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_RATE_EMA_MIN = 0.996;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_INGRESS_AGE_MAX_MS = 220;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_TARGET_MS = 145;
const GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_MAX_EXTRA_HOLD_FRAMES = 0;
const GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_TARGET_MS = 185;
const GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_MISSING_EMA_MAX = 0.04;
const GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_INGRESS_AGE_MAX_MS = 220;
const GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_RATE_EMA_MIN = 0.97;
const GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_UNDERTARGET_EMA_MAX = 0.4;
const GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_MAX_EXTRA_HOLD_FRAMES = 0;
const GCALL_RECEIVE_PROFILE_TRANSITION_HISTORY_MAX = 120;

interface LiveMultiSourceState {
  sampleCount: number;
  bufferedMsEma: number;
  deltaMsEma: number;
  underTargetEma: number;
  concealmentEma: number;
  missingFrameEma: number;
  pendingMissingFrames: number;
  rateEma: number;
  oldestFrameAgeEma: number;
  lastJitterHasReadyFrame: boolean;
  lastConcealmentUsed: boolean;
  lastOutsideBandUnder: boolean;
  lastRateSample: number;
  targetPlayoutMs: number;
  preProcessBufferedFrames: number;
  lastJitterBufferedFrames: number;
  recentOpusBufferedMs: number[];
  starvationSeverity: PlayoutStarvationSeverity;
  strongCStreak: number;
  protectedMode: boolean;
  protectedExitSatisfiedTicks: number;
  severeSingleSourceHoldUntilMs: number;
  repairCollapseHoldUntilMs: number;
  repairHeavyHoldUntilMs: number;
  damageBurstHoldUntilMs: number;
  recentDamageHoldUntilMs: number;
  bufferedNotReadyHoldUntilMs: number;
  persistentLeanHoldUntilMs: number;
  silentLeanHoldUntilMs: number;
  postRecoveryHoldUntilMs: number;
  currentReceiveProfile: ReceiveProfile;
  lastAppliedTargetMs: number | null;
  lastAppliedFloorMs: number | null;
  lastAppliedTargetBoostMs: number;
  lastAppliedExtraHoldFrames: number;
  lastProfileChangedAtMs: number;
}

type ReceiveProfileTransition = {
  atMs: number;
  peerAddress: string;
  fromProfile: ReceiveProfile;
  toProfile: ReceiveProfile;
  bufferedMsEma: number;
  deltaMsEma: number;
  underTargetEma: number;
  concealmentEma: number;
  missingFrameEma: number;
  rateEma: number;
  preProcessBufferedFrames: number;
  lastJitterBufferedFrames: number;
  lastJitterHasReadyFrame: boolean;
  targetPlayoutMs: number;
};

type SingleSourceReceiveProfile =
  | 'clean-low-latency'
  | 'steady-weak-listener'
  | 'repair-heavy-connected'
  | 'repair-collapse'
  | 'buffered-not-ready'
  | 'persistent-lean'
  | 'silent-lean'
  | 'post-failover-stabilization'
  | 'collapse-recovery';

type MultiSourceReceiveProfile =
  | 'multi-clean-low-latency'
  | 'multi-recovery'
  | 'multi-weak-leg-recovery'
  | 'multi-protected-recovery'
  | 'multi-collapse-recovery';

type ReceiveProfile = SingleSourceReceiveProfile | MultiSourceReceiveProfile;

type SingleSourceProfileContext = {
  currentReady: boolean;
  recoveryModeActive: boolean;
  postFailoverRootProfileActive: boolean;
  severeSingleSourcePressure: boolean;
  severeSingleSourceHold: boolean;
  repairCollapseHold: boolean;
  repairCollapsePressure: boolean;
  repairHeavyHold: boolean;
  repairHeavyPressure: boolean;
  damageBurstHold: boolean;
  damageBurstCollapsePressure: boolean;
  damageBurstRepairPressure: boolean;
  bufferedNotReadyHold: boolean;
  bufferedNotReadyPressure: boolean;
  persistentLeanHold: boolean;
  persistentLeanPressure: boolean;
  silentLeanHold: boolean;
  silentLeanPressure: boolean;
  postRecoveryHold: boolean;
  singleSourcePressure: boolean;
  mildSteadyAssist: boolean;
  steadyHealthyEscape: boolean;
};

function selectSingleSourceReceiveProfile(
  ctx: SingleSourceProfileContext
): SingleSourceReceiveProfile {
  if (
    ctx.severeSingleSourcePressure ||
    (ctx.severeSingleSourceHold && !ctx.bufferedNotReadyPressure)
  ) {
    return 'collapse-recovery';
  }
  if (
    ctx.bufferedNotReadyPressure ||
    (ctx.bufferedNotReadyHold && !ctx.currentReady)
  ) {
    return 'buffered-not-ready';
  }
  if (ctx.repairCollapsePressure) {
    return 'repair-collapse';
  }
  if (ctx.repairCollapseHold) {
    return 'repair-collapse';
  }
  if (ctx.damageBurstCollapsePressure) {
    return 'repair-collapse';
  }
  if (ctx.repairHeavyPressure) {
    return 'repair-heavy-connected';
  }
  if (ctx.damageBurstRepairPressure || ctx.damageBurstHold) {
    return 'repair-heavy-connected';
  }
  if (ctx.silentLeanHold || ctx.silentLeanPressure) {
    return 'silent-lean';
  }
  if (ctx.persistentLeanHold || ctx.persistentLeanPressure) {
    return 'persistent-lean';
  }
  if (ctx.postFailoverRootProfileActive) {
    return 'post-failover-stabilization';
  }
  if (ctx.repairHeavyHold) {
    return 'repair-heavy-connected';
  }
  if (
    !ctx.steadyHealthyEscape &&
    (ctx.recoveryModeActive ||
      ctx.postRecoveryHold ||
      ctx.singleSourcePressure ||
      ctx.mildSteadyAssist)
  ) {
    return 'steady-weak-listener';
  }
  return 'clean-low-latency';
}

function selectMultiSourceReceiveProfile(ctx: {
  recoveryModeActive: boolean;
  prioritizeWeakLeg: boolean;
  protectedMode: boolean;
  starvationSeverity: PlayoutStarvationSeverity;
  sourceRecoveryPressure: boolean;
  sourceCollapsePressure: boolean;
}): MultiSourceReceiveProfile {
  if (!ctx.recoveryModeActive && !ctx.sourceRecoveryPressure) {
    return 'multi-clean-low-latency';
  }
  if (ctx.protectedMode) {
    return 'multi-protected-recovery';
  }
  if (ctx.sourceCollapsePressure || ctx.starvationSeverity === 'strong') {
    return 'multi-collapse-recovery';
  }
  if (ctx.sourceRecoveryPressure) {
    return 'multi-protected-recovery';
  }
  if (ctx.prioritizeWeakLeg || ctx.starvationSeverity === 'mild') {
    return 'multi-weak-leg-recovery';
  }
  return 'multi-recovery';
}

function multiSourceReceiveProfileTargetBoostMs(
  profile: MultiSourceReceiveProfile,
  sourceCollapsePressure: boolean
): number {
  switch (profile) {
    case 'multi-collapse-recovery':
      return GCALL_MULTI_SOURCE_TARGET_BOOST_COLLAPSE_MS;
    case 'multi-protected-recovery':
      return sourceCollapsePressure
        ? GCALL_MULTI_SOURCE_TARGET_BOOST_COLLAPSE_MS
        : GCALL_MULTI_SOURCE_TARGET_BOOST_PROTECTED_MS;
    case 'multi-weak-leg-recovery':
      return sourceCollapsePressure
        ? GCALL_MULTI_SOURCE_TARGET_BOOST_STRONG_MS
        : GCALL_MULTI_SOURCE_TARGET_BOOST_MILD_MS;
    case 'multi-recovery':
      return sourceCollapsePressure
        ? GCALL_MULTI_SOURCE_TARGET_BOOST_STRONG_MS
        : 0;
    case 'multi-clean-low-latency':
      return 0;
  }
}

function multiSourceReceiveProfileFloorMs(
  profile: MultiSourceReceiveProfile,
  sourceCollapsePressure: boolean
): number | null {
  switch (profile) {
    case 'multi-collapse-recovery':
      return GCALL_MULTI_SOURCE_COLLAPSE_TARGET_FLOOR_MS;
    case 'multi-protected-recovery':
      return sourceCollapsePressure
        ? GCALL_MULTI_SOURCE_COLLAPSE_TARGET_FLOOR_MS
        : GCALL_MULTI_SOURCE_PROTECTED_TARGET_FLOOR_MS;
    case 'multi-weak-leg-recovery':
    case 'multi-recovery':
      return sourceCollapsePressure
        ? GCALL_MULTI_SOURCE_COLLAPSE_TARGET_FLOOR_MS
        : GCALL_MULTI_SOURCE_RECOVERY_TARGET_FLOOR_MS;
    case 'multi-clean-low-latency':
      return null;
  }
}

function multiSourceReceiveProfileMaxExtraHoldFrames(
  profile: MultiSourceReceiveProfile
): number {
  switch (profile) {
    case 'multi-collapse-recovery':
      return GCALL_MULTI_SOURCE_COLLAPSE_MAX_EXTRA_HOLD_FRAMES;
    case 'multi-protected-recovery':
      return GCALL_MULTI_SOURCE_PROTECTED_MAX_EXTRA_HOLD_FRAMES;
    case 'multi-weak-leg-recovery':
    case 'multi-recovery':
    case 'multi-clean-low-latency':
      return GCALL_MULTI_SOURCE_MAX_EXTRA_HOLD_FRAMES;
  }
}

function singleSourceReceiveProfileTargetBoostMs(
  profile: SingleSourceReceiveProfile,
  state: LiveMultiSourceState
): number {
  switch (profile) {
    case 'collapse-recovery':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_SEVERE_MS;
    case 'repair-collapse':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_REPAIR_COLLAPSE_MS;
    case 'buffered-not-ready':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_BUFFERED_NOT_READY_MS;
    case 'silent-lean':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_SILENT_LEAN_MS;
    case 'persistent-lean':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_PERSISTENT_LEAN_MS;
    case 'post-failover-stabilization':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_POST_FAILOVER_ROOT_MS;
    case 'repair-heavy-connected':
      return GCALL_SINGLE_SOURCE_TARGET_BOOST_REPAIR_HEAVY_MS;
    case 'steady-weak-listener':
      return (state.protectedMode || state.starvationSeverity === 'strong') &&
        state.bufferedMsEma <=
          GCALL_SINGLE_SOURCE_PRESSURE_RELIEF_BUFFERED_MS_MIN
        ? GCALL_SINGLE_SOURCE_TARGET_BOOST_STRONG_MS
        : state.underTargetEma >=
              GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN ||
            state.concealmentEma >=
              GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN
          ? GCALL_SINGLE_SOURCE_TARGET_BOOST_STEADY_ASSIST_MS
          : GCALL_SINGLE_SOURCE_TARGET_BOOST_MILD_MS;
    case 'clean-low-latency':
      return 0;
  }
}

function singleSourceReceiveProfileFloorMs(
  profile: SingleSourceReceiveProfile
): number | null {
  switch (profile) {
    case 'collapse-recovery':
      return GCALL_SINGLE_SOURCE_SEVERE_RECOVERY_TARGET_FLOOR_MS;
    case 'repair-collapse':
      return GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_FLOOR_MS;
    case 'buffered-not-ready':
      return GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_FLOOR_MS;
    case 'silent-lean':
      return GCALL_SINGLE_SOURCE_SILENT_LEAN_FLOOR_MS;
    case 'persistent-lean':
      return GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_FLOOR_MS;
    case 'post-failover-stabilization':
      return GCALL_SINGLE_SOURCE_POST_FAILOVER_ROOT_FLOOR_MS;
    case 'steady-weak-listener':
      return GCALL_SINGLE_SOURCE_RECOVERY_TARGET_FLOOR_MS;
    case 'repair-heavy-connected':
      return GCALL_SINGLE_SOURCE_REPAIR_HEAVY_TARGET_FLOOR_MS;
    case 'clean-low-latency':
      return null;
  }
}

function disconnectNodeSafe(node: AudioNode | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}

export interface GroupCallAudioReceivePayload {
  roomId: string;
  data: ArrayBuffer;
  transport?: 'link' | 'packet' | 'unknown';
  bridgeReceivedAtWallMs?: number | null;
  fromAddress?: string;
  resolvedFromAddress?: string | null;
}

export interface GroupCallAudioReceiveEngineConfig {
  outputDeviceId: string | null;
  hearCall: boolean;
  profile: GroupCallAudioQualityProfile;
  postFailoverRootHoldUntilMs: number;
}

export class GroupCallAudioReceiveEngine {
  private static readonly METRICS_EMIT_INTERVAL_MS = 1000;
  private metrics = new GroupCallPerformanceTracker();
  private readonly metricsRef = { current: this.metrics };
  private readonly playouts = new Map<string, DmVoiceGcallInboundPlayout>();
  private readonly outputNodeBySource = new Map<string, GainNode>();
  private readonly onMetricsChanged: (
    snapshot: GroupCallMetricsSnapshot
  ) => void;
  private readonly onPlayedSeqAdvanced?: (
    sourceAddr: string,
    playedSeq: number
  ) => void;
  private readonly onDecodedPacketsObserved?: (
    packets: Array<{
      sourceAddr: string;
      seq: number;
      vad: boolean;
      timestampMs: number;
    }>
  ) => void;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private metricsEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private metricsEmitQueued = false;
  private loggedFirstDecodedPacket = false;
  private loggedFirstPlayoutStartBySource = new Set<string>();
  private peerRecoveryState: DmPeerRecoveryState = createDmPeerRecoveryState();
  private liveMultiSourceStateBySource = new Map<
    string,
    LiveMultiSourceState
  >();
  private readonly receiveProfileTransitions: ReceiveProfileTransition[] = [];
  private resumeAudioContextPromise: Promise<void> | null = null;
  private config: GroupCallAudioReceiveEngineConfig = {
    outputDeviceId: null,
    hearCall: true,
    profile: 'low-latency',
    postFailoverRootHoldUntilMs: 0,
  };

  private setReceiveProfile(
    sourceAddr: string,
    state: LiveMultiSourceState,
    profile: ReceiveProfile,
    nowMs: number
  ): void {
    const previousProfile = state.currentReceiveProfile;
    state.currentReceiveProfile = profile;
    if (previousProfile === profile) return;
    state.lastProfileChangedAtMs = nowMs;
    this.receiveProfileTransitions.push({
      atMs: nowMs,
      peerAddress: sourceAddr,
      fromProfile: previousProfile,
      toProfile: profile,
      bufferedMsEma: state.bufferedMsEma,
      deltaMsEma: state.deltaMsEma,
      underTargetEma: state.underTargetEma,
      concealmentEma: state.concealmentEma,
      missingFrameEma: state.missingFrameEma,
      rateEma: state.rateEma,
      preProcessBufferedFrames: state.preProcessBufferedFrames,
      lastJitterBufferedFrames: state.lastJitterBufferedFrames,
      lastJitterHasReadyFrame: state.lastJitterHasReadyFrame,
      targetPlayoutMs: state.targetPlayoutMs,
    });
    if (
      this.receiveProfileTransitions.length >
      GCALL_RECEIVE_PROFILE_TRANSITION_HISTORY_MAX
    ) {
      this.receiveProfileTransitions.splice(
        0,
        this.receiveProfileTransitions.length -
          GCALL_RECEIVE_PROFILE_TRANSITION_HISTORY_MAX
      );
    }
  }

  constructor(
    onMetricsChanged: (snapshot: GroupCallMetricsSnapshot) => void,
    onPlayedSeqAdvanced?: (sourceAddr: string, playedSeq: number) => void,
    onDecodedPacketsObserved?: (
      packets: Array<{
        sourceAddr: string;
        seq: number;
        vad: boolean;
        timestampMs: number;
      }>
    ) => void
  ) {
    this.onMetricsChanged = onMetricsChanged;
    this.onPlayedSeqAdvanced = onPlayedSeqAdvanced;
    this.onDecodedPacketsObserved = onDecodedPacketsObserved;
    this.emitMetricsNow();
  }

  async configure(
    config: Partial<GroupCallAudioReceiveEngineConfig>
  ): Promise<void> {
    this.config = {
      ...this.config,
      ...config,
    };
    if (this.masterGain) {
      this.masterGain.gain.value = this.config.hearCall ? 1 : 0;
    }
    if (this.audioContext) {
      await applyCallAudioOutput(this.config.outputDeviceId, {
        audioContext: this.audioContext,
      });
    }
  }

  getSnapshot(): GroupCallMetricsSnapshot {
    return this.metrics.getSnapshot();
  }

  recordSenderPreEncodePipeline(sample: {
    workletToMainThreadMs: number;
    mainThreadToEncoderOutputMs: number;
    workletToEncoderOutputMs: number;
  }): void {
    this.metrics.recordGcallSenderPreEncodePipeline(sample);
    this.scheduleMetricsEmit();
  }

  recordSenderEncoderToPacketTimestampGap(gapMs: number): void {
    this.metrics.recordGcallSenderEncoderToPacketTimestampGap(gapMs);
    this.scheduleMetricsEmit();
  }

  recordReticulumAudioOutboundTransport(transport: 'link' | 'packet'): void {
    this.metrics.recordReticulumAudioOutboundTransport(transport);
    this.scheduleMetricsEmit();
  }

  recordReticulumAudioInboundTransport(transport: 'link' | 'packet'): void {
    this.metrics.recordReticulumAudioInboundTransport(transport);
    this.scheduleMetricsEmit();
  }

  setReticulumAudioQueueDepths(depths: {
    pendingFrames?: number;
    pendingOldestAgeMs?: number;
    bridgeQueuedFrames?: number;
    bridgeQueuedOldestAgeMs?: number;
    bridgeWaitingForDrain?: boolean;
    decodedQueueDepth?: number;
    decodedQueueOldestAgeMs?: number;
    binaryOutQueueDepth?: number;
    binaryOutQueueOldestAgeMs?: number;
    queuePressureDropsLast5s?: number;
    staleDropsLast5s?: number;
    packetPathRequests?: number;
    packetPathResolutions?: number;
    packetPathTimeouts?: number;
    packetFreshSends?: number;
    packetStaleSends?: number;
    packetUnknownSends?: number;
    deadlineDropCount?: number;
    decodedQueueEvictOldestCount?: number;
    decodedQueueDropNewestCount?: number;
    fd3DecodedAgeMsMax?: number;
    decodedQueueDwellMsMax?: number;
    rnsSendDurationMsMax?: number;
    packetPathCheckMsMax?: number;
    executorLoopGapMsMax?: number;
    executorGapWhileQueuedMsMax?: number;
    executorAudioPassMsMax?: number;
    processBatchMsMax?: number;
    processBatchFramesMax?: number;
    rnsSendSlowCount?: number;
    executorStallCount?: number;
    executorCommandMsMax?: number;
    executorCommandWhileQueuedMsMax?: number;
    executorCommandSlowCount?: number;
  }): void {
    this.metrics.setReticulumAudioQueueDepths(depths);
    this.scheduleMetricsEmit();
  }

  getDiagnosticsSnapshot(): {
    audioContextState: string | null;
    hasMasterGain: boolean;
    hearCall: boolean;
    outputDeviceId: string | null;
    profile: GroupCallAudioQualityProfile;
    playoutCount: number;
    outputNodeCount: number;
    sourceAddrs: string[];
    livePolicyProfilesBySource: Array<{
      peerAddress: string;
      profile: ReceiveProfile;
    }>;
    livePolicyStateBySource: Array<{
      peerAddress: string;
      profile: ReceiveProfile;
      profileAgeMs: number | null;
      bufferedMsEma: number;
      deltaMsEma: number;
      underTargetEma: number;
      concealmentEma: number;
      missingFrameEma: number;
      rateEma: number;
      oldestFrameAgeEma: number;
      preProcessBufferedFrames: number;
      lastJitterBufferedFrames: number;
      lastJitterHasReadyFrame: boolean;
      targetPlayoutMs: number;
      lastAppliedTargetMs: number | null;
      lastAppliedFloorMs: number | null;
      lastAppliedTargetBoostMs: number;
      lastAppliedExtraHoldFrames: number;
      holdsRemainingMs: {
        severeSingleSource: number;
        repairCollapse: number;
        repairHeavy: number;
        recentDamage: number;
        bufferedNotReady: number;
        persistentLean: number;
        silentLean: number;
        postRecovery: number;
      };
    }>;
    profileTransitions: ReceiveProfileTransition[];
    playouts: Array<{
      peerAddress: string;
      decodePath: 'wasm-fec' | 'webcodecs' | 'uninitialized';
      wasmFecActive: boolean;
      hasOpusFecWorker: boolean;
      hasWebCodecsDecoder: boolean;
      decoderState: string | null;
      hasSharedPcmRing: boolean;
      sharedRingEnabled: boolean;
      jitterActive: boolean;
      jitterBufferedFrames: number;
      jitterHasReadyFrame: boolean;
      jitterMaxEntries: number;
      jitterPushAccepted: number;
      jitterPushStale: number;
      jitterPushDuplicate: number;
      jitterPushTrimmedFrames: number;
      jitterPushTrimEvents: number;
      jitterPushDepthHighWater: number;
      jitterLastTrimmedFrames: number;
      jitterLastTrimAtMs: number;
      jitterBurstHeadroomLevel: number;
      jitterBurstHeadroomHoldUntilMs: number;
      jitterBurstHeadroomReason: string | null;
      postBurstLatencyLockoutActive?: boolean;
      postBurstLatencyLockoutUntilMs?: number;
      postBurstLatencyShedFrames?: number;
      lastPostBurstLatencyShedAtMs?: number;
      lastPostBurstLatencyShedFrames?: number;
      burstGapResetCount?: number;
      burstGapRecoveryCount?: number;
      burstGapDroppedFrames?: number;
      lastBurstGapMs?: number;
      lastBurstGapFrames?: number;
      lastBurstGapDroppedFrames?: number;
      lastBurstGapResetAtMs?: number;
      starvedBacklogDrainCount?: number;
      starvedBacklogDrainFrames?: number;
      lastStarvedBacklogDrainAtMs?: number;
      lastStarvedBacklogDrainFrames?: number;
      jitterDrainReadyTicks?: number;
      jitterDrainReadyNoPopTicks?: number;
      jitterDrainPoppedFrames?: number;
      lastJitterDrainBudget?: number;
      lastJitterDrainPoppedFrames?: number;
      pcmPostAcceptedFrames?: number;
      pcmPostRejectedFrames?: number;
      pcmPostOverrunCount?: number;
      lastPcmPostRejectedAtMs?: number;
      audioGapAttributionCount?: number;
      audioGapAttributionMaxFrames?: number;
      audioGapAttributionLast?: GcallAudioGapAttributionRecord | null;
      audioGapAttributionRecent?: GcallAudioGapAttributionRecord[];
      wasmFecPipelineDiagnostics?: {
        queuedDecodeJobs: number;
        queuedDecodeJobsHighWater: number;
        inflightDecode: boolean;
        inflightDecodeAgeMs: number;
        deferredPcmSlabs: number;
        deferredPcmFrames: number;
        deferredPcmFramesHighWater: number;
        enqueuedDecodeJobs: number;
        completedDecodeJobs: number;
        postedPcmFrames: number;
        rejectedPcmFrames: number;
        deferredPcmTicks: number;
        lastRejectedPcmAtMs: number;
        lastDeferredPcmAtMs: number;
      } | null;
      playbackNodeActive: boolean;
      schedulerNodeActive: boolean;
      lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null;
    }>;
  } {
    const playouts = [...this.playouts.values()].map((playout) =>
      playout.getDiagnosticsSnapshot()
    );
    const livePolicyProfilesBySource = [...this.playouts.keys()].map(
      (sourceAddr) => ({
        peerAddress: sourceAddr,
        profile:
          this.liveMultiSourceStateBySource.get(sourceAddr)
            ?.currentReceiveProfile ?? 'clean-low-latency',
      })
    );
    const nowMs = Date.now();
    const livePolicyStateBySource = [...this.playouts.keys()].map(
      (sourceAddr) => {
        const state = this.liveMultiSourceStateBySource.get(sourceAddr);
        return {
          peerAddress: sourceAddr,
          profile: state?.currentReceiveProfile ?? 'clean-low-latency',
          profileAgeMs:
            state && state.lastProfileChangedAtMs > 0
              ? Math.max(0, nowMs - state.lastProfileChangedAtMs)
              : null,
          bufferedMsEma: state?.bufferedMsEma ?? 0,
          deltaMsEma: state?.deltaMsEma ?? 0,
          underTargetEma: state?.underTargetEma ?? 0,
          concealmentEma: state?.concealmentEma ?? 0,
          missingFrameEma: state?.missingFrameEma ?? 0,
          rateEma: state?.rateEma ?? 1,
          oldestFrameAgeEma: state?.oldestFrameAgeEma ?? 0,
          preProcessBufferedFrames: state?.preProcessBufferedFrames ?? 0,
          lastJitterBufferedFrames: state?.lastJitterBufferedFrames ?? 0,
          lastJitterHasReadyFrame: state?.lastJitterHasReadyFrame ?? false,
          targetPlayoutMs: state?.targetPlayoutMs ?? 0,
          lastAppliedTargetMs: state?.lastAppliedTargetMs ?? null,
          lastAppliedFloorMs: state?.lastAppliedFloorMs ?? null,
          lastAppliedTargetBoostMs: state?.lastAppliedTargetBoostMs ?? 0,
          lastAppliedExtraHoldFrames: state?.lastAppliedExtraHoldFrames ?? 0,
          holdsRemainingMs: {
            severeSingleSource: Math.max(
              0,
              (state?.severeSingleSourceHoldUntilMs ?? 0) - nowMs
            ),
            repairCollapse: Math.max(
              0,
              (state?.repairCollapseHoldUntilMs ?? 0) - nowMs
            ),
            repairHeavy: Math.max(
              0,
              (state?.repairHeavyHoldUntilMs ?? 0) - nowMs
            ),
            recentDamage: Math.max(
              0,
              (state?.recentDamageHoldUntilMs ?? 0) - nowMs
            ),
            bufferedNotReady: Math.max(
              0,
              (state?.bufferedNotReadyHoldUntilMs ?? 0) - nowMs
            ),
            persistentLean: Math.max(
              0,
              (state?.persistentLeanHoldUntilMs ?? 0) - nowMs
            ),
            silentLean: Math.max(
              0,
              (state?.silentLeanHoldUntilMs ?? 0) - nowMs
            ),
            postRecovery: Math.max(
              0,
              (state?.postRecoveryHoldUntilMs ?? 0) - nowMs
            ),
          },
        };
      }
    );
    return {
      audioContextState: this.audioContext?.state ?? null,
      hasMasterGain: this.masterGain !== null,
      hearCall: this.config.hearCall,
      outputDeviceId: this.config.outputDeviceId,
      profile: this.config.profile,
      playoutCount: this.playouts.size,
      outputNodeCount: this.outputNodeBySource.size,
      sourceAddrs: [...this.playouts.keys()],
      livePolicyProfilesBySource,
      livePolicyStateBySource,
      profileTransitions: [...this.receiveProfileTransitions],
      playouts,
    };
  }

  noteIncomingAudio(bridgeReceivedAtWallMs?: number | null): void {
    this.metrics.recordPacketReceived();
    if (
      typeof bridgeReceivedAtWallMs === 'number' &&
      Number.isFinite(bridgeReceivedAtWallMs) &&
      bridgeReceivedAtWallMs > 0
    ) {
      this.metrics.recordReticulumAudioBridgeToRendererIngressLatency(
        Math.max(0, Date.now() - bridgeReceivedAtWallMs)
      );
    }
    this.scheduleMetricsEmit();
  }

  recordDecodeFailure(): void {
    this.metrics.recordPacketDroppedWithReason('decode-failure');
    this.scheduleMetricsEmit();
  }

  async handleDecodedPackets(
    packets: Array<{
      sourceAddr: string;
      seq: number;
      opusFrame: Uint8Array | ArrayBuffer;
      vad: boolean;
      timestampMs: number;
    }>
  ): Promise<void> {
    if (packets.length === 0) {
      this.recordDecodeFailure();
      traceGcallAudioSurface(
        'pipeline: decodeAudioPackets returned 0 packets',
        {}
      );
      return;
    }
    if (!this.loggedFirstDecodedPacket) {
      this.loggedFirstDecodedPacket = true;
      const first = packets[0];
      traceGcallAudioSurface('pipeline: first decoded audio packet', {
        sourceAddr: first?.sourceAddr ?? '',
        decodedCount: packets.length,
        seq: first?.seq ?? null,
      });
    }
    this.metrics.recordPacketDecoded(packets.length);
    this.onDecodedPacketsObserved?.(
      packets.map((packet) => ({
        sourceAddr: packet.sourceAddr,
        seq: packet.seq,
        vad: packet.vad,
        timestampMs: packet.timestampMs,
      }))
    );
    const grouped = new Map<string, DecodedAudioPacket[]>();
    for (const packet of packets) {
      const normalized: DecodedAudioPacket = {
        sourceAddr: packet.sourceAddr,
        seq: packet.seq,
        vad: packet.vad,
        timestampMs: packet.timestampMs,
        opusFrame:
          packet.opusFrame instanceof Uint8Array
            ? packet.opusFrame
            : new Uint8Array(packet.opusFrame),
      };
      const existing = grouped.get(packet.sourceAddr);
      if (existing) existing.push(normalized);
      else grouped.set(packet.sourceAddr, [normalized]);
    }
    for (const [sourceAddr, list] of grouped) {
      const playout = await this.getOrCreatePlayout(sourceAddr);
      playout.pushDecoded(list);
    }
    this.scheduleMetricsEmit();
  }

  async handleIncomingAudio(
    payload: GroupCallAudioReceivePayload,
    roomKey: Uint8Array | null
  ): Promise<number> {
    if (!roomKey) {
      const data = payload.data;
      const n =
        data instanceof ArrayBuffer
          ? data.byteLength
          : ArrayBuffer.isView(data)
            ? data.byteLength
            : 0;
      tracePipelineReceiveDroppedNoRoomKey({
        roomId: payload.roomId,
        from: payload.fromAddress ?? payload.resolvedFromAddress,
        dataBytes: n,
      });
      return 0;
    }
    const startedAt = performance.now();
    this.noteIncomingAudio(payload.bridgeReceivedAtWallMs);
    const packets = decodeAudioPackets(new Uint8Array(payload.data), roomKey);
    await this.handleDecodedPackets(packets);
    this.metrics.recordIncomingPacketDuration(performance.now() - startedAt);
    this.scheduleMetricsEmit();
    return packets.length;
  }

  async reset(): Promise<void> {
    for (const playout of this.playouts.values()) {
      await playout.stop();
    }
    for (const output of this.outputNodeBySource.values()) {
      disconnectNodeSafe(output);
    }
    this.playouts.clear();
    this.outputNodeBySource.clear();
    this.loggedFirstDecodedPacket = false;
    this.loggedFirstPlayoutStartBySource.clear();
    this.peerRecoveryState = createDmPeerRecoveryState();
    this.liveMultiSourceStateBySource.clear();
    this.receiveProfileTransitions.splice(
      0,
      this.receiveProfileTransitions.length
    );
    this.resumeAudioContextPromise = null;
    this.clearMetricsEmitTimer();
    this.metrics = new GroupCallPerformanceTracker();
    this.metricsRef.current = this.metrics;
    this.updateResourceCounts();
    this.emitMetricsNow();
  }

  async removeSource(sourceAddr: string): Promise<void> {
    const normalized = sourceAddr.trim();
    if (!normalized) return;
    const playout = this.playouts.get(normalized);
    const output = this.outputNodeBySource.get(normalized) ?? null;
    this.playouts.delete(normalized);
    this.outputNodeBySource.delete(normalized);
    this.loggedFirstPlayoutStartBySource.delete(normalized);
    this.liveMultiSourceStateBySource.delete(normalized);
    if (playout) {
      await playout.stop();
    }
    disconnectNodeSafe(output);
    this.updateResourceCounts();
    this.syncAllPlayoutAdaptiveGeometry();
    this.syncLiveMultiSourceControls();
    this.emitMetricsNow();
  }

  hasSource(sourceAddr: string): boolean {
    const normalized = sourceAddr.trim();
    return normalized ? this.playouts.has(normalized) : false;
  }

  async dispose(): Promise<void> {
    await this.reset();
    const audioContext = this.audioContext;
    const masterGain = this.masterGain;
    this.audioContext = null;
    this.masterGain = null;
    disconnectNodeSafe(masterGain);
    if (audioContext) {
      await audioContext.close().catch(() => {});
    }
    this.clearMetricsEmitTimer();
  }

  private recomputeAdaptiveNetworkMode(nowMs = Date.now()): void {
    dmRecomputeAdaptiveNetworkMode(
      this.peerRecoveryState,
      (mode) => this.metrics.setAdaptiveNetworkMode(mode),
      nowMs
    );
  }

  private syncAllPlayoutAdaptiveGeometry(): void {
    for (const playout of this.playouts.values()) {
      playout.syncAdaptiveJitterGeometry();
    }
  }

  private async ensureAudioContextRunning(): Promise<void> {
    const ctx = this.audioContext;
    if (!ctx || ctx.state === 'running') return;
    if (this.resumeAudioContextPromise) {
      await this.resumeAudioContextPromise;
      return;
    }
    this.resumeAudioContextPromise = (async () => {
      try {
        if (ctx.state !== 'running') {
          await ctx.resume();
        }
      } catch {
        /* ignore */
      } finally {
        this.resumeAudioContextPromise = null;
      }
    })();
    await this.resumeAudioContextPromise;
  }

  private getOrCreateLiveMultiSourceState(
    sourceAddr: string,
    targetPlayoutMs: number
  ): LiveMultiSourceState {
    let state = this.liveMultiSourceStateBySource.get(sourceAddr);
    if (!state) {
      state = {
        sampleCount: 0,
        bufferedMsEma: Math.max(0, targetPlayoutMs),
        deltaMsEma: 0,
        underTargetEma: 0,
        concealmentEma: 0,
        missingFrameEma: 0,
        pendingMissingFrames: 0,
        rateEma: 1,
        oldestFrameAgeEma: 0,
        lastJitterHasReadyFrame: false,
        lastConcealmentUsed: false,
        lastOutsideBandUnder: false,
        lastRateSample: 1,
        targetPlayoutMs: Math.max(40, targetPlayoutMs),
        preProcessBufferedFrames: 0,
        lastJitterBufferedFrames: 0,
        recentOpusBufferedMs: [],
        starvationSeverity: 'none',
        strongCStreak: 0,
        protectedMode: false,
        protectedExitSatisfiedTicks: 0,
        severeSingleSourceHoldUntilMs: 0,
        repairCollapseHoldUntilMs: 0,
        repairHeavyHoldUntilMs: 0,
        damageBurstHoldUntilMs: 0,
        recentDamageHoldUntilMs: 0,
        bufferedNotReadyHoldUntilMs: 0,
        persistentLeanHoldUntilMs: 0,
        silentLeanHoldUntilMs: 0,
        postRecoveryHoldUntilMs: 0,
        currentReceiveProfile: 'clean-low-latency',
        lastAppliedTargetMs: null,
        lastAppliedFloorMs: null,
        lastAppliedTargetBoostMs: 0,
        lastAppliedExtraHoldFrames: 0,
        lastProfileChangedAtMs: Date.now(),
      };
      this.liveMultiSourceStateBySource.set(sourceAddr, state);
    }
    return state;
  }

  private updateLiveMultiSourceState(
    sourceAddr: string,
    message: DmVoiceGcallPlayoutWorkletMessage
  ): void {
    const nowMs = Date.now();
    const staticTargetMs = computeStaticPlayoutTargetMsForTuning(
      getGroupCallAudioTuning(this.config.profile)
    );
    const targetPlayoutMs =
      typeof message.targetPlayoutMs === 'number' &&
      Number.isFinite(message.targetPlayoutMs)
        ? Math.max(40, message.targetPlayoutMs)
        : staticTargetMs;
    const bufferedMs =
      typeof message.bufferedMs === 'number' &&
      Number.isFinite(message.bufferedMs)
        ? Math.max(0, message.bufferedMs)
        : 0;
    const deltaMs =
      typeof message.deltaMs === 'number' && Number.isFinite(message.deltaMs)
        ? message.deltaMs
        : bufferedMs - targetPlayoutMs;
    const preProcessBufferedFrames =
      typeof message.preProcessBufferedMs === 'number' &&
      Number.isFinite(message.preProcessBufferedMs)
        ? Math.max(
            0,
            Math.round(message.preProcessBufferedMs / OPUS_FRAME_DURATION_MS)
          )
        : 0;
    const oldestFrameAgeMs =
      typeof message.oldestFrameAgeMs === 'number' &&
      Number.isFinite(message.oldestFrameAgeMs)
        ? Math.max(0, message.oldestFrameAgeMs)
        : 0;
    const state = this.getOrCreateLiveMultiSourceState(
      sourceAddr,
      targetPlayoutMs
    );
    const alpha = state.sampleCount === 0 ? 1 : 0.2;
    state.sampleCount += 1;
    state.targetPlayoutMs = targetPlayoutMs;
    state.preProcessBufferedFrames = preProcessBufferedFrames;
    state.recentOpusBufferedMs.push(bufferedMs);
    if (
      state.recentOpusBufferedMs.length >
      GCALL_JITTER_STARVATION_RECOVERY_TRACE_TICKS
    ) {
      state.recentOpusBufferedMs.splice(
        0,
        state.recentOpusBufferedMs.length -
          GCALL_JITTER_STARVATION_RECOVERY_TRACE_TICKS
      );
    }
    state.bufferedMsEma =
      state.sampleCount === 1
        ? bufferedMs
        : state.bufferedMsEma * (1 - alpha) + bufferedMs * alpha;
    state.deltaMsEma =
      state.sampleCount === 1
        ? deltaMs
        : state.deltaMsEma * (1 - alpha) + deltaMs * alpha;
    const underTargetSample =
      message.outsideBandUnder || message.concealmentUsed ? 1 : 0;
    state.lastOutsideBandUnder = !!message.outsideBandUnder;
    state.underTargetEma =
      state.sampleCount === 1
        ? underTargetSample
        : state.underTargetEma * (1 - alpha) + underTargetSample * alpha;
    const concealmentSample = message.concealmentUsed ? 1 : 0;
    state.concealmentEma =
      state.sampleCount === 1
        ? concealmentSample
        : state.concealmentEma * (1 - alpha) + concealmentSample * alpha;
    state.lastConcealmentUsed = !!message.concealmentUsed;
    const missingFramesThisTick = state.pendingMissingFrames;
    const missingFrameSample = missingFramesThisTick > 0 ? 1 : 0;
    state.pendingMissingFrames = 0;
    state.missingFrameEma =
      state.sampleCount === 1
        ? missingFrameSample
        : state.missingFrameEma * (1 - alpha) + missingFrameSample * alpha;
    const rateSample =
      typeof message.rate === 'number' && Number.isFinite(message.rate)
        ? Math.max(0.9, Math.min(1.1, message.rate))
        : 1;
    state.lastRateSample = rateSample;
    state.rateEma =
      state.sampleCount === 1
        ? rateSample
        : state.rateEma * (1 - alpha) + rateSample * alpha;
    state.oldestFrameAgeEma =
      state.sampleCount === 1
        ? oldestFrameAgeMs
        : state.oldestFrameAgeEma * (1 - alpha) + oldestFrameAgeMs * alpha;

    const bufferAdequacy = computeBufferAdequacy({
      avgPcmBufferedMs: state.bufferedMsEma,
      smoothedTargetMs: targetPlayoutMs,
    });
    state.strongCStreak = strongCStarvationStreakTick(state.strongCStreak, {
      playoutUnderTargetFraction: state.underTargetEma,
      avgPlayoutDeltaMs: state.deltaMsEma,
    });
    const strongMeta = classifyStrongStarvationCandidate(
      {
        playoutUnderTargetFraction: state.underTargetEma,
        avgPlayoutDeltaMs: state.deltaMsEma,
      },
      bufferAdequacy,
      state.strongCStreak
    );
    const mildCandidate = computeMildEntryCandidate(
      bufferAdequacy,
      strongMeta.strong
    );
    state.starvationSeverity = stepPlayoutStarvationSeverity({
      held: state.starvationSeverity,
      bufferAdequacy,
      strongMeta,
      mildCandidate,
    }).next;
    const collapsedForStarvation = isCollapsedForStarvation({
      bufferedFrames: preProcessBufferedFrames,
      opusBufferedMs: state.bufferedMsEma,
      adaptiveTargetMedianMs: targetPlayoutMs,
    });
    const nearCollapsedForStarvation = isNearCollapsedForStarvation({
      bufferedFrames: preProcessBufferedFrames,
      opusBufferedMs: state.bufferedMsEma,
      adaptiveTargetMedianMs: targetPlayoutMs,
    });
    const shouldEnterProtected = shouldEnterProtectedMode({
      collapsed: collapsedForStarvation,
      nearCollapsed: nearCollapsedForStarvation,
      starvationSeverity: state.starvationSeverity,
    });
    if (shouldEnterProtected) {
      state.protectedMode = true;
      state.protectedExitSatisfiedTicks = 0;
    } else if (state.protectedMode) {
      const troughBufferedMs = Math.min(...state.recentOpusBufferedMs);
      const recoveryBarSatisfied = starvationRecoveryBarSatisfied({
        bufferedFrames: preProcessBufferedFrames,
        opusBufferedMs: state.bufferedMsEma,
        minOpusLastMTicks: Number.isFinite(troughBufferedMs)
          ? troughBufferedMs
          : state.bufferedMsEma,
        adaptiveTargetMedianMs: targetPlayoutMs,
        playoutStarvationSeverity: state.starvationSeverity,
      });
      if (
        shouldExitProtectedMode({
          bufferedFrames: preProcessBufferedFrames,
          opusBufferedMs: state.bufferedMsEma,
          adaptiveTargetMedianMs: targetPlayoutMs,
          recoveryBarSatisfied,
          playoutStarvationSeverity: state.starvationSeverity,
        })
      ) {
        state.protectedExitSatisfiedTicks += 1;
        if (
          state.protectedExitSatisfiedTicks >=
          GCALL_JITTER_STARVATION_PROTECTED_EXIT_CONSEC_TICKS
        ) {
          state.protectedMode = false;
          state.protectedExitSatisfiedTicks = 0;
        }
      } else {
        state.protectedExitSatisfiedTicks = 0;
      }
    } else {
      state.protectedExitSatisfiedTicks = 0;
    }

    const severeSingleSourcePressure =
      (!!message.outsideBandUnder || !!message.concealmentUsed) &&
      bufferedMs <= GCALL_SINGLE_SOURCE_SEVERE_BUFFERED_MS_MAX &&
      deltaMs <= GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS &&
      (oldestFrameAgeMs >= GCALL_SINGLE_SOURCE_SEVERE_INGRESS_AGE_MIN_MS ||
        preProcessBufferedFrames <= 0);
    if (severeSingleSourcePressure) {
      state.severeSingleSourceHoldUntilMs = Math.max(
        state.severeSingleSourceHoldUntilMs,
        nowMs + GCALL_SINGLE_SOURCE_SEVERE_LATCH_MS
      );
    } else if (
      state.severeSingleSourceHoldUntilMs > 0 &&
      !message.outsideBandUnder &&
      !message.concealmentUsed &&
      bufferedMs >= GCALL_SINGLE_SOURCE_SEVERE_CLEAR_BUFFERED_MS_MIN &&
      deltaMs >= GCALL_SINGLE_SOURCE_SEVERE_CLEAR_DELTA_MIN_MS
    ) {
      state.severeSingleSourceHoldUntilMs = 0;
    }
    if (
      message.concealmentUsed &&
      bufferedMs <= GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_LATCH_BUFFERED_MS_MAX &&
      deltaMs <= GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_DELTA_MAX_MS
    ) {
      state.repairCollapseHoldUntilMs = Math.max(
        state.repairCollapseHoldUntilMs,
        nowMs + GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_HOLD_MS
      );
    }
    if (
      missingFramesThisTick >=
        GCALL_SINGLE_SOURCE_DAMAGE_BURST_MISSING_FRAMES_MIN &&
      bufferedMs <= GCALL_SINGLE_SOURCE_DAMAGE_BURST_BUFFERED_MS_MAX &&
      deltaMs <= GCALL_SINGLE_SOURCE_DAMAGE_BURST_DELTA_MAX_MS
    ) {
      state.damageBurstHoldUntilMs = Math.max(
        state.damageBurstHoldUntilMs,
        nowMs + GCALL_SINGLE_SOURCE_DAMAGE_BURST_HOLD_MS
      );
    } else if (
      state.damageBurstHoldUntilMs > 0 &&
      !message.concealmentUsed &&
      missingFramesThisTick === 0 &&
      bufferedMs >= GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_BUFFERED_MS_MIN &&
      deltaMs >= GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_DELTA_MIN_MS &&
      state.concealmentEma <=
        GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_CONCEALMENT_EMA_MAX
    ) {
      state.damageBurstHoldUntilMs = 0;
    }
    if (
      (missingFramesThisTick >=
        GCALL_SINGLE_SOURCE_RECENT_DAMAGE_MISSING_FRAMES_MIN &&
        bufferedMs <= GCALL_SINGLE_SOURCE_RECENT_DAMAGE_BUFFERED_MS_MAX &&
        deltaMs <= GCALL_SINGLE_SOURCE_RECENT_DAMAGE_DELTA_MAX_MS) ||
      (message.concealmentUsed &&
        bufferedMs <=
          GCALL_SINGLE_SOURCE_RECENT_DAMAGE_NOT_READY_BUFFERED_MS_MAX &&
        deltaMs <= GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS)
    ) {
      state.recentDamageHoldUntilMs = Math.max(
        state.recentDamageHoldUntilMs,
        nowMs + GCALL_SINGLE_SOURCE_RECENT_DAMAGE_HOLD_MS
      );
    } else if (
      state.recentDamageHoldUntilMs > 0 &&
      !message.concealmentUsed &&
      missingFramesThisTick === 0 &&
      bufferedMs >= GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_BUFFERED_MS_MIN &&
      deltaMs >= GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_DELTA_MIN_MS &&
      state.concealmentEma <=
        GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_CONCEALMENT_EMA_MAX &&
      state.missingFrameEma <=
        GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_MISSING_EMA_MAX
    ) {
      state.recentDamageHoldUntilMs = 0;
    }
  }

  private syncLiveMultiSourceControls(): void {
    const activeSourceCount = this.playouts.size;
    const mode = this.metrics.getSnapshot().adaptiveNetworkMode;
    const nowMs = Date.now();
    const staticTargetMs = computeStaticPlayoutTargetMsForTuning(
      getGroupCallAudioTuning(this.config.profile)
    );
    const weakLegPresent =
      activeSourceCount >= 2 &&
      [...this.liveMultiSourceStateBySource.values()].some(
        (state) => state.protectedMode || state.starvationSeverity !== 'none'
      );

    for (const [sourceAddr, playout] of this.playouts) {
      const state = this.liveMultiSourceStateBySource.get(sourceAddr);
      if (!state) {
        playout.setForcedAdaptiveJitterMode(null);
        playout.setBurstRecoveryExtraHoldFrames(0);
        playout.resetDynamicTargetPlayoutMs();
        continue;
      }
      const playoutDiagnostics = playout.getDiagnosticsSnapshot();
      state.lastJitterHasReadyFrame = playoutDiagnostics.jitterHasReadyFrame;
      state.lastJitterBufferedFrames = Math.max(
        0,
        playoutDiagnostics.jitterBufferedFrames
      );

      if (activeSourceCount < 2) {
        playout.setForcedAdaptiveJitterMode(null);
        const latestBufferedMs =
          state.recentOpusBufferedMs.at(-1) ?? state.bufferedMsEma;
        const postFailoverRootProfileActive =
          this.config.postFailoverRootHoldUntilMs > nowMs &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_POST_FAILOVER_ROOT_BUFFERED_MS_MAX;
        const severeSingleSourceHold =
          state.severeSingleSourceHoldUntilMs > nowMs;
        const readyBufferedUsableReserve =
          state.lastJitterHasReadyFrame &&
          (latestBufferedMs >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN ||
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN ||
            state.preProcessBufferedFrames >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN);
        const readyBufferedLowDamageEscape =
          readyBufferedUsableReserve &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          !state.lastConcealmentUsed &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CONCEALMENT_EMA_MAX &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_RATE_EMA_MIN;
        const readyBufferedModerateDamageCollapseEscape =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          (latestBufferedMs >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN ||
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN ||
            state.preProcessBufferedFrames >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN) &&
          state.concealmentEma <
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CONCEALMENT_EMA_MIN &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX &&
          state.rateEma >= 0.99;
        const severeSingleSourceHoldEscaped =
          severeSingleSourceHold &&
          ((readyBufferedUsableReserve &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CONCEALMENT_EMA_MAX) ||
            readyBufferedLowDamageEscape ||
            readyBufferedModerateDamageCollapseEscape);
        const effectiveSevereSingleSourceHold =
          severeSingleSourceHold && !severeSingleSourceHoldEscaped;
        const severeSingleSourcePressure =
          !readyBufferedLowDamageEscape &&
          !readyBufferedModerateDamageCollapseEscape &&
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_SEVERE_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS &&
          (state.underTargetEma >= 0.5 || state.concealmentEma >= 0.2) &&
          (state.oldestFrameAgeEma >=
            GCALL_SINGLE_SOURCE_SEVERE_INGRESS_AGE_MIN_MS ||
            state.preProcessBufferedFrames <= 0);
        const recoveryModeActive = mode === 'recovery';
        const readyNearEmptyDamageCollapsePressure =
          state.lastJitterHasReadyFrame &&
          !readyBufferedModerateDamageCollapseEscape &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS &&
          (state.concealmentEma >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_CONCEALMENT_EMA_MIN ||
            state.missingFrameEma >=
              GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_MIN ||
            (state.currentReceiveProfile === 'repair-collapse' &&
              state.missingFrameEma >=
                GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_HOLD_MIN) ||
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_UNDERTARGET_EMA_MIN);
        const readyShallowMissingFrameCollapsePressure =
          state.lastJitterHasReadyFrame &&
          !readyBufferedModerateDamageCollapseEscape &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_BUFFERED_MS_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS &&
          (state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_MIN ||
            (state.currentReceiveProfile === 'repair-collapse' &&
              state.missingFrameEma >=
                GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_HOLD_MIN));
        const readyNearEmptyRecoveryCollapsePressure =
          state.lastJitterHasReadyFrame &&
          recoveryModeActive &&
          !readyBufferedModerateDamageCollapseEscape &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS &&
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_NEAR_EMPTY_RECOVERY_UNDERTARGET_EMA_MIN ||
            state.rateEma <=
              GCALL_SINGLE_SOURCE_NEAR_EMPTY_RECOVERY_RATE_EMA_MAX);
        const readyLeanCalmClear =
          state.currentReceiveProfile === 'repair-collapse' &&
          !severeSingleSourceHold &&
          nowMs - state.lastProfileChangedAtMs >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_PROFILE_AGE_MS &&
          state.lastJitterHasReadyFrame &&
          state.targetPlayoutMs >=
            GCALL_SINGLE_SOURCE_RECOVERY_TARGET_FLOOR_MS &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_JITTER_FRAMES_MIN &&
          state.preProcessBufferedFrames <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_PREBUFFER_FRAMES_MAX &&
          !state.lastConcealmentUsed &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_UNDERTARGET_EMA_MAX &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_CONCEALMENT_EMA_MAX &&
          state.missingFrameEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_MISSING_EMA_MAX &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_LEAN_CLEAR_RATE_EMA_MIN;
        const bufferedPressure =
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_BUFFERED_MS_MAX;
        const lingeringPressure =
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_PRESSURE_UNDERTARGET_EMA_MIN ||
            (state.deltaMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS &&
              (state.preProcessBufferedFrames <=
                GCALL_SINGLE_SOURCE_PRESSURE_LINGERING_PREBUFFER_FRAMES_MAX ||
                state.oldestFrameAgeEma >=
                  GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_INGRESS_AGE_MIN_MS ||
                state.rateEma <= GCALL_SINGLE_SOURCE_PRESSURE_RATE_EMA_MAX ||
                state.concealmentEma >=
                  GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN))) &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_PRESSURE_RELIEF_BUFFERED_MS_MIN;
        const ratePressure =
          state.rateEma <= GCALL_SINGLE_SOURCE_PRESSURE_RATE_EMA_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_PRESSURE_RATE_BUFFERED_MS_MAX;
        const starvationPressure =
          (state.protectedMode || state.starvationSeverity !== 'none') &&
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_BUFFERED_MS_MAX;
        const currentUnderTargetPressure =
          state.lastOutsideBandUnder &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS;
        const currentSlowRatePressure =
          state.lastRateSample <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_RATE_EMA_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_BUFFERED_MS_MAX;
        const recentDamageHealthyEscape =
          state.bufferedMsEma >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_DAMAGE_BUFFERED_MS_MIN &&
          state.deltaMsEma >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_DAMAGE_DELTA_MIN_MS &&
          state.preProcessBufferedFrames >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_CONCEALMENT_EMA_MAX &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_RATE_EMA_MIN;
        const steadyHealthyEscape =
          state.lastJitterHasReadyFrame &&
          (state.damageBurstHoldUntilMs <= nowMs ||
            recentDamageHealthyEscape) &&
          (state.recentDamageHoldUntilMs <= nowMs ||
            recentDamageHealthyEscape) &&
          !currentUnderTargetPressure &&
          !currentSlowRatePressure &&
          state.bufferedMsEma >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_BUFFERED_MS_MIN &&
          state.preProcessBufferedFrames >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_CONCEALMENT_EMA_MAX &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_STEADY_HEALTHY_ESCAPE_RATE_EMA_MIN;
        const artifactPressure =
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN &&
            state.bufferedMsEma <=
              GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_BUFFERED_MS_MAX) ||
          (state.concealmentEma >=
            GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN &&
            state.bufferedMsEma <=
              GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_BUFFERED_MS_MAX);
        const sustainedDamagePressure =
          state.lastJitterHasReadyFrame &&
          state.missingFrameEma >= GCALL_SINGLE_SOURCE_STEADY_MISSING_EMA_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_STEADY_DAMAGE_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_STEADY_DAMAGE_DELTA_MAX_MS &&
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN ||
            state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX ||
            state.concealmentEma >=
              GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN);
        const repairHeavyReadyBufferedDamagePressure =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_BUFFERED_MS_MAX &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_DELTA_MAX_MS &&
          state.rateEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_RATE_EMA_MAX &&
          ((state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MISSING_EMA_MIN &&
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_UNDERTARGET_EMA_MIN) ||
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_STRONG_UNDERTARGET_EMA_MIN);
        const repairHeavyReadyShallowDamagePressure =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_SHALLOW_DAMAGE_BUFFERED_MS_MAX &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_DELTA_MAX_MS &&
          state.rateEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_SHALLOW_DAMAGE_RATE_EMA_MAX &&
          (state.concealmentEma >=
            GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN ||
            state.missingFrameEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MISSING_EMA_MIN);
        const repairHeavyReadyFalseCleanPressure =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_BUFFERED_MS_MAX &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_DELTA_MAX_MS &&
          state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MISSING_EMA_MIN &&
          state.underTargetEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_UNDERTARGET_EMA_MIN &&
          state.rateEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_FALSE_CLEAN_RATE_EMA_MAX;
        const repairHeavyReadyStressedDamagePressure =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_BUFFERED_MS_MAX &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_DELTA_MAX_MS &&
          state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_MISSING_EMA_MIN &&
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_UNDERTARGET_EMA_MIN ||
            state.rateEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_STRESSED_RATE_EMA_MAX);
        const repairHeavyHealthyReserveEscape =
          !repairHeavyReadyStressedDamagePressure &&
          state.bufferedMsEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_BUFFERED_MS_MIN &&
          state.preProcessBufferedFrames >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_CONCEALMENT_EMA_MAX &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_RATE_EMA_MIN;
        const repairHeavyStandardPressure =
          state.concealmentEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CONCEALMENT_EMA_MIN ||
          (state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MISSING_EMA_MIN &&
            state.deltaMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS &&
            state.bufferedMsEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_UNDERTARGET_BUFFERED_MS_MAX) ||
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_UNDERTARGET_EMA_MIN &&
            state.deltaMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS &&
            state.bufferedMsEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_UNDERTARGET_BUFFERED_MS_MAX) ||
          repairHeavyReadyBufferedDamagePressure ||
          repairHeavyReadyStressedDamagePressure;
        const repairHeavyPressure =
          ((repairHeavyStandardPressure &&
            state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX) ||
            repairHeavyReadyShallowDamagePressure ||
            repairHeavyReadyFalseCleanPressure ||
            repairHeavyReadyStressedDamagePressure) &&
          (state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_BUFFERED_MS_MAX ||
            repairHeavyReadyStressedDamagePressure) &&
          !repairHeavyHealthyReserveEscape &&
          !effectiveSevereSingleSourceHold;
        const repairCollapseReadyBufferedEscape =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          (latestBufferedMs >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_BUFFERED_MS_MIN ||
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_BUFFERED_MS_MIN) &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_CONCEALMENT_EMA_MAX &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_UNDERTARGET_EMA_MAX &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_READY_ESCAPE_RATE_EMA_MIN;
        const repairCollapsePressure =
          (((state.concealmentEma >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CONCEALMENT_EMA_MIN ||
            state.missingFrameEma >=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_MISSING_EMA_MIN) &&
            state.bufferedMsEma <=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_BUFFERED_MS_MAX &&
            state.deltaMsEma <=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_DELTA_MAX_MS &&
            !repairCollapseReadyBufferedEscape &&
            !readyLeanCalmClear) ||
            (readyNearEmptyDamageCollapsePressure && !readyLeanCalmClear) ||
            (readyShallowMissingFrameCollapsePressure && !readyLeanCalmClear) ||
            (readyNearEmptyRecoveryCollapsePressure && !readyLeanCalmClear)) &&
          !effectiveSevereSingleSourceHold;
        if (repairCollapsePressure) {
          state.repairCollapseHoldUntilMs = Math.max(
            state.repairCollapseHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_HOLD_MS
          );
        }
        const repairCollapseHold =
          state.repairCollapseHoldUntilMs > nowMs &&
          !readyLeanCalmClear &&
          !repairCollapseReadyBufferedEscape &&
          !(
            !repairCollapsePressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_BUFFERED_MS_MIN &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_DELTA_MIN_MS &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_CONCEALMENT_EMA_MAX
          );
        if (
          state.repairCollapseHoldUntilMs > 0 &&
          !repairCollapsePressure &&
          (readyLeanCalmClear ||
            repairCollapseReadyBufferedEscape ||
            (state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_BUFFERED_MS_MIN &&
              state.deltaMsEma >=
                GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_DELTA_MIN_MS &&
              state.concealmentEma <=
                GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_CONCEALMENT_EMA_MAX))
        ) {
          state.repairCollapseHoldUntilMs = 0;
        }
        const effectiveRepairCollapseHold =
          repairCollapseHold && state.repairCollapseHoldUntilMs > nowMs;
        if (repairHeavyPressure) {
          state.repairHeavyHoldUntilMs = Math.max(
            state.repairHeavyHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HOLD_MS
          );
        }
        const repairHeavyHold =
          state.repairHeavyHoldUntilMs > nowMs &&
          !repairHeavyHealthyReserveEscape &&
          !(
            !repairHeavyPressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_BUFFERED_MS_MIN &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_DELTA_MIN_MS &&
            state.rateEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_RATE_EMA_MIN &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_CONCEALMENT_EMA_MAX &&
            state.underTargetEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_UNDERTARGET_EMA_MAX
          );
        if (
          state.repairHeavyHoldUntilMs > 0 &&
          !repairHeavyPressure &&
          (repairHeavyHealthyReserveEscape ||
            (state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_BUFFERED_MS_MIN &&
              state.deltaMsEma >=
                GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_DELTA_MIN_MS &&
              state.rateEma >=
                GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_RATE_EMA_MIN &&
              state.concealmentEma <=
                GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_CONCEALMENT_EMA_MAX &&
              state.underTargetEma <=
                GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_UNDERTARGET_EMA_MAX))
        ) {
          state.repairHeavyHoldUntilMs = 0;
        }
        const damageHoldHealthyEscape =
          steadyHealthyEscape &&
          state.deltaMsEma >=
            GCALL_SINGLE_SOURCE_DAMAGE_HOLD_HEALTHY_ESCAPE_DELTA_MIN_MS &&
          state.missingFrameEma <=
            GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_MISSING_EMA_MAX;
        const damageBurstClear =
          damageHoldHealthyEscape ||
          readyLeanCalmClear ||
          (!repairCollapsePressure &&
            !repairHeavyPressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_BUFFERED_MS_MIN &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_DELTA_MIN_MS &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_DAMAGE_BURST_CLEAR_CONCEALMENT_EMA_MAX &&
            state.underTargetEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_UNDERTARGET_EMA_MAX);
        if (state.damageBurstHoldUntilMs > 0 && damageBurstClear) {
          state.damageBurstHoldUntilMs = 0;
        }
        const damageBurstHold =
          state.damageBurstHoldUntilMs > nowMs &&
          !damageBurstClear &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_DAMAGE_BURST_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_DAMAGE_BURST_DELTA_MAX_MS;
        const damageBurstCollapsePressure =
          damageBurstHold &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_DAMAGE_BURST_REPAIR_COLLAPSE_BUFFERED_MS_MAX &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_DAMAGE_BURST_REPAIR_COLLAPSE_DELTA_MAX_MS;
        const damageBurstRepairPressure =
          damageBurstHold && !damageBurstCollapsePressure;
        const recentDamageClear =
          damageHoldHealthyEscape ||
          readyLeanCalmClear ||
          (state.lastJitterHasReadyFrame &&
            !state.lastConcealmentUsed &&
            state.preProcessBufferedFrames >=
              GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_CONCEALMENT_EMA_MAX &&
            state.missingFrameEma <=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_MISSING_EMA_MAX &&
            state.underTargetEma <=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CLEAR_UNDERTARGET_EMA_MAX &&
            state.rateEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_RATE_EMA_MIN) ||
          (!repairCollapsePressure &&
            !repairHeavyPressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_BUFFERED_MS_MIN &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_DELTA_MIN_MS &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_CONCEALMENT_EMA_MAX &&
            state.missingFrameEma <=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_CLEAR_MISSING_EMA_MAX);
        if (state.recentDamageHoldUntilMs > 0 && recentDamageClear) {
          state.recentDamageHoldUntilMs = 0;
        }
        const recentDamageHold =
          state.recentDamageHoldUntilMs > nowMs &&
          !recentDamageClear &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_RECENT_DAMAGE_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_RECENT_DAMAGE_DELTA_MAX_MS;
        const recentDamageCollapsePressure =
          recentDamageHold &&
          ((state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_RECENT_DAMAGE_COLLAPSE_BUFFERED_MS_MAX &&
            state.deltaMsEma <=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_COLLAPSE_DELTA_MAX_MS) ||
            (!state.lastJitterHasReadyFrame &&
              state.bufferedMsEma <=
                GCALL_SINGLE_SOURCE_RECENT_DAMAGE_NOT_READY_BUFFERED_MS_MAX));
        const recentDamageRepairPressure =
          recentDamageHold &&
          !recentDamageCollapsePressure &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_RECENT_DAMAGE_REPAIR_HEAVY_BUFFERED_MS_MAX &&
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_RECENT_DAMAGE_REPAIR_HEAVY_UNDERTARGET_EMA_MIN ||
            state.missingFrameEma >=
              GCALL_SINGLE_SOURCE_RECENT_DAMAGE_REPAIR_HEAVY_MISSING_EMA_MIN ||
            state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX);
        const cleanBufferedBacklogEscape =
          state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_JITTER_FRAMES_MIN &&
          state.preProcessBufferedFrames <=
            GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_PREBUFFER_FRAMES_MAX &&
          !state.lastConcealmentUsed &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_CONCEALMENT_EMA_MAX &&
          state.missingFrameEma <=
            GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_MISSING_EMA_MAX &&
          state.oldestFrameAgeEma <=
            GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_INGRESS_AGE_MAX_MS &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_RATE_EMA_MIN &&
          !(
            state.severeSingleSourceHoldUntilMs > nowMs &&
            state.currentReceiveProfile === 'repair-collapse'
          ) &&
          !damageBurstHold &&
          !recentDamageHold;
        if (cleanBufferedBacklogEscape) {
          state.severeSingleSourceHoldUntilMs = 0;
          state.repairCollapseHoldUntilMs = 0;
          state.repairHeavyHoldUntilMs = 0;
          state.damageBurstHoldUntilMs = 0;
          state.recentDamageHoldUntilMs = 0;
          state.bufferedNotReadyHoldUntilMs = 0;
          state.persistentLeanHoldUntilMs = 0;
          state.silentLeanHoldUntilMs = 0;
          state.postRecoveryHoldUntilMs = 0;
        }
        const postBurstLatencyPolicyCap =
          !!playoutDiagnostics.postBurstLatencyLockoutActive &&
          state.missingFrameEma <=
            GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_MISSING_EMA_MAX &&
          state.oldestFrameAgeEma <=
            GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_INGRESS_AGE_MAX_MS &&
          state.rateEma >=
            GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_RATE_EMA_MIN &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_UNDERTARGET_EMA_MAX;
        const diagnosticBufferedNotReadyPressure =
          !state.lastJitterHasReadyFrame &&
          !state.lastConcealmentUsed &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CONCEALMENT_EMA_MAX;
        const bufferedNotReadyReserveCandidate =
          latestBufferedMs >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN ||
          state.bufferedMsEma >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN;
        const bufferedNotReadyRecoveryPressure =
          !state.lastJitterHasReadyFrame &&
          !state.lastConcealmentUsed &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_NOT_READY_BUFFERED_MS_MAX &&
          state.bufferedMsEma >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_RECOVERY_BUFFERED_MS_MIN &&
          state.underTargetEma >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_UNDERTARGET_EMA_MIN * 2 &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DELTA_MAX_MS &&
          state.rateEma <= 0.995;
        const bufferedNotReadyDamagedLeanPressure =
          !state.lastJitterHasReadyFrame &&
          state.lastJitterBufferedFrames >=
            GCALL_SINGLE_SOURCE_DIAGNOSTIC_BUFFERED_FRAMES_MIN &&
          latestBufferedMs <= GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DAMAGED_CONCEALMENT_EMA_MAX &&
          (state.concealmentEma >=
            GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN ||
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN ||
            state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX);
        const startupBufferedNotReadyPressure =
          !state.lastJitterHasReadyFrame &&
          state.sampleCount === 0 &&
          playoutDiagnostics.jitterActive &&
          playoutDiagnostics.playbackNodeActive &&
          playoutDiagnostics.schedulerNodeActive;
        const persistentLeanPressure =
          !state.lastConcealmentUsed &&
          !(
            !state.lastJitterHasReadyFrame &&
            (bufferedNotReadyReserveCandidate ||
              bufferedNotReadyRecoveryPressure ||
              bufferedNotReadyDamagedLeanPressure ||
              startupBufferedNotReadyPressure ||
              diagnosticBufferedNotReadyPressure)
          ) &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_BUFFERED_MS_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
          (state.preProcessBufferedFrames <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_PREBUFFER_FRAMES_MAX ||
            state.oldestFrameAgeEma >=
              GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_INGRESS_AGE_MIN_MS) &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_DELTA_MAX_MS &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CONCEALMENT_EMA_MAX &&
          !severeSingleSourceHold;
        if (persistentLeanPressure) {
          state.persistentLeanHoldUntilMs = Math.max(
            state.persistentLeanHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_HOLD_MS
          );
        }
        const persistentLeanHold =
          state.persistentLeanHoldUntilMs > nowMs &&
          !state.lastConcealmentUsed &&
          !(
            !state.lastJitterHasReadyFrame &&
            (bufferedNotReadyReserveCandidate ||
              bufferedNotReadyRecoveryPressure ||
              bufferedNotReadyDamagedLeanPressure ||
              diagnosticBufferedNotReadyPressure)
          ) &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CONCEALMENT_EMA_MAX &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
          !(
            !persistentLeanPressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
            state.preProcessBufferedFrames >=
              GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN &&
            state.oldestFrameAgeEma <=
              GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_INGRESS_AGE_MAX_MS
          );
        if (
          state.persistentLeanHoldUntilMs > 0 &&
          !persistentLeanPressure &&
          latestBufferedMs >=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
          state.preProcessBufferedFrames >=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN &&
          state.oldestFrameAgeEma <=
            GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_INGRESS_AGE_MAX_MS
        ) {
          state.persistentLeanHoldUntilMs = 0;
        }
        const notReadySilentLeanPressure =
          !state.lastJitterHasReadyFrame &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
          state.preProcessBufferedFrames <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_PREBUFFER_FRAMES_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS &&
          state.rateEma >= GCALL_SINGLE_SOURCE_SILENT_LEAN_RATE_EMA_MIN &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_CONCEALMENT_EMA_MAX;
        const readySilentLeanPressure =
          state.lastJitterHasReadyFrame &&
          !readyNearEmptyDamageCollapsePressure &&
          !readyShallowMissingFrameCollapsePressure &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS &&
          state.rateEma >= GCALL_SINGLE_SOURCE_SILENT_LEAN_RATE_EMA_MIN &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_CONCEALMENT_EMA_MAX &&
          state.underTargetEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_UNDERTARGET_EMA_MAX;
        const silentLeanPressure =
          (notReadySilentLeanPressure || readySilentLeanPressure) &&
          !severeSingleSourceHold;
        if (silentLeanPressure) {
          state.silentLeanHoldUntilMs = Math.max(
            state.silentLeanHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_SILENT_LEAN_HOLD_MS
          );
        }
        const silentLeanHold =
          state.silentLeanHoldUntilMs > nowMs &&
          (!state.lastJitterHasReadyFrame ||
            (state.lastJitterHasReadyFrame &&
              latestBufferedMs <=
                GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
              state.bufferedMsEma <=
                GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_BUFFERED_MS_MAX &&
              state.concealmentEma <=
                GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_CONCEALMENT_EMA_MAX &&
              state.underTargetEma <=
                GCALL_SINGLE_SOURCE_SILENT_LEAN_READY_UNDERTARGET_EMA_MAX)) &&
          !(
            !silentLeanPressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
            state.preProcessBufferedFrames >=
              GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS
          );
        if (
          state.silentLeanHoldUntilMs > 0 &&
          !silentLeanPressure &&
          state.bufferedMsEma >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
          state.preProcessBufferedFrames >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN &&
          state.deltaMsEma >= GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS
        ) {
          state.silentLeanHoldUntilMs = 0;
        }
        const bufferedNotReadyReadyGapPressure =
          !state.lastJitterHasReadyFrame &&
          !state.lastConcealmentUsed &&
          latestBufferedMs >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN &&
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_NOT_READY_BUFFERED_MS_MAX &&
          state.underTargetEma >=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_UNDERTARGET_EMA_MIN &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DELTA_MAX_MS &&
          state.rateEma <= GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_RATE_EMA_MAX;
        const bufferedNotReadyConcealmentOk =
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CONCEALMENT_EMA_MAX ||
          startupBufferedNotReadyPressure ||
          bufferedNotReadyReadyGapPressure ||
          bufferedNotReadyRecoveryPressure ||
          bufferedNotReadyDamagedLeanPressure ||
          diagnosticBufferedNotReadyPressure;
        const bufferedNotReadyPressure =
          !state.lastJitterHasReadyFrame &&
          bufferedNotReadyConcealmentOk &&
          (startupBufferedNotReadyPressure ||
            diagnosticBufferedNotReadyPressure ||
            bufferedNotReadyReadyGapPressure ||
            bufferedNotReadyRecoveryPressure ||
            bufferedNotReadyDamagedLeanPressure ||
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN) &&
          (startupBufferedNotReadyPressure ||
            diagnosticBufferedNotReadyPressure ||
            bufferedNotReadyReadyGapPressure ||
            bufferedNotReadyRecoveryPressure ||
            bufferedNotReadyDamagedLeanPressure ||
            state.preProcessBufferedFrames <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_PREBUFFER_FRAMES_MAX ||
            state.oldestFrameAgeEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_INGRESS_AGE_MIN_MS) &&
          (startupBufferedNotReadyPressure ||
            diagnosticBufferedNotReadyPressure ||
            bufferedNotReadyDamagedLeanPressure ||
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_UNDERTARGET_EMA_MIN) &&
          (startupBufferedNotReadyPressure ||
            state.deltaMsEma <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DELTA_MAX_MS) &&
          (startupBufferedNotReadyPressure ||
            state.rateEma <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_RATE_EMA_MAX) &&
          !repairCollapseHold &&
          !repairCollapsePressure &&
          !silentLeanPressure &&
          !persistentLeanPressure;
        if (bufferedNotReadyPressure && !startupBufferedNotReadyPressure) {
          state.bufferedNotReadyHoldUntilMs = Math.max(
            state.bufferedNotReadyHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_HOLD_MS
          );
        }
        const bufferedNotReadyHold =
          state.bufferedNotReadyHoldUntilMs > nowMs &&
          !state.lastJitterHasReadyFrame &&
          !(
            !bufferedNotReadyPressure &&
            state.preProcessBufferedFrames >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_PREBUFFER_FRAMES_MIN &&
            state.oldestFrameAgeEma <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_INGRESS_AGE_MAX_MS &&
            state.underTargetEma <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_UNDERTARGET_EMA_MAX &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_DELTA_MIN_MS
          );
        if (
          state.bufferedNotReadyHoldUntilMs > 0 &&
          (state.lastJitterHasReadyFrame ||
            (!bufferedNotReadyPressure &&
              state.preProcessBufferedFrames >=
                GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_PREBUFFER_FRAMES_MIN &&
              state.oldestFrameAgeEma <=
                GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_INGRESS_AGE_MAX_MS &&
              state.underTargetEma <=
                GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_UNDERTARGET_EMA_MAX &&
              state.deltaMsEma >=
                GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_CLEAR_DELTA_MIN_MS))
        ) {
          state.bufferedNotReadyHoldUntilMs = 0;
        }
        const mildSteadyAssist =
          (ratePressure || artifactPressure) &&
          !severeSingleSourceHold &&
          !state.protectedMode &&
          state.starvationSeverity === 'none';
        if (
          recoveryModeActive ||
          severeSingleSourceHold ||
          starvationPressure ||
          bufferedPressure ||
          lingeringPressure ||
          ratePressure ||
          mildSteadyAssist ||
          damageBurstHold ||
          recentDamageHold ||
          effectiveRepairCollapseHold ||
          repairCollapsePressure ||
          repairHeavyHold ||
          bufferedNotReadyHold ||
          bufferedNotReadyPressure ||
          persistentLeanHold ||
          persistentLeanPressure ||
          silentLeanHold ||
          silentLeanPressure ||
          repairHeavyPressure
        ) {
          state.postRecoveryHoldUntilMs = Math.max(
            state.postRecoveryHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_POST_RECOVERY_HOLD_MS
          );
        }
        const postRecoveryHold =
          state.postRecoveryHoldUntilMs > nowMs &&
          (state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_POST_RECOVERY_SMOOTH_BUFFERED_MS_MAX ||
            state.deltaMsEma <=
              GCALL_SINGLE_SOURCE_POST_RECOVERY_SMOOTH_DELTA_MAX_MS ||
            state.rateEma <=
              GCALL_SINGLE_SOURCE_POST_RECOVERY_SMOOTH_RATE_EMA_MAX) &&
          !(
            !recoveryModeActive &&
            !severeSingleSourceHold &&
            !starvationPressure &&
            !bufferedPressure &&
            !lingeringPressure &&
            !ratePressure &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_BUFFERED_MS_MIN &&
            state.deltaMsEma >=
              GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_DELTA_MIN_MS &&
            state.rateEma >=
              GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_RATE_EMA_MIN &&
            state.concealmentEma <=
              GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_CONCEALMENT_EMA_MAX
          );
        if (
          state.postRecoveryHoldUntilMs > 0 &&
          (steadyHealthyEscape ||
            (!recoveryModeActive &&
              !severeSingleSourceHold &&
              !starvationPressure &&
              !bufferedPressure &&
              !lingeringPressure &&
              !ratePressure &&
              state.bufferedMsEma >=
                GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_BUFFERED_MS_MIN &&
              state.deltaMsEma >=
                GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_DELTA_MIN_MS &&
              state.rateEma >=
                GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_RATE_EMA_MIN &&
              state.concealmentEma <=
                GCALL_SINGLE_SOURCE_POST_RECOVERY_CLEAR_CONCEALMENT_EMA_MAX))
        ) {
          state.postRecoveryHoldUntilMs = 0;
        }
        const singleSourcePressure =
          effectiveSevereSingleSourceHold ||
          starvationPressure ||
          bufferedPressure ||
          lingeringPressure ||
          ratePressure ||
          currentUnderTargetPressure ||
          currentSlowRatePressure;
        const profile = selectSingleSourceReceiveProfile({
          currentReady: state.lastJitterHasReadyFrame,
          recoveryModeActive,
          postFailoverRootProfileActive,
          severeSingleSourcePressure:
            severeSingleSourcePressure && !cleanBufferedBacklogEscape,
          severeSingleSourceHold:
            effectiveSevereSingleSourceHold && !cleanBufferedBacklogEscape,
          repairCollapseHold:
            effectiveRepairCollapseHold && !cleanBufferedBacklogEscape,
          repairCollapsePressure:
            repairCollapsePressure && !cleanBufferedBacklogEscape,
          repairHeavyHold: repairHeavyHold && !cleanBufferedBacklogEscape,
          repairHeavyPressure:
            repairHeavyPressure && !cleanBufferedBacklogEscape,
          damageBurstHold,
          damageBurstCollapsePressure:
            (damageBurstCollapsePressure || recentDamageCollapsePressure) &&
            !cleanBufferedBacklogEscape,
          damageBurstRepairPressure:
            (damageBurstRepairPressure || recentDamageRepairPressure) &&
            !cleanBufferedBacklogEscape,
          bufferedNotReadyHold,
          bufferedNotReadyPressure,
          persistentLeanHold: persistentLeanHold && !cleanBufferedBacklogEscape,
          persistentLeanPressure:
            persistentLeanPressure && !cleanBufferedBacklogEscape,
          silentLeanHold: silentLeanHold && !cleanBufferedBacklogEscape,
          silentLeanPressure: silentLeanPressure && !cleanBufferedBacklogEscape,
          postRecoveryHold:
            postRecoveryHold &&
            !steadyHealthyEscape &&
            !cleanBufferedBacklogEscape,
          singleSourcePressure:
            (singleSourcePressure || sustainedDamagePressure) &&
            !cleanBufferedBacklogEscape &&
            !steadyHealthyEscape,
          mildSteadyAssist:
            (mildSteadyAssist ||
              sustainedDamagePressure ||
              recentDamageRepairPressure ||
              currentUnderTargetPressure ||
              currentSlowRatePressure) &&
            !cleanBufferedBacklogEscape &&
            !steadyHealthyEscape,
          steadyHealthyEscape:
            steadyHealthyEscape || cleanBufferedBacklogEscape,
        });
        this.setReceiveProfile(sourceAddr, state, profile, nowMs);
        const shouldHoldWeakLeanRecoveryMode =
          (profile === 'persistent-lean' &&
            (state.bufferedMsEma <
              GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN ||
              state.deltaMsEma <
                GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_DELTA_MAX_MS ||
              state.underTargetEma >=
                GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN)) ||
          (profile === 'steady-weak-listener' &&
            !steadyHealthyEscape &&
            (sustainedDamagePressure ||
              recentDamageRepairPressure ||
              state.underTargetEma >=
                GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN ||
              state.concealmentEma >=
                GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN ||
              state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX));
        const shouldHoldRepairHeavyRecoveryMode =
          profile === 'repair-heavy-connected' &&
          !repairHeavyHealthyReserveEscape &&
          (!state.lastJitterHasReadyFrame ||
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_STRONG_UNDERTARGET_EMA_MIN ||
            (state.underTargetEma >=
              GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_UNDERTARGET_EMA_MIN &&
              state.rateEma <=
                GCALL_SINGLE_SOURCE_REPAIR_HEAVY_READY_DAMAGE_RATE_EMA_MAX) ||
            state.rateEma <= GCALL_SINGLE_SOURCE_PRESSURE_RATE_EMA_MAX);
        const shouldHoldSingleSourceRecoveryMode =
          (profile === 'repair-collapse' &&
            (state.bufferedMsEma <
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_BUFFERED_MS_MIN ||
              state.deltaMsEma <
                GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CLEAR_DELTA_MIN_MS ||
              !state.lastJitterHasReadyFrame)) ||
          ((profile === 'silent-lean' ||
            (profile === 'buffered-not-ready' &&
              !startupBufferedNotReadyPressure)) &&
            (!state.lastJitterHasReadyFrame ||
              state.bufferedMsEma <
                GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_BUFFERED_MS_MIN ||
              state.deltaMsEma <
                GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS)) ||
          shouldHoldRepairHeavyRecoveryMode ||
          shouldHoldWeakLeanRecoveryMode;
        if (shouldHoldSingleSourceRecoveryMode) {
          if (!postBurstLatencyPolicyCap) {
            dmMarkPeerUnstable(
              this.peerRecoveryState,
              sourceAddr,
              shouldHoldWeakLeanRecoveryMode || shouldHoldRepairHeavyRecoveryMode
                ? 2
                : 3,
              nowMs
            );
            this.recomputeAdaptiveNetworkMode(nowMs);
          }
          playout.syncAdaptiveJitterGeometry();
        }
        if (profile === 'clean-low-latency') {
          state.lastAppliedTargetMs = null;
          state.lastAppliedFloorMs = null;
          state.lastAppliedTargetBoostMs = 0;
          state.lastAppliedExtraHoldFrames = 0;
          playout.setBurstRecoveryExtraHoldFrames(0);
          playout.resetDynamicTargetPlayoutMs();
          continue;
        }

        const targetBoostMs = singleSourceReceiveProfileTargetBoostMs(
          profile,
          state
        );
        let targetMs = staticTargetMs + targetBoostMs;
        const floorMs = singleSourceReceiveProfileFloorMs(profile);
        let appliedFloorMs = floorMs;
        if (floorMs !== null) {
          targetMs = Math.max(targetMs, floorMs);
        }
        if (cleanBufferedBacklogEscape) {
          targetMs = Math.min(
            targetMs,
            Math.max(
              staticTargetMs,
              GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_TARGET_MS
            )
          );
        }
        if (postBurstLatencyPolicyCap) {
          targetMs = Math.min(
            targetMs,
            Math.max(
              staticTargetMs,
              GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_TARGET_MS
            )
          );
          if (appliedFloorMs !== null) {
            appliedFloorMs = Math.min(appliedFloorMs, targetMs);
          }
        }
        const feasibleTargetMs = computeFeasibleSingleRemoteRecoveryTargetMaxMs(
          {
            currentAdaptiveMaxTargetMs: targetMs,
            activeSourceCount,
            adaptiveNetworkMode: 'recovery',
            starvationSeverity: state.starvationSeverity,
            previousStarvationSeverity: state.starvationSeverity,
            playoutUnderTargetFraction: state.underTargetEma,
            avgPlayoutDeltaMs: state.deltaMsEma,
            avgOpusBufferedMs: state.bufferedMsEma,
            observedTargetMs: state.targetPlayoutMs,
          }
        );
        if (feasibleTargetMs !== null) {
          targetMs = Math.max(targetMs, feasibleTargetMs);
        }
        if (postBurstLatencyPolicyCap) {
          targetMs = Math.min(
            targetMs,
            Math.max(
              staticTargetMs,
              GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_TARGET_MS
            )
          );
          if (appliedFloorMs !== null) {
            appliedFloorMs = Math.min(appliedFloorMs, targetMs);
          }
        }
        const desiredBufferedFrames = Math.max(
          2,
          Math.round(targetMs / OPUS_FRAME_DURATION_MS)
        );
        const maxExtraHoldFrames = cleanBufferedBacklogEscape
          ? GCALL_SINGLE_SOURCE_CLEAN_BACKLOG_ESCAPE_MAX_EXTRA_HOLD_FRAMES
          : postBurstLatencyPolicyCap
            ? GCALL_SINGLE_SOURCE_POST_BURST_POLICY_CAP_MAX_EXTRA_HOLD_FRAMES
            : profile === 'collapse-recovery' || profile === 'repair-collapse'
            ? GCALL_SINGLE_SOURCE_COLLAPSE_MAX_EXTRA_HOLD_FRAMES
            : profile === 'repair-heavy-connected'
              ? GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MAX_EXTRA_HOLD_FRAMES
              : profile === 'persistent-lean'
                ? GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_MAX_EXTRA_HOLD_FRAMES
                : GCALL_SINGLE_SOURCE_MAX_EXTRA_HOLD_FRAMES;
        const requestedExtraHoldFrames = Math.max(
          0,
          Math.min(
            maxExtraHoldFrames,
            desiredBufferedFrames - Math.max(1, state.preProcessBufferedFrames)
          )
        );
        const appliedExtraHoldFrames = playout.setBurstRecoveryExtraHoldFrames(
          requestedExtraHoldFrames
        );
        const extraHoldFrames = Number.isFinite(appliedExtraHoldFrames)
          ? appliedExtraHoldFrames
          : requestedExtraHoldFrames;
        state.lastAppliedTargetMs = targetMs;
        state.lastAppliedFloorMs = appliedFloorMs;
        state.lastAppliedTargetBoostMs = targetBoostMs;
        state.lastAppliedExtraHoldFrames = extraHoldFrames;
        playout.setDynamicTargetPlayoutMs(targetMs);
        continue;
      }

      const latestMultiSourceBufferedMs =
        state.recentOpusBufferedMs.at(-1) ?? state.bufferedMsEma;
      const multiSourceDamageHold =
        state.damageBurstHoldUntilMs > nowMs &&
        state.bufferedMsEma <= GCALL_MULTI_SOURCE_DAMAGE_BUFFERED_MS_MAX &&
        state.deltaMsEma <= GCALL_MULTI_SOURCE_DAMAGE_DELTA_MAX_MS;
      const multiSourceRecentDamageHold =
        state.recentDamageHoldUntilMs > nowMs &&
        state.bufferedMsEma <= GCALL_MULTI_SOURCE_DAMAGE_BUFFERED_MS_MAX &&
        state.deltaMsEma <= GCALL_MULTI_SOURCE_DAMAGE_DELTA_MAX_MS;
      const multiSourceRepairHold =
        state.repairCollapseHoldUntilMs > nowMs ||
        state.repairHeavyHoldUntilMs > nowMs;
      const multiSourceLatchedDamage =
        state.protectedMode ||
        state.starvationSeverity !== 'none' ||
        multiSourceDamageHold ||
        multiSourceRecentDamageHold ||
        multiSourceRepairHold;
      const multiSourceCurrentCleanSample =
        latestMultiSourceBufferedMs >=
          GCALL_MULTI_SOURCE_CLEAN_BUFFERED_MS_MIN &&
        state.preProcessBufferedFrames >=
          GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN &&
        !state.lastOutsideBandUnder &&
        !state.lastConcealmentUsed &&
        state.lastRateSample >= GCALL_MULTI_SOURCE_CLEAN_RATE_EMA_MIN;
      const multiSourceCleanMetrics =
        !state.lastConcealmentUsed &&
        ((state.bufferedMsEma >= GCALL_MULTI_SOURCE_CLEAN_BUFFERED_MS_MIN &&
          state.deltaMsEma >= GCALL_MULTI_SOURCE_CLEAN_DELTA_MIN_MS &&
          state.concealmentEma <=
            GCALL_MULTI_SOURCE_CLEAN_CONCEALMENT_EMA_MAX &&
          state.missingFrameEma <= GCALL_MULTI_SOURCE_CLEAN_MISSING_EMA_MAX &&
          state.underTargetEma <=
            GCALL_MULTI_SOURCE_CLEAN_UNDERTARGET_EMA_MAX &&
          state.rateEma >= GCALL_MULTI_SOURCE_CLEAN_RATE_EMA_MIN) ||
          (!multiSourceLatchedDamage &&
            state.currentReceiveProfile === 'multi-clean-low-latency' &&
            multiSourceCurrentCleanSample));
      const multiSourceNearEmptyDamage =
        state.bufferedMsEma <= GCALL_MULTI_SOURCE_NEAR_EMPTY_BUFFERED_MS_MAX &&
        state.deltaMsEma <= GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS &&
        (multiSourceDamageHold ||
          multiSourceRecentDamageHold ||
          !state.lastJitterHasReadyFrame ||
          state.concealmentEma >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_CONCEALMENT_EMA_MIN ||
          state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_DAMAGE_MISSING_EMA_HOLD_MIN);
      const multiSourceRepairDamage =
        state.bufferedMsEma <= GCALL_MULTI_SOURCE_DAMAGE_BUFFERED_MS_MAX &&
        state.deltaMsEma <= GCALL_MULTI_SOURCE_DAMAGE_DELTA_MAX_MS &&
        (multiSourceDamageHold ||
          multiSourceRecentDamageHold ||
          multiSourceRepairHold ||
          state.concealmentEma >=
            GCALL_MULTI_SOURCE_DAMAGE_CONCEALMENT_EMA_MIN ||
          state.missingFrameEma >= GCALL_MULTI_SOURCE_DAMAGE_MISSING_EMA_MIN ||
          state.underTargetEma >=
            GCALL_MULTI_SOURCE_DAMAGE_UNDERTARGET_EMA_MIN ||
          state.rateEma <= GCALL_MULTI_SOURCE_DAMAGE_RATE_EMA_MAX);
      const multiSourceNotReadyDamage =
        !state.lastJitterHasReadyFrame &&
        (state.bufferedMsEma <= GCALL_MULTI_SOURCE_DAMAGE_BUFFERED_MS_MAX ||
          state.deltaMsEma <= GCALL_MULTI_SOURCE_DAMAGE_DELTA_MAX_MS ||
          multiSourceRecentDamageHold);
      const multiSourceSourceRecoveryPressure =
        !multiSourceCleanMetrics &&
        (state.protectedMode ||
          state.starvationSeverity !== 'none' ||
          multiSourceRepairHold ||
          multiSourceDamageHold ||
          multiSourceRecentDamageHold ||
          multiSourceNearEmptyDamage ||
          multiSourceRepairDamage ||
          multiSourceNotReadyDamage);
      const multiSourceSourceCollapsePressure =
        !multiSourceCleanMetrics &&
        (multiSourceNearEmptyDamage ||
          (multiSourceDamageHold &&
            state.bufferedMsEma <=
              GCALL_SINGLE_SOURCE_DAMAGE_BURST_REPAIR_COLLAPSE_BUFFERED_MS_MAX &&
            state.deltaMsEma <= GCALL_MULTI_SOURCE_COLLAPSE_DELTA_MAX_MS));

      if (mode !== 'recovery' && !multiSourceSourceRecoveryPressure) {
        playout.setForcedAdaptiveJitterMode(null);
        this.setReceiveProfile(
          sourceAddr,
          state,
          'multi-clean-low-latency',
          nowMs
        );
        state.lastAppliedTargetMs = null;
        state.lastAppliedFloorMs = null;
        state.lastAppliedTargetBoostMs = 0;
        state.lastAppliedExtraHoldFrames = 0;
        playout.setBurstRecoveryExtraHoldFrames(0);
        playout.resetDynamicTargetPlayoutMs();
        continue;
      }

      const prioritizeWeakLeg = shouldPrioritizeWeakMultiSourceLeg({
        activeSourceCount,
        bufferedFrames: state.preProcessBufferedFrames,
        opusBufferedMs: state.bufferedMsEma,
        adaptiveTargetMedianMs: state.targetPlayoutMs,
        protectedMode: state.protectedMode,
        playoutStarvationSeverity: state.starvationSeverity,
      });
      const profile = selectMultiSourceReceiveProfile({
        recoveryModeActive: mode === 'recovery',
        prioritizeWeakLeg,
        protectedMode: state.protectedMode,
        starvationSeverity: state.starvationSeverity,
        sourceRecoveryPressure: multiSourceSourceRecoveryPressure,
        sourceCollapsePressure: multiSourceSourceCollapsePressure,
      });
      playout.setForcedAdaptiveJitterMode(
        mode !== 'recovery' && multiSourceSourceRecoveryPressure
          ? 'recovery'
          : null
      );
      this.setReceiveProfile(sourceAddr, state, profile, nowMs);

      const targetBoostMs = multiSourceReceiveProfileTargetBoostMs(
        profile,
        multiSourceSourceCollapsePressure
      );
      const floorMs = multiSourceReceiveProfileFloorMs(
        profile,
        multiSourceSourceCollapsePressure
      );
      let targetMs = staticTargetMs + targetBoostMs;
      if (floorMs !== null) {
        targetMs = Math.max(targetMs, floorMs);
      }
      if (
        (prioritizeWeakLeg || multiSourceSourceRecoveryPressure) &&
        targetBoostMs === 0
      ) {
        targetMs +=
          state.starvationSeverity === 'strong' ||
          multiSourceSourceCollapsePressure
            ? GCALL_MULTI_SOURCE_TARGET_BOOST_STRONG_MS
            : GCALL_MULTI_SOURCE_TARGET_BOOST_MILD_MS;
      }
      const feasibleTargetMs = computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: targetMs,
        activeSourceCount,
        adaptiveNetworkMode:
          mode === 'recovery' || multiSourceSourceRecoveryPressure
            ? 'recovery'
            : mode,
        starvationSeverity: state.starvationSeverity,
        isolatedSource: prioritizeWeakLeg || multiSourceSourceRecoveryPressure,
        shouldTightenRecovery:
          state.protectedMode ||
          weakLegPresent ||
          multiSourceSourceRecoveryPressure,
        previousStarvationSeverity: state.starvationSeverity,
        playoutUnderTargetFraction: state.underTargetEma,
        avgPlayoutDeltaMs: state.deltaMsEma,
        avgOpusBufferedMs: state.bufferedMsEma,
        observedTargetMs: state.targetPlayoutMs,
      });
      if (feasibleTargetMs !== null) {
        targetMs =
          floorMs !== null
            ? Math.max(floorMs, feasibleTargetMs)
            : feasibleTargetMs;
      }

      const shouldHold = shouldHoldMultiSourceAccumulation({
        bufferedFrames: state.preProcessBufferedFrames,
        opusBufferedMs: state.bufferedMsEma,
        adaptiveTargetMedianMs: targetMs,
        protectedMode: state.protectedMode || multiSourceSourceRecoveryPressure,
        playoutStarvationSeverity: state.starvationSeverity,
      });
      const accumulationTargetFrames =
        computeMultiSourceAccumulationTargetFrames({
          adaptiveTargetMedianMs: targetMs,
          protectedMode:
            state.protectedMode || multiSourceSourceRecoveryPressure,
          playoutStarvationSeverity: state.starvationSeverity,
        });
      const shouldForceSourcePressureHold =
        multiSourceSourceRecoveryPressure &&
        state.preProcessBufferedFrames <
          Math.max(2, Math.round(targetMs / OPUS_FRAME_DURATION_MS));
      const maxExtraHoldFrames =
        multiSourceReceiveProfileMaxExtraHoldFrames(profile);
      const requestedExtraHoldFrames =
        (shouldHold || shouldForceSourcePressureHold) &&
        accumulationTargetFrames !== null
          ? Math.max(
              0,
              Math.min(
                maxExtraHoldFrames,
                accumulationTargetFrames -
                  Math.max(1, state.preProcessBufferedFrames)
              )
            )
          : 0;
      const appliedExtraHoldFrames = playout.setBurstRecoveryExtraHoldFrames(
        requestedExtraHoldFrames
      );
      const extraHoldFrames = Number.isFinite(appliedExtraHoldFrames)
        ? appliedExtraHoldFrames
        : requestedExtraHoldFrames;

      state.lastAppliedTargetMs = targetMs;
      state.lastAppliedFloorMs = floorMs;
      state.lastAppliedTargetBoostMs = targetBoostMs;
      state.lastAppliedExtraHoldFrames = extraHoldFrames;
      playout.setDynamicTargetPlayoutMs(targetMs);
    }
  }

  private updatePeerRecoveryFromPlayoutMetrics(
    sourceAddr: string,
    message: DmVoiceGcallPlayoutWorkletMessage,
    playoutDiagnostics?: {
      jitterBufferedFrames: number;
      jitterHasReadyFrame: boolean;
    }
  ): void {
    if (message.playoutStarted === false) return;
    const bufferedMs =
      typeof message.bufferedMs === 'number' &&
      Number.isFinite(message.bufferedMs)
        ? message.bufferedMs
        : Number.POSITIVE_INFINITY;
    const deltaMs =
      typeof message.deltaMs === 'number' && Number.isFinite(message.deltaMs)
        ? message.deltaMs
        : 0;
    const oldestFrameAgeMs =
      typeof message.oldestFrameAgeMs === 'number' &&
      Number.isFinite(message.oldestFrameAgeMs)
        ? message.oldestFrameAgeMs
        : 0;
    const preProcessBufferedMs =
      typeof message.preProcessBufferedMs === 'number' &&
      Number.isFinite(message.preProcessBufferedMs)
        ? message.preProcessBufferedMs
        : Number.POSITIVE_INFINITY;
    const underPressure =
      !!message.outsideBandUnder || !!message.concealmentUsed;
    const bufferedButNotReadySilentLean =
      !underPressure &&
      playoutDiagnostics !== undefined &&
      playoutDiagnostics.jitterBufferedFrames > 0 &&
      !playoutDiagnostics.jitterHasReadyFrame &&
      bufferedMs <= GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
      deltaMs <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS;
    const nowMs = Date.now();

    const severeCollapse =
      underPressure &&
      bufferedMs <= GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_PCM_MAX_MS &&
      deltaMs <= GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_DELTA_MAX_MS &&
      (oldestFrameAgeMs >=
        GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_INGRESS_AGE_MIN_MS ||
        bufferedMs <= 8 ||
        preProcessBufferedMs <= OPUS_FRAME_DURATION_MS);
    const moderateCollapse =
      underPressure &&
      bufferedMs <= GCALL_AUDIO_SURFACE_RECOVERY_MODERATE_PCM_MAX_MS &&
      deltaMs <= GCALL_AUDIO_SURFACE_RECOVERY_MODERATE_DELTA_MAX_MS;
    const stronglyStable =
      !underPressure &&
      bufferedMs >= GCALL_AUDIO_SURFACE_STABLE_STRONG_PCM_MIN_MS &&
      deltaMs >= GCALL_AUDIO_SURFACE_STABLE_STRONG_DELTA_MIN_MS;
    const mildlyStable =
      !underPressure &&
      bufferedMs >= GCALL_AUDIO_SURFACE_STABLE_PCM_MIN_MS &&
      deltaMs >= GCALL_AUDIO_SURFACE_STABLE_DELTA_MIN_MS;

    if (severeCollapse) {
      dmMarkPeerUnstable(this.peerRecoveryState, sourceAddr, 3, nowMs);
    } else if (bufferedButNotReadySilentLean) {
      dmMarkPeerUnstable(this.peerRecoveryState, sourceAddr, 3, nowMs);
    } else if (moderateCollapse) {
      dmMarkPeerUnstable(this.peerRecoveryState, sourceAddr, 2, nowMs);
    } else if (stronglyStable) {
      dmMarkPeerStable(this.peerRecoveryState, sourceAddr, {
        allowRecoveryExit: true,
        nowMs,
      });
    } else if (mildlyStable) {
      dmMarkPeerStable(this.peerRecoveryState, sourceAddr, { nowMs });
    }
    this.recomputeAdaptiveNetworkMode(nowMs);
  }

  private async getOrCreatePlayout(
    sourceAddr: string
  ): Promise<DmVoiceGcallInboundPlayout> {
    const existing = this.playouts.get(sourceAddr);
    if (existing) return existing;
    const ctx = await this.ensureAudioContext();
    const output = ctx.createGain();
    output.gain.value = 1;
    output.connect(this.masterGain!);
    const playout = new DmVoiceGcallInboundPlayout();
    await playout.start(ctx, sourceAddr, output, {
      metricsRef: this.metricsRef,
      profile: this.config.profile,
      getActiveSourceCount: () => this.playouts.size,
      afterDrain: ({ missedFramesThisTick }) => {
        if (missedFramesThisTick > 0) {
          const state = this.liveMultiSourceStateBySource.get(sourceAddr);
          if (state) {
            state.pendingMissingFrames += missedFramesThisTick;
          }
          this.metrics.recordMissingFrames(missedFramesThisTick, sourceAddr);
          this.scheduleMetricsEmit();
        }
      },
      onPlayedSeqAdvanced: ({ sourceAddr: playedSourceAddr, playedSeq }) => {
        this.onPlayedSeqAdvanced?.(playedSourceAddr, playedSeq);
      },
      onPlayoutWorkletMessage: (message) => {
        const hasAudibleReadiness =
          message.playoutStarted === true ||
          (typeof message.preProcessBufferedMs === 'number' &&
            Number.isFinite(message.preProcessBufferedMs) &&
            message.preProcessBufferedMs > 0) ||
          (typeof message.bufferedMs === 'number' &&
            Number.isFinite(message.bufferedMs) &&
            message.bufferedMs > 0);
        if (hasAudibleReadiness && this.audioContext?.state !== 'running') {
          void this.ensureAudioContextRunning();
        }
        const playoutDiagnostics = playout.getDiagnosticsSnapshot();
        this.updatePeerRecoveryFromPlayoutMetrics(
          sourceAddr,
          message,
          playoutDiagnostics
        );
        const sharedRingEnabled = playoutDiagnostics.sharedRingEnabled;
        if (
          message.playoutStarted &&
          !this.loggedFirstPlayoutStartBySource.has(sourceAddr)
        ) {
          this.loggedFirstPlayoutStartBySource.add(sourceAddr);
          traceGcallAudioSurface('pipeline: playout worklet started', {
            sourceAddr,
            bufferedMs:
              typeof message.bufferedMs === 'number'
                ? message.bufferedMs
                : null,
          });
        }
        if (typeof message.bufferedMs === 'number') {
          if (
            sharedRingEnabled &&
            typeof message.preProcessBufferedMs === 'number'
          ) {
            const bufferedFrames = Math.max(
              0,
              Math.round(message.preProcessBufferedMs / OPUS_FRAME_DURATION_MS)
            );
            const playoutStarted = message.playoutStarted !== false;
            // On the shared-ring path, "not ready" should reflect audible
            // under-run pressure, not strict pre-process frame scarcity.
            // Otherwise startup gating and low-but-still-usable reserve
            // overstate trouble in healthy calls.
            this.metrics.recordJitterDrainTelemetry({
              sourceCount: Math.max(1, this.playouts.size),
              depthSum: bufferedFrames,
              worstDepth: bufferedFrames,
              notReadyCount:
                playoutStarted &&
                (message.concealmentUsed || message.outsideBandUnder)
                  ? 1
                  : 0,
              rawEmptyCount:
                playoutStarted && message.preProcessBufferedMs <= 0 ? 1 : 0,
            });
          }
          if (
            sharedRingEnabled &&
            typeof message.oldestFrameAgeMs === 'number' &&
            Number.isFinite(message.oldestFrameAgeMs) &&
            message.oldestFrameAgeMs > 0
          ) {
            this.metrics.recordReceiverIngressToPlayoutPostLatency(
              sourceAddr,
              message.oldestFrameAgeMs
            );
          }
          this.metrics.recordPlayoutMetricTick(
            message.bufferedMs,
            !!message.outsideBand,
            sourceAddr,
            {
              outsideUnder: !!message.outsideBandUnder,
              outsideOver: !!message.outsideBandOver,
              deltaMs:
                typeof message.deltaMs === 'number'
                  ? message.deltaMs
                  : undefined,
              playoutRate:
                typeof message.rate === 'number' ? message.rate : undefined,
            }
          );
          this.updateLiveMultiSourceState(sourceAddr, message);
          this.syncLiveMultiSourceControls();
          if (message.concealmentUsed) {
            this.metrics.recordConcealmentTick(1, sourceAddr);
          }
          this.scheduleMetricsEmit();
        }
      },
      onJitterTickTelemetry: () => {
        this.scheduleMetricsEmit();
      },
      onWasmFecDecodeStats: () => {
        this.scheduleMetricsEmit();
      },
    });
    this.playouts.set(sourceAddr, playout);
    this.outputNodeBySource.set(sourceAddr, output);
    this.getOrCreateLiveMultiSourceState(
      sourceAddr,
      computeStaticPlayoutTargetMsForTuning(
        getGroupCallAudioTuning(this.config.profile)
      )
    );
    this.syncAllPlayoutAdaptiveGeometry();
    this.syncLiveMultiSourceControls();
    this.updateResourceCounts();
    this.emitMetricsNow();
    return playout;
  }

  private updateResourceCounts(): void {
    let decoders = 0;
    let playbackNodes = 0;
    let jitterBuffers = 0;
    for (const playout of this.playouts.values()) {
      const snapshot = playout.getDiagnosticsSnapshot();
      if (snapshot.decodePath === 'wasm-fec' || snapshot.hasWebCodecsDecoder) {
        decoders++;
      }
      if (snapshot.playbackNodeActive) playbackNodes++;
      if (snapshot.jitterActive) jitterBuffers++;
    }
    this.metrics.setResourceCounts({
      decoders,
      playbackNodes,
      jitterBuffers,
    });
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (this.audioContext && this.masterGain) {
      await this.ensureAudioContextRunning();
      return this.audioContext;
    }
    const ctx = new AudioContext({ sampleRate: 48_000 });
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.config.hearCall ? 1 : 0;
    masterGain.connect(ctx.destination);
    await applyCallAudioOutput(this.config.outputDeviceId, {
      audioContext: ctx,
    });
    this.audioContext = ctx;
    this.masterGain = masterGain;
    await this.ensureAudioContextRunning();
    return ctx;
  }

  private emitMetricsNow(): void {
    this.clearMetricsEmitTimer();
    this.onMetricsChanged(this.metrics.getSnapshot());
  }

  private scheduleMetricsEmit(): void {
    if (this.metricsEmitQueued) return;
    this.metricsEmitQueued = true;
    this.metricsEmitTimer = setTimeout(() => {
      this.metricsEmitTimer = null;
      this.metricsEmitQueued = false;
      this.onMetricsChanged(this.metrics.getSnapshot());
    }, GroupCallAudioReceiveEngine.METRICS_EMIT_INTERVAL_MS);
  }

  private clearMetricsEmitTimer(): void {
    if (this.metricsEmitTimer) {
      clearTimeout(this.metricsEmitTimer);
      this.metricsEmitTimer = null;
    }
    this.metricsEmitQueued = false;
  }
}
