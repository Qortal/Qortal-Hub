import { DmVoiceGcallInboundPlayout } from '../call/dmVoiceGcallInboundPlayout';
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
const GCALL_MULTI_SOURCE_MAX_EXTRA_HOLD_FRAMES = 8;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_MILD_MS = 34;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_STEADY_ASSIST_MS = 56;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_STRONG_MS = 48;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_SEVERE_MS = 160;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_REPAIR_COLLAPSE_MS = 120;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_REPAIR_HEAVY_MS = 76;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_BUFFERED_NOT_READY_MS = 72;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_PERSISTENT_LEAN_MS = 84;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_SILENT_LEAN_MS = 84;
const GCALL_SINGLE_SOURCE_TARGET_BOOST_POST_FAILOVER_ROOT_MS = 64;
const GCALL_SINGLE_SOURCE_MAX_EXTRA_HOLD_FRAMES = 8;
const GCALL_SINGLE_SOURCE_COLLAPSE_MAX_EXTRA_HOLD_FRAMES = 12;
const GCALL_SINGLE_SOURCE_RECOVERY_TARGET_FLOOR_MS = 172;
const GCALL_SINGLE_SOURCE_SEVERE_RECOVERY_TARGET_FLOOR_MS = 240;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_TARGET_FLOOR_MS = 196;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_FLOOR_MS = 224;
const GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_FLOOR_MS = 176;
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_FLOOR_MS = 192;
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
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HOLD_MS = 11_000;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MAX_EXTRA_HOLD_FRAMES = 10;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_BUFFERED_MS_MIN = 40;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_PREBUFFER_FRAMES_MIN = 2;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_CONCEALMENT_EMA_MAX = 0.08;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_UNDERTARGET_EMA_MAX = 0.08;
const GCALL_SINGLE_SOURCE_REPAIR_HEAVY_HEALTHY_ESCAPE_RATE_EMA_MIN = 0.996;
const GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_HOLD_MS = 5_500;
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
const GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_HOLD_MS = 6_000;
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
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_BUFFERED_MS_MIN = 40;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_PREBUFFER_FRAMES_MIN = 4;
const GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS = -16;
const GCALL_SINGLE_SOURCE_SEVERE_BUFFERED_MS_MAX = 12;
const GCALL_SINGLE_SOURCE_SEVERE_DELTA_MAX_MS = -80;
const GCALL_SINGLE_SOURCE_SEVERE_INGRESS_AGE_MIN_MS = 900;
const GCALL_SINGLE_SOURCE_SEVERE_LATCH_MS = 14_000;
const GCALL_SINGLE_SOURCE_SEVERE_CLEAR_BUFFERED_MS_MIN = 148;
const GCALL_SINGLE_SOURCE_SEVERE_CLEAR_DELTA_MIN_MS = -4;

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
  bufferedNotReadyHoldUntilMs: number;
  persistentLeanHoldUntilMs: number;
  silentLeanHoldUntilMs: number;
  postRecoveryHoldUntilMs: number;
  currentSingleSourceProfile: SingleSourceReceiveProfile;
}

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
  if (ctx.bufferedNotReadyPressure || (ctx.bufferedNotReadyHold && !ctx.currentReady)) {
    return 'buffered-not-ready';
  }
  if (ctx.repairCollapsePressure) {
    return 'repair-collapse';
  }
  if (ctx.repairCollapseHold) {
    return 'repair-collapse';
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
  if (ctx.repairHeavyHold || ctx.repairHeavyPressure) {
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
      return ((state.protectedMode || state.starvationSeverity === 'strong') &&
        state.bufferedMsEma <=
          GCALL_SINGLE_SOURCE_PRESSURE_RELIEF_BUFFERED_MS_MIN)
        ? GCALL_SINGLE_SOURCE_TARGET_BOOST_STRONG_MS
        : state.underTargetEma >=
              GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN ||
            state.concealmentEma >= GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN
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
  private liveMultiSourceStateBySource = new Map<string, LiveMultiSourceState>();
  private resumeAudioContextPromise: Promise<void> | null = null;
  private config: GroupCallAudioReceiveEngineConfig = {
    outputDeviceId: null,
    hearCall: true,
    profile: 'low-latency',
    postFailoverRootHoldUntilMs: 0,
  };

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
      profile: SingleSourceReceiveProfile;
    }>;
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
            ?.currentSingleSourceProfile ?? 'clean-low-latency',
      })
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
        bufferedNotReadyHoldUntilMs: 0,
        persistentLeanHoldUntilMs: 0,
        silentLeanHoldUntilMs: 0,
        postRecoveryHoldUntilMs: 0,
        currentSingleSourceProfile: 'clean-low-latency',
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
      typeof message.bufferedMs === 'number' && Number.isFinite(message.bufferedMs)
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
    const missingFrameSample = state.pendingMissingFrames > 0 ? 1 : 0;
    state.pendingMissingFrames = 0;
    state.missingFrameEma =
      state.sampleCount === 1
        ? missingFrameSample
        : state.missingFrameEma * (1 - alpha) + missingFrameSample * alpha;
    const rateSample =
      typeof message.rate === 'number' && Number.isFinite(message.rate)
        ? Math.max(0.9, Math.min(1.1, message.rate))
        : 1;
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
        const latestBufferedMs =
          state.recentOpusBufferedMs.at(-1) ?? state.bufferedMsEma;
        const postFailoverRootProfileActive =
          this.config.postFailoverRootHoldUntilMs > nowMs &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_POST_FAILOVER_ROOT_BUFFERED_MS_MAX;
        const severeSingleSourceHold =
          state.severeSingleSourceHoldUntilMs > nowMs;
        const readyBufferedLowDamageEscape =
          state.lastJitterHasReadyFrame &&
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
          ((state.lastJitterHasReadyFrame &&
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN &&
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
          (state.oldestFrameAgeEma >= GCALL_SINGLE_SOURCE_SEVERE_INGRESS_AGE_MIN_MS ||
            state.preProcessBufferedFrames <= 0);
        const recoveryModeActive = mode === 'recovery';
        const bufferedPressure =
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_BUFFERED_MS_MAX;
        const lingeringPressure =
          (state.underTargetEma >= GCALL_SINGLE_SOURCE_PRESSURE_UNDERTARGET_EMA_MIN ||
            (state.deltaMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_DELTA_MAX_MS &&
              (state.preProcessBufferedFrames <=
                GCALL_SINGLE_SOURCE_PRESSURE_LINGERING_PREBUFFER_FRAMES_MAX ||
                state.oldestFrameAgeEma >=
                  GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_INGRESS_AGE_MIN_MS ||
                state.rateEma <= GCALL_SINGLE_SOURCE_PRESSURE_RATE_EMA_MAX ||
                state.concealmentEma >=
                  GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN))) &&
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_RELIEF_BUFFERED_MS_MIN;
        const ratePressure =
          state.rateEma <= GCALL_SINGLE_SOURCE_PRESSURE_RATE_EMA_MAX &&
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_RATE_BUFFERED_MS_MAX;
        const starvationPressure =
          (state.protectedMode || state.starvationSeverity !== 'none') &&
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_PRESSURE_BUFFERED_MS_MAX;
        const steadyHealthyEscape =
          state.lastJitterHasReadyFrame &&
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
          state.missingFrameEma >=
            GCALL_SINGLE_SOURCE_STEADY_MISSING_EMA_MIN &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_STEADY_DAMAGE_BUFFERED_MS_MAX &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_STEADY_DAMAGE_DELTA_MAX_MS &&
          (state.underTargetEma >=
            GCALL_SINGLE_SOURCE_STEADY_ARTIFACT_UNDERTARGET_EMA_MIN ||
            state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX ||
            state.concealmentEma >=
              GCALL_SINGLE_SOURCE_STEADY_CONCEALMENT_EMA_MIN);
        const repairHeavyHealthyReserveEscape =
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
        const repairHeavyStandardPressure =
          (state.concealmentEma >=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_CONCEALMENT_EMA_MIN) ||
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
            repairHeavyReadyBufferedDamagePressure;
        const repairHeavyPressure =
          ((repairHeavyStandardPressure &&
            state.rateEma <= GCALL_SINGLE_SOURCE_REPAIR_HEAVY_RATE_EMA_MAX) ||
            repairHeavyReadyShallowDamagePressure ||
            repairHeavyReadyFalseCleanPressure) &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_HEAVY_BUFFERED_MS_MAX &&
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
          (state.concealmentEma >=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_CONCEALMENT_EMA_MIN ||
            state.missingFrameEma >=
              GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_MISSING_EMA_MIN) &&
          state.bufferedMsEma <=
            GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_BUFFERED_MS_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_DELTA_MAX_MS &&
          !repairCollapseReadyBufferedEscape &&
          !effectiveSevereSingleSourceHold;
        if (repairCollapsePressure) {
          state.repairCollapseHoldUntilMs = Math.max(
            state.repairCollapseHoldUntilMs,
            nowMs + GCALL_SINGLE_SOURCE_REPAIR_COLLAPSE_HOLD_MS
          );
        }
        const repairCollapseHold =
          state.repairCollapseHoldUntilMs > nowMs &&
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
          (repairCollapseReadyBufferedEscape ||
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
          latestBufferedMs <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
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
        const persistentLeanPressure =
          !state.lastConcealmentUsed &&
          !(
            !state.lastJitterHasReadyFrame &&
            (bufferedNotReadyReserveCandidate ||
              bufferedNotReadyRecoveryPressure ||
              bufferedNotReadyDamagedLeanPressure ||
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
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_DELTA_MAX_MS &&
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
          latestBufferedMs <= GCALL_SINGLE_SOURCE_PERSISTENT_LEAN_CLEAR_BUFFERED_MS_MIN &&
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
          state.bufferedMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_BUFFERED_MS_MAX &&
          state.preProcessBufferedFrames <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_PREBUFFER_FRAMES_MAX &&
          state.deltaMsEma <= GCALL_SINGLE_SOURCE_SILENT_LEAN_DELTA_MAX_MS &&
          state.rateEma >= GCALL_SINGLE_SOURCE_SILENT_LEAN_RATE_EMA_MIN &&
          state.concealmentEma <=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_CONCEALMENT_EMA_MAX;
        const readySilentLeanPressure =
          state.lastJitterHasReadyFrame &&
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
          state.deltaMsEma >=
            GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS
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
          bufferedNotReadyReadyGapPressure ||
          bufferedNotReadyRecoveryPressure ||
          bufferedNotReadyDamagedLeanPressure ||
          diagnosticBufferedNotReadyPressure;
        const bufferedNotReadyPressure =
          !state.lastJitterHasReadyFrame &&
          bufferedNotReadyConcealmentOk &&
          (diagnosticBufferedNotReadyPressure ||
            bufferedNotReadyReadyGapPressure ||
            bufferedNotReadyRecoveryPressure ||
            bufferedNotReadyDamagedLeanPressure ||
            state.bufferedMsEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_BUFFERED_MS_MIN) &&
          (diagnosticBufferedNotReadyPressure ||
            bufferedNotReadyReadyGapPressure ||
            bufferedNotReadyRecoveryPressure ||
            bufferedNotReadyDamagedLeanPressure ||
            state.preProcessBufferedFrames <=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_PREBUFFER_FRAMES_MAX ||
            state.oldestFrameAgeEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_INGRESS_AGE_MIN_MS) &&
          (diagnosticBufferedNotReadyPressure ||
            bufferedNotReadyDamagedLeanPressure ||
            state.underTargetEma >=
              GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_UNDERTARGET_EMA_MIN) &&
          state.deltaMsEma <=
            GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_DELTA_MAX_MS &&
          state.rateEma <= GCALL_SINGLE_SOURCE_BUFFERED_NOT_READY_RATE_EMA_MAX &&
          !repairCollapseHold &&
          !repairCollapsePressure &&
          !silentLeanPressure &&
          !persistentLeanPressure;
        if (bufferedNotReadyPressure) {
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
          ratePressure;
        const profile = selectSingleSourceReceiveProfile({
          currentReady: state.lastJitterHasReadyFrame,
          recoveryModeActive,
          postFailoverRootProfileActive,
          severeSingleSourcePressure,
          severeSingleSourceHold: effectiveSevereSingleSourceHold,
          repairCollapseHold: effectiveRepairCollapseHold,
          repairCollapsePressure,
          repairHeavyHold,
          repairHeavyPressure,
          bufferedNotReadyHold,
          bufferedNotReadyPressure,
          persistentLeanHold,
          persistentLeanPressure,
          silentLeanHold,
          silentLeanPressure,
          postRecoveryHold: postRecoveryHold && !steadyHealthyEscape,
          singleSourcePressure:
            (singleSourcePressure || sustainedDamagePressure) &&
            !steadyHealthyEscape,
          mildSteadyAssist:
            (mildSteadyAssist || sustainedDamagePressure) &&
            !steadyHealthyEscape,
          steadyHealthyEscape,
        });
        state.currentSingleSourceProfile = profile;
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
          ((profile === 'silent-lean' || profile === 'buffered-not-ready') &&
            (!state.lastJitterHasReadyFrame ||
              state.bufferedMsEma <
                GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_BUFFERED_MS_MIN ||
              state.deltaMsEma <
                GCALL_SINGLE_SOURCE_SILENT_LEAN_CLEAR_DELTA_MIN_MS)) ||
          shouldHoldRepairHeavyRecoveryMode ||
          shouldHoldWeakLeanRecoveryMode;
        if (shouldHoldSingleSourceRecoveryMode) {
          dmMarkPeerUnstable(
            this.peerRecoveryState,
            sourceAddr,
            shouldHoldWeakLeanRecoveryMode || shouldHoldRepairHeavyRecoveryMode
              ? 2
              : 3,
            nowMs
          );
          this.recomputeAdaptiveNetworkMode(nowMs);
          playout.syncAdaptiveJitterGeometry();
        }
        if (profile === 'clean-low-latency') {
          playout.setBurstRecoveryExtraHoldFrames(0);
          playout.resetDynamicTargetPlayoutMs();
          continue;
        }

        let targetMs =
          staticTargetMs +
          singleSourceReceiveProfileTargetBoostMs(profile, state);
        const floorMs = singleSourceReceiveProfileFloorMs(profile);
        if (floorMs !== null) {
          targetMs = Math.max(targetMs, floorMs);
        }
        const feasibleTargetMs = computeFeasibleSingleRemoteRecoveryTargetMaxMs({
          currentAdaptiveMaxTargetMs: targetMs,
          activeSourceCount,
          adaptiveNetworkMode: 'recovery',
          starvationSeverity: state.starvationSeverity,
          previousStarvationSeverity: state.starvationSeverity,
          playoutUnderTargetFraction: state.underTargetEma,
          avgPlayoutDeltaMs: state.deltaMsEma,
          avgOpusBufferedMs: state.bufferedMsEma,
          observedTargetMs: state.targetPlayoutMs,
        });
        if (feasibleTargetMs !== null) {
          targetMs = Math.max(targetMs, feasibleTargetMs);
        }
        const desiredBufferedFrames = Math.max(
          2,
          Math.round(targetMs / OPUS_FRAME_DURATION_MS)
        );
        const maxExtraHoldFrames =
          profile === 'collapse-recovery' || profile === 'repair-collapse'
            ? GCALL_SINGLE_SOURCE_COLLAPSE_MAX_EXTRA_HOLD_FRAMES
            : profile === 'repair-heavy-connected'
              ? GCALL_SINGLE_SOURCE_REPAIR_HEAVY_MAX_EXTRA_HOLD_FRAMES
            : GCALL_SINGLE_SOURCE_MAX_EXTRA_HOLD_FRAMES;
        const extraHoldFrames = Math.max(
          0,
          Math.min(
            maxExtraHoldFrames,
            desiredBufferedFrames - Math.max(1, state.preProcessBufferedFrames)
          )
        );
        playout.setBurstRecoveryExtraHoldFrames(extraHoldFrames);
        playout.setDynamicTargetPlayoutMs(targetMs);
        continue;
      }

      state.currentSingleSourceProfile = 'clean-low-latency';

      if (mode !== 'recovery') {
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

      let targetMs = staticTargetMs;
      if (prioritizeWeakLeg) {
        targetMs +=
          state.starvationSeverity === 'strong'
            ? GCALL_MULTI_SOURCE_TARGET_BOOST_STRONG_MS
            : GCALL_MULTI_SOURCE_TARGET_BOOST_MILD_MS;
      }
      const feasibleTargetMs = computeFeasibleMultiSourceRecoveryTargetMaxMs({
        currentAdaptiveMaxTargetMs: targetMs,
        activeSourceCount,
        adaptiveNetworkMode: mode,
        starvationSeverity: state.starvationSeverity,
        isolatedSource: prioritizeWeakLeg,
        shouldTightenRecovery: state.protectedMode || weakLegPresent,
        previousStarvationSeverity: state.starvationSeverity,
        playoutUnderTargetFraction: state.underTargetEma,
        avgPlayoutDeltaMs: state.deltaMsEma,
        avgOpusBufferedMs: state.bufferedMsEma,
        observedTargetMs: state.targetPlayoutMs,
      });
      if (feasibleTargetMs !== null) {
        targetMs = feasibleTargetMs;
      }

      const shouldHold = shouldHoldMultiSourceAccumulation({
        bufferedFrames: state.preProcessBufferedFrames,
        opusBufferedMs: state.bufferedMsEma,
        adaptiveTargetMedianMs: targetMs,
        protectedMode: state.protectedMode,
        playoutStarvationSeverity: state.starvationSeverity,
      });
      const accumulationTargetFrames =
        computeMultiSourceAccumulationTargetFrames({
          adaptiveTargetMedianMs: targetMs,
          protectedMode: state.protectedMode,
          playoutStarvationSeverity: state.starvationSeverity,
        });
      const extraHoldFrames =
        shouldHold && accumulationTargetFrames !== null
          ? Math.max(
              0,
              Math.min(
                GCALL_MULTI_SOURCE_MAX_EXTRA_HOLD_FRAMES,
                accumulationTargetFrames -
                  Math.max(1, state.preProcessBufferedFrames)
              )
            )
          : 0;

      playout.setBurstRecoveryExtraHoldFrames(extraHoldFrames);
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
      typeof message.bufferedMs === 'number' && Number.isFinite(message.bufferedMs)
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
    const underPressure = !!message.outsideBandUnder || !!message.concealmentUsed;
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
      (oldestFrameAgeMs >= GCALL_AUDIO_SURFACE_RECOVERY_SEVERE_INGRESS_AGE_MIN_MS ||
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
