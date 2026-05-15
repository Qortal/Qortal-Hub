/**
 * DM Reticulum voice inbound: same path as group — jitter buffer → (WASM Opus FEC **or**
 * WebCodecs) → `group-playout-processor`, driven by `gcall-jitter-scheduler` ticks.
 */

import type { DecodedAudioPacket } from '../group-call/audioPacketCodec';
import {
  computeStaticPlayoutTargetMsForTuning,
  postStaticPlayoutTargetForTuning,
} from '../group-call/gcallInboundPlayoutTarget';
import { JitterBuffer } from '../group-call/gcallJitterBuffer';
import { createGcallJitterBufferForIngress } from '../group-call/gcallInboundJitterSetup';
import { GcallOpusFecPlayoutPipeline } from '../group-call/gcallOpusFecPlayoutPipeline';
import {
  GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS,
  computeN1SteadyReserveMs,
  shouldHoldN1SteadyReserve,
  shouldForceN1PostStartReprime,
  shouldForceN1RecoveryPrerollSatisfied,
} from '../group-call/gcallN1PlayoutGate';
import { GCALL_GLOBAL_PLAYOUT_CAP_MS } from '../group-call/gcallPlayoutPolicy';
import { configureWebCodecsOpusDecoderForGcall } from '../group-call/configureWebCodecsOpusDecoderForGcall';
import {
  applyGcallJitterBurstHeadroom,
  createGcallJitterBurstHeadroomState,
  stepGcallJitterBurstHeadroom,
  computeSoftUnprimeMsForTier2,
  getEffectiveJitterTuning,
  getGroupCallAudioTuning,
  readGroupCallAudioProfile,
  type GroupCallAudioQualityProfile,
  type GroupCallAudioTuning,
} from '../group-call/groupCallAudioProfile';
import type { GroupCallPerformanceTracker } from '../group-call/router';
import {
  GCALL_WASM_FEC_EXTRA_HOLD_FRAMES,
  readGcallWasmFecDesired,
} from '../group-call/gcallWasmFecEnv';
import {
  OPUS_CHANNELS,
  OPUS_FRAME_DURATION_MS,
  OPUS_FRAME_SAMPLES,
  OPUS_SAMPLE_RATE,
} from '../group-call/gcallVoiceAudioConstants';
import { PerSourcePcmRing } from '../group-call/v2/perSourcePcmRing';
import type { GcallOpusFecPipelineDiagnostics } from '../group-call/gcallOpusFecPlayoutPipeline';
import OpusFecWorker from '../../workers/gcall-opus-fec.worker?worker';

export interface DmVoiceGcallPlayoutWorkletMessage {
  type?: string;
  bufferedMs?: number;
  preProcessBufferedMs?: number;
  targetPlayoutMs?: number;
  rate?: number;
  outsideBand?: boolean;
  outsideBandUnder?: boolean;
  outsideBandOver?: boolean;
  deltaMs?: number;
  oldestFrameAgeMs?: number;
  concealmentUsed?: boolean;
  playoutStarted?: boolean;
  panicZoneEntered?: boolean;
}

export interface DmVoiceGcallInboundOptions {
  /** Same tracker as group voice for playout metrics + adaptive mode. */
  metricsRef?: { current: GroupCallPerformanceTracker | null };
  /** Optional explicit quality profile instead of localStorage-backed default. */
  profile?: GroupCallAudioQualityProfile;
  /** After each jitter drain tick (aligned with group `runJitterDrainTick` tail). */
  afterDrain?: (info: { missedFramesThisTick: number }) => void;
  /** Fired after a jitter pop advances the played sequence watermark. */
  onPlayedSeqAdvanced?: (info: {
    sourceAddr: string;
    playedSeq: number;
  }) => void;
  /** `gcallPlayoutMetrics` from `group-playout-processor`. */
  onPlayoutWorkletMessage?: (d: DmVoiceGcallPlayoutWorkletMessage) => void;
  /** One sample per jitter scheduler tick for the active hidden playout path. */
  onJitterTickTelemetry?: (info: {
    sourceAddr: string;
    durationMs: number;
    bufferedFrames: number;
    hasReadyFrame: boolean;
    rawEmpty: boolean;
  }) => void;
  /** WASM FEC decode stats from the active hidden playout path. */
  onWasmFecDecodeStats?: (info: {
    sourceAddr: string;
    plcFrames: number;
    fecAttempts: number;
    fecSuccessCoarse: number;
    deferredPcmTick: boolean;
  }) => void;
  /** Current number of active remote sources on this hidden receive path. */
  getActiveSourceCount?: () => number;
}

const GCALL_READY_STALL_FORCE_PRIMED_HOLD_MS = 5_000;
const GCALL_MULTI_SOURCE_READY_STALL_MIN_BUFFERED_FRAMES = 10;
const GCALL_MULTI_SOURCE_READY_STALL_MIN_MS = 500;
const GCALL_MULTI_SOURCE_READY_STALL_RECENT_PUSH_MAX_MS = 250;
const GCALL_RECOVERY_LATENCY_SHED_MAX_FRAMES_PER_TICK = 2;
const GCALL_RECOVERY_LATENCY_SHED_TARGET_HEADROOM_FRAMES = 4;
const GCALL_RECOVERY_LATENCY_SHED_MIN_OVER_TARGET_FRAMES = 3;
const GCALL_RECOVERY_LATENCY_SHED_MIN_CAP_RATIO = 0.85;
const GCALL_RECOVERY_LATENCY_SHED_UNDERTARGET_MAX = 0.12;
const GCALL_RECOVERY_LATENCY_SHED_PLAYOUT_RATE_MIN = 0.985;
const GCALL_BURST_GAP_RECOVERY_GAP_MS = 900;
const GCALL_BURST_GAP_RECOVERY_WINDOW_MS = 1_800;
const GCALL_BURST_GAP_RECOVERY_FRAME_TRIGGER = 80;
const GCALL_BURST_GAP_RECOVERY_MIN_EXCESS_MS = 500;
const GCALL_BURST_GAP_RECOVERY_LONG_GAP_MS = 1_200;
const GCALL_BURST_GAP_RECOVERY_LONG_GAP_FRAME_TRIGGER = 48;
const GCALL_BURST_GAP_RECOVERY_LONG_GAP_MIN_EXCESS_MS = 240;
const GCALL_BURST_GAP_RECOVERY_KEEP_FRAMES = 8;
const GCALL_BURST_GAP_RECOVERY_COOLDOWN_MS = 2_500;
const GCALL_POST_BURST_LATENCY_LOCKOUT_MS = 25_000;
const GCALL_POST_BURST_LATENCY_SHED_MAX_FRAMES_PER_TICK = 4;
const GCALL_POST_BURST_LATENCY_SHED_TARGET_HEADROOM_FRAMES = 1;
const GCALL_POST_BURST_LATENCY_SHED_MIN_OVER_TARGET_FRAMES = 2;
const GCALL_POST_BURST_LOCKOUT_UNDERTARGET_MAX = 0.08;
const GCALL_POST_BURST_LOCKOUT_PLAYOUT_RATE_MIN = 0.97;
const GCALL_POST_BURST_READY_RESERVE_FRAMES = 2;
const GCALL_STARVED_BACKLOG_DRAIN_PCM_MAX_MS = 24;
const GCALL_STARVED_BACKLOG_DRAIN_MIN_FRAMES = 18;
const GCALL_STARVED_BACKLOG_DRAIN_MIN_CAP_RATIO = 0.75;
const GCALL_STARVED_BACKLOG_DRAIN_MAX_FRAMES_PER_TICK = 4;

export function shouldStartBurstGapRecoveryWatch(opts: {
  hasObservedPlayoutStart: boolean;
  gapMs: number;
  nowMs: number;
  lastRecoveryAtMs: number;
}): boolean {
  return (
    opts.hasObservedPlayoutStart &&
    opts.gapMs >= GCALL_BURST_GAP_RECOVERY_GAP_MS &&
    opts.nowMs - opts.lastRecoveryAtMs >= GCALL_BURST_GAP_RECOVERY_COOLDOWN_MS
  );
}

export function shouldCommitBurstGapRecovery(opts: {
  burstGapMs?: number;
  burstWindowAgeMs: number;
  burstFrameCount: number;
  jitterBufferedFrames: number;
  jitterMaxEntries: number;
  trimmedFramesDuringWatch: number;
  pcmStarved: boolean;
}): boolean {
  const longGap =
    Number.isFinite(opts.burstGapMs) &&
    (opts.burstGapMs ?? 0) >= GCALL_BURST_GAP_RECOVERY_LONG_GAP_MS;
  const frameTrigger = longGap
    ? GCALL_BURST_GAP_RECOVERY_LONG_GAP_FRAME_TRIGGER
    : GCALL_BURST_GAP_RECOVERY_FRAME_TRIGGER;
  const minExcessMs = longGap
    ? GCALL_BURST_GAP_RECOVERY_LONG_GAP_MIN_EXCESS_MS
    : GCALL_BURST_GAP_RECOVERY_MIN_EXCESS_MS;
  const burstAudioMs = opts.burstFrameCount * OPUS_FRAME_DURATION_MS;
  const fasterThanRealtime = burstAudioMs >= opts.burstWindowAgeMs + minExcessMs;
  const nearJitterCap =
    opts.jitterMaxEntries > 0 &&
    opts.jitterBufferedFrames >= Math.floor(opts.jitterMaxEntries * 0.8);
  const hasDamageEvidence =
    opts.trimmedFramesDuringWatch > 0 || (opts.pcmStarved && nearJitterCap);
  return (
    opts.burstWindowAgeMs <= GCALL_BURST_GAP_RECOVERY_WINDOW_MS &&
    opts.burstFrameCount >= frameTrigger &&
    fasterThanRealtime &&
    hasDamageEvidence
  );
}

export function shouldResetDecodedPlayoutStateAfterBurstGapRecovery(opts: {
  droppedFrames: number;
}): boolean {
  return opts.droppedFrames <= 0;
}

export function shouldApplyPostBurstLatencyLockout(opts: {
  nowMs: number;
  lastRecoveryAtMs: number;
  lastDroppedFrames: number;
  activeSourceCount: number;
  playoutUnderTargetFraction: number;
  avgPlayoutRate: number;
}): boolean {
  if (opts.activeSourceCount !== 1) return false;
  if (opts.lastRecoveryAtMs <= 0 || opts.lastDroppedFrames <= 0) return false;
  const ageMs = opts.nowMs - opts.lastRecoveryAtMs;
  if (ageMs < 0 || ageMs > GCALL_POST_BURST_LATENCY_LOCKOUT_MS) return false;
  const underTarget = Number.isFinite(opts.playoutUnderTargetFraction)
    ? opts.playoutUnderTargetFraction
    : 1;
  const avgPlayoutRate =
    Number.isFinite(opts.avgPlayoutRate) && opts.avgPlayoutRate > 0
      ? opts.avgPlayoutRate
      : 0;
  return (
    underTarget <= GCALL_POST_BURST_LOCKOUT_UNDERTARGET_MAX &&
    avgPlayoutRate >= GCALL_POST_BURST_LOCKOUT_PLAYOUT_RATE_MIN
  );
}

export function computePostBurstLatencyShedFrames(opts: {
  lockoutActive: boolean;
  bufferedFrames: number;
  targetPlayoutMs: number;
}): number {
  if (!opts.lockoutActive) return 0;
  if (!Number.isFinite(opts.targetPlayoutMs) || opts.targetPlayoutMs <= 0) {
    return 0;
  }
  const bufferedFrames = Math.max(
    0,
    Number.isFinite(opts.bufferedFrames) ? Math.trunc(opts.bufferedFrames) : 0
  );
  const targetFrames = Math.max(
    6,
    Math.ceil(opts.targetPlayoutMs / OPUS_FRAME_DURATION_MS) +
      GCALL_POST_BURST_LATENCY_SHED_TARGET_HEADROOM_FRAMES
  );
  const overTargetFrames = bufferedFrames - targetFrames;
  if (overTargetFrames < GCALL_POST_BURST_LATENCY_SHED_MIN_OVER_TARGET_FRAMES) {
    return 0;
  }
  return Math.min(
    GCALL_POST_BURST_LATENCY_SHED_MAX_FRAMES_PER_TICK,
    overTargetFrames
  );
}

export function computePostBurstSteadyPrimedHoldFrames(opts: {
  lockoutActive: boolean;
  activeSourceCount: number;
  defaultHoldFrames: number;
}): number {
  if (opts.lockoutActive && opts.activeSourceCount === 1) {
    return GCALL_POST_BURST_READY_RESERVE_FRAMES;
  }
  return Math.max(
    0,
    Number.isFinite(opts.defaultHoldFrames)
      ? Math.trunc(opts.defaultHoldFrames)
      : 0
  );
}

export function computeStarvedBacklogDrainBudget(opts: {
  hasReadyFrame: boolean;
  bufferedFrames: number;
  maxEntries: number;
  playoutBufferedMs: number;
  preProcessBufferedMs: number;
  outsideBandUnder: boolean;
  concealmentUsed: boolean;
}): number {
  if (!opts.hasReadyFrame || opts.bufferedFrames <= 1) return 1;
  if (!Number.isFinite(opts.maxEntries) || opts.maxEntries <= 0) return 1;
  const nearCapThreshold = Math.max(
    GCALL_STARVED_BACKLOG_DRAIN_MIN_FRAMES,
    Math.floor(opts.maxEntries * GCALL_STARVED_BACKLOG_DRAIN_MIN_CAP_RATIO)
  );
  if (opts.bufferedFrames < nearCapThreshold) return 1;
  const pcmBufferedMs = Math.max(
    Number.isFinite(opts.playoutBufferedMs) ? opts.playoutBufferedMs : 0,
    Number.isFinite(opts.preProcessBufferedMs) ? opts.preProcessBufferedMs : 0
  );
  if (pcmBufferedMs > GCALL_STARVED_BACKLOG_DRAIN_PCM_MAX_MS) return 1;
  if (!opts.outsideBandUnder && !opts.concealmentUsed && pcmBufferedMs > 0) {
    return 1;
  }
  const overThresholdFrames = Math.max(1, opts.bufferedFrames - nearCapThreshold);
  return Math.min(
    GCALL_STARVED_BACKLOG_DRAIN_MAX_FRAMES_PER_TICK,
    Math.max(2, Math.ceil(overThresholdFrames / 4) + 1)
  );
}

export function decideReadyStallForcePrime(opts: {
  hasObservedPlayoutStart: boolean;
  activeSourceCount: number;
  hasReadyFrame: boolean;
  bufferedFrames: number;
  stallSinceMs: number | null;
  nowMs: number;
  lastPushAgeMs: number;
  targetPlayoutMs: number;
}): { shouldForcePrime: boolean; nextStallSinceMs: number | null } {
  if (opts.hasReadyFrame || opts.bufferedFrames <= 0) {
    return { shouldForcePrime: false, nextStallSinceMs: null };
  }
  if (opts.stallSinceMs === null) {
    return { shouldForcePrime: false, nextStallSinceMs: opts.nowMs };
  }
  const blockedForMs = Math.max(0, opts.nowMs - opts.stallSinceMs);
  if (opts.activeSourceCount >= 2) {
    const hasRecentPush =
      Number.isFinite(opts.lastPushAgeMs) &&
      opts.lastPushAgeMs <= GCALL_MULTI_SOURCE_READY_STALL_RECENT_PUSH_MAX_MS;
    const hasSubstantialFreshPreroll =
      opts.bufferedFrames >=
        GCALL_MULTI_SOURCE_READY_STALL_MIN_BUFFERED_FRAMES && hasRecentPush;
    const shouldForcePrime =
      hasSubstantialFreshPreroll &&
      blockedForMs >= GCALL_MULTI_SOURCE_READY_STALL_MIN_MS;
    return {
      shouldForcePrime,
      nextStallSinceMs: shouldForcePrime
        ? null
        : hasSubstantialFreshPreroll
          ? opts.stallSinceMs
          : null,
    };
  }
  if (opts.activeSourceCount !== 1) {
    return { shouldForcePrime: false, nextStallSinceMs: null };
  }
  const opusBufferedMs = opts.bufferedFrames * 20;
  const shouldForcePrime = opts.hasObservedPlayoutStart
    ? shouldForceN1PostStartReprime({
        blockedForMs,
        lastPushAgeMs: opts.lastPushAgeMs,
        opusBufferedMs,
        sourceActive: true,
        targetMs: opts.targetPlayoutMs,
      })
    : shouldForceN1RecoveryPrerollSatisfied({
        blockedForMs,
        lastPushAgeMs: opts.lastPushAgeMs,
        opusBufferedMs,
        sourceActive: true,
        targetMs: opts.targetPlayoutMs,
      });
  return {
    shouldForcePrime,
    nextStallSinceMs: shouldForcePrime ? null : opts.stallSinceMs,
  };
}

export function computeN1SteadyPrimedHoldFrames(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  hasObservedPlayoutStart: boolean;
  hasReadyFrame: boolean;
  bufferedFrames: number;
  lastPushAgeMs: number;
  targetPlayoutMs: number;
}): number {
  if (opts.activeSourceCount !== 1) return 0;
  if (opts.adaptiveNetworkMode !== 'recovery') return 1;
  if (!opts.hasObservedPlayoutStart) return 0;
  const reserveMs = computeN1SteadyReserveMs(opts.targetPlayoutMs);
  const sourceRecentlyPushed =
    Number.isFinite(opts.lastPushAgeMs) &&
    opts.lastPushAgeMs <= GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS;
  return shouldHoldN1SteadyReserve({
    steadySingleRemote: true,
    sourceRecentlyPushed,
    hasReadyFrame: opts.hasReadyFrame,
    opusBufferedMs: opts.bufferedFrames * 20,
    reserveMs,
  })
    ? 1
    : 0;
}

function disconnectSafe(node: AudioNode | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}

/**
 * One remote peer, one jitter buffer, one decode path (WASM FEC or WebCodecs), one playout worklet.
 */
export class DmVoiceGcallInboundPlayout {
  private jitter: JitterBuffer | null = null;
  private decoder: AudioDecoder | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private schedulerNode: AudioWorkletNode | null = null;
  private schedulerGain: GainNode | null = null;
  private speakerGain: GainNode | null = null;
  private pcmRing: PerSourcePcmRing | null = null;
  private workletsLoadedForContext: WeakMap<AudioContext, Promise<void>> =
    new WeakMap();

  private peerAddress = '';
  private tuning: GroupCallAudioTuning | null = null;
  private fecPipeline: GcallOpusFecPlayoutPipeline | null = null;
  private opusFecWorker: Worker | null = null;
  private wasmFecActive = false;
  private callbacks: DmVoiceGcallInboundOptions | null = null;
  /** Last applied `metrics.adaptiveNetworkMode` for jitter geometry. */
  private lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null = null;
  private forcedJitterAdaptiveMode: 'low-latency' | 'recovery' | null = null;
  private lastJitterActiveSourceCount = 1;
  private lastPostedTargetPlayoutMs: number | null = null;
  private pendingDecodedIngressAtMs: Array<number | null> = [];
  private lastDrainMetricSampleAtMs = 0;
  private startupReadyStallSinceMs: number | null = null;
  private hasObservedPlayoutStart = false;
  private lastPushAtPerfMs: number | null = null;
  private jitterPushAccepted = 0;
  private jitterPushStale = 0;
  private jitterPushDuplicate = 0;
  private jitterPushTrimmedFrames = 0;
  private jitterPushTrimEvents = 0;
  private jitterPushDepthHighWater = 0;
  private jitterPushDepthHighWaterSinceLastHeadroomStep = 0;
  private jitterLastTrimmedFrames = 0;
  private jitterLastTrimAtMs = 0;
  private jitterTrimmedFramesAtLastHeadroomStep = 0;
  private jitterBurstHeadroomState = createGcallJitterBurstHeadroomState();
  private lastJitterBurstHeadroomReason: string | null = null;
  private lastDecodedPushWallMs = 0;
  private burstGapWatchStartedAtMs = 0;
  private burstGapWatchFrames = 0;
  private burstGapWatchGapMs = 0;
  private burstGapWatchTrimmedFramesStart = 0;
  private burstGapResetCount = 0;
  private burstGapRecoveryCount = 0;
  private burstGapDroppedFrames = 0;
  private lastBurstGapMs = 0;
  private lastBurstGapFrames = 0;
  private lastBurstGapDroppedFrames = 0;
  private lastBurstGapResetAtMs = 0;
  private postBurstLatencyLockoutUntilMs = 0;
  private postBurstLatencyShedFrames = 0;
  private lastPostBurstLatencyShedAtMs = 0;
  private lastPostBurstLatencyShedFrames = 0;
  private latestPlayoutBufferedMs = 0;
  private latestPreProcessBufferedMs = 0;
  private latestPlayoutOutsideBandUnder = false;
  private latestPlayoutConcealmentUsed = false;
  private starvedBacklogDrainCount = 0;
  private starvedBacklogDrainFrames = 0;
  private lastStarvedBacklogDrainAtMs = 0;
  private lastStarvedBacklogDrainFrames = 0;
  private jitterDrainReadyTicks = 0;
  private jitterDrainReadyNoPopTicks = 0;
  private jitterDrainPoppedFrames = 0;
  private lastJitterDrainBudget = 0;
  private lastJitterDrainPoppedFrames = 0;
  private pcmPostAcceptedFrames = 0;
  private pcmPostRejectedFrames = 0;
  private pcmPostOverrunCount = 0;
  private lastPcmPostRejectedAtMs = 0;

  private resolveActiveSourceCount(): number {
    const n = this.callbacks?.getActiveSourceCount?.() ?? 1;
    return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  }

  private async ensureWebCodecsDecoder(): Promise<void> {
    if (this.decoder && this.decoder.state !== 'closed') return;
    const tuning = this.tuning;
    const node = this.playbackNode;
    if (!tuning || !node) return;
    const AudioDecoderCtor = globalThis.AudioDecoder;
    if (!AudioDecoderCtor) {
      throw new Error('AudioDecoder unavailable');
    }
    const decoder = new AudioDecoderCtor({
      output: (audioData: AudioData) => {
        const pcm = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        audioData.close();
        const ingressAtMs =
          this.pendingDecodedIngressAtMs.length > 0
            ? (this.pendingDecodedIngressAtMs.shift() ?? null)
            : null;
        this.pushPcmToPlayout(pcm, ingressAtMs);
      },
      error: (e: Error) => {
        console.error('[DM voice] inbound AudioDecoder:', e);
      },
    });
    await configureWebCodecsOpusDecoderForGcall(decoder, tuning, {
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
    });
    this.decoder = decoder;
  }

  private fallbackFromWasmFecToWebCodecs(reason: string): void {
    if (!this.wasmFecActive && this.decoder) return;
    this.wasmFecActive = false;
    if (this.opusFecWorker) {
      try {
        this.opusFecWorker.terminate();
      } catch {
        /* ignore */
      }
      this.opusFecWorker = null;
    }
    this.fecPipeline = null;
    void this.ensureWebCodecsDecoder().catch((error) => {
      console.error(
        '[DM voice] WebCodecs fallback failed after WASM FEC error',
        {
          reason,
          message: error instanceof Error ? error.message : String(error),
        }
      );
    });
  }

  getPlaybackWorkletNode(): AudioWorkletNode | null {
    return this.playbackNode;
  }

  getDiagnosticsSnapshot(): {
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
    postBurstLatencyLockoutActive: boolean;
    postBurstLatencyLockoutUntilMs: number;
    postBurstLatencyShedFrames: number;
    lastPostBurstLatencyShedAtMs: number;
    lastPostBurstLatencyShedFrames: number;
    burstGapResetCount: number;
    burstGapRecoveryCount: number;
    burstGapDroppedFrames: number;
    lastBurstGapMs: number;
    lastBurstGapFrames: number;
    lastBurstGapDroppedFrames: number;
    lastBurstGapResetAtMs: number;
    starvedBacklogDrainCount: number;
    starvedBacklogDrainFrames: number;
    lastStarvedBacklogDrainAtMs: number;
    lastStarvedBacklogDrainFrames: number;
    jitterDrainReadyTicks: number;
    jitterDrainReadyNoPopTicks: number;
    jitterDrainPoppedFrames: number;
    lastJitterDrainBudget: number;
    lastJitterDrainPoppedFrames: number;
    pcmPostAcceptedFrames: number;
    pcmPostRejectedFrames: number;
    pcmPostOverrunCount: number;
    lastPcmPostRejectedAtMs: number;
    wasmFecPipelineDiagnostics: GcallOpusFecPipelineDiagnostics | null;
    playbackNodeActive: boolean;
    schedulerNodeActive: boolean;
    lastJitterAdaptiveMode: 'low-latency' | 'recovery' | null;
  } {
    this.syncJitterGeometryFromMetrics(false);
    return {
      peerAddress: this.peerAddress,
      decodePath: this.wasmFecActive
        ? 'wasm-fec'
        : this.decoder
          ? 'webcodecs'
          : 'uninitialized',
      wasmFecActive: this.wasmFecActive,
      hasOpusFecWorker: this.opusFecWorker !== null,
      hasWebCodecsDecoder: this.decoder !== null,
      decoderState: this.decoder?.state ?? null,
      hasSharedPcmRing: this.pcmRing !== null,
      sharedRingEnabled: this.pcmRing !== null,
      jitterActive: this.jitter !== null,
      jitterBufferedFrames: this.jitter?.getBufferedFrames() ?? 0,
      jitterHasReadyFrame: this.jitter?.hasReadyFrame() ?? false,
      jitterMaxEntries: this.jitter?.getMaxEntries() ?? 0,
      jitterPushAccepted: this.jitterPushAccepted,
      jitterPushStale: this.jitterPushStale,
      jitterPushDuplicate: this.jitterPushDuplicate,
      jitterPushTrimmedFrames: this.jitterPushTrimmedFrames,
      jitterPushTrimEvents: this.jitterPushTrimEvents,
      jitterPushDepthHighWater: this.jitterPushDepthHighWater,
      jitterLastTrimmedFrames: this.jitterLastTrimmedFrames,
      jitterLastTrimAtMs: this.jitterLastTrimAtMs,
      jitterBurstHeadroomLevel: this.jitterBurstHeadroomState.level,
      jitterBurstHeadroomHoldUntilMs: this.jitterBurstHeadroomState.holdUntilMs,
      jitterBurstHeadroomReason: this.lastJitterBurstHeadroomReason,
      postBurstLatencyLockoutActive:
        Date.now() < this.postBurstLatencyLockoutUntilMs,
      postBurstLatencyLockoutUntilMs: this.postBurstLatencyLockoutUntilMs,
      postBurstLatencyShedFrames: this.postBurstLatencyShedFrames,
      lastPostBurstLatencyShedAtMs: this.lastPostBurstLatencyShedAtMs,
      lastPostBurstLatencyShedFrames: this.lastPostBurstLatencyShedFrames,
      burstGapResetCount: this.burstGapResetCount,
      burstGapRecoveryCount: this.burstGapRecoveryCount,
      burstGapDroppedFrames: this.burstGapDroppedFrames,
      lastBurstGapMs: this.lastBurstGapMs,
      lastBurstGapFrames: this.lastBurstGapFrames,
      lastBurstGapDroppedFrames: this.lastBurstGapDroppedFrames,
      lastBurstGapResetAtMs: this.lastBurstGapResetAtMs,
      starvedBacklogDrainCount: this.starvedBacklogDrainCount,
      starvedBacklogDrainFrames: this.starvedBacklogDrainFrames,
      lastStarvedBacklogDrainAtMs: this.lastStarvedBacklogDrainAtMs,
      lastStarvedBacklogDrainFrames: this.lastStarvedBacklogDrainFrames,
      jitterDrainReadyTicks: this.jitterDrainReadyTicks,
      jitterDrainReadyNoPopTicks: this.jitterDrainReadyNoPopTicks,
      jitterDrainPoppedFrames: this.jitterDrainPoppedFrames,
      lastJitterDrainBudget: this.lastJitterDrainBudget,
      lastJitterDrainPoppedFrames: this.lastJitterDrainPoppedFrames,
      pcmPostAcceptedFrames: this.pcmPostAcceptedFrames,
      pcmPostRejectedFrames: this.pcmPostRejectedFrames,
      pcmPostOverrunCount: this.pcmPostOverrunCount,
      lastPcmPostRejectedAtMs: this.lastPcmPostRejectedAtMs,
      wasmFecPipelineDiagnostics:
        this.fecPipeline?.getDiagnostics(this.peerAddress) ?? null,
      playbackNodeActive: this.playbackNode !== null,
      schedulerNodeActive: this.schedulerNode !== null,
      lastJitterAdaptiveMode: this.lastJitterAdaptiveMode,
    };
  }

  syncAdaptiveJitterGeometry(): void {
    this.syncJitterGeometryFromMetrics();
  }

  setForcedAdaptiveJitterMode(mode: 'low-latency' | 'recovery' | null): void {
    if (this.forcedJitterAdaptiveMode === mode) return;
    this.forcedJitterAdaptiveMode = mode;
    this.syncJitterGeometryFromMetrics(false);
  }

  setDynamicTargetPlayoutMs(targetPlayoutMs: number): void {
    const node = this.playbackNode;
    if (!node || !Number.isFinite(targetPlayoutMs)) return;
    const rounded = Math.max(40, Math.round(targetPlayoutMs));
    if (this.lastPostedTargetPlayoutMs === rounded) return;
    this.lastPostedTargetPlayoutMs = rounded;
    node.port.postMessage({
      type: 'target',
      targetPlayoutMs: rounded,
    });
  }

  resetDynamicTargetPlayoutMs(): void {
    const tuning = this.tuning;
    if (!tuning) return;
    this.setDynamicTargetPlayoutMs(
      computeStaticPlayoutTargetMsForTuning(tuning)
    );
  }

  setBurstRecoveryExtraHoldFrames(frames: number): number {
    return this.jitter?.setBurstRecoveryExtraHoldFrames(frames) ?? 0;
  }

  private canUseSharedPcmRing(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
  }

  private pushPcmToPlayout(
    pcm: Float32Array,
    ingressAtMs: number | null = null
  ): boolean {
    const frameCount = Math.max(0, Math.floor(pcm.length / OPUS_FRAME_SAMPLES));
    const ring = this.pcmRing;
    if (ring) {
      const overrunsBefore = ring.overruns;
      ring.write(pcm, { ingressAtMs });
      this.pcmPostAcceptedFrames += frameCount;
      this.pcmPostOverrunCount += Math.max(0, ring.overruns - overrunsBefore);
      return true;
    }
    const currentNode = this.playbackNode;
    if (!currentNode) {
      this.pcmPostRejectedFrames += frameCount;
      this.lastPcmPostRejectedAtMs = Date.now();
      return false;
    }
    if (
      typeof ingressAtMs === 'number' &&
      Number.isFinite(ingressAtMs) &&
      this.callbacks?.metricsRef?.current
    ) {
      this.callbacks.metricsRef.current.recordReceiverIngressToPlayoutPostLatency(
        this.peerAddress,
        Math.max(0, Date.now() - ingressAtMs)
      );
    }
    const copy = new Float32Array(pcm.length);
    copy.set(pcm);
    currentNode.port.postMessage({ pcm: copy }, [copy.buffer]);
    this.pcmPostAcceptedFrames += frameCount;
    return true;
  }

  /**
   * Wire capture-time AudioContext: scheduler + playout + decode to `connectTo` (e.g. remote gain).
   */
  async start(
    ctx: AudioContext,
    peerAddress: string,
    connectTo: AudioNode,
    options?: DmVoiceGcallInboundOptions
  ): Promise<void> {
    await this.stop();

    this.callbacks = options ?? null;
    this.lastJitterAdaptiveMode = null;
    this.startupReadyStallSinceMs = null;
    this.hasObservedPlayoutStart = false;
    this.lastPushAtPerfMs = null;
    this.resetJitterPushDiagnostics();
    this.peerAddress = peerAddress;
    const tuning = getGroupCallAudioTuning(
      options?.profile ?? readGroupCallAudioProfile()
    );
    this.tuning = tuning;

    const fecDesired = readGcallWasmFecDesired();
    this.jitter = createGcallJitterBufferForIngress({
      tuning,
      adaptiveNetworkMode: 'low-latency',
      extraHoldFrames: fecDesired ? GCALL_WASM_FEC_EXTRA_HOLD_FRAMES : 0,
      activeSourceCount: this.resolveActiveSourceCount(),
      tier2MultiSource: true,
      applySteadyPrimedHoldNow: true,
    });

    let load = this.workletsLoadedForContext.get(ctx);
    if (!load) {
      load = Promise.all([
        ctx.audioWorklet.addModule('/worklets/gcall-jitter-scheduler.js'),
        ctx.audioWorklet.addModule('/worklets/group-playout-processor.js'),
      ]).then(() => {});
      this.workletsLoadedForContext.set(ctx, load);
    }
    await load;

    const pcmRing = this.canUseSharedPcmRing()
      ? new PerSourcePcmRing({ sampleRateHz: OPUS_SAMPLE_RATE })
      : null;
    const playNode = new AudioWorkletNode(ctx, 'group-playout-processor', {
      processorOptions: {
        sourceAddr: peerAddress,
        maxPlayoutTargetMs: GCALL_GLOBAL_PLAYOUT_CAP_MS,
        ...(pcmRing
          ? {
              sharedRing: pcmRing.getSharedBridgeConfig(),
            }
          : {}),
      },
    } as AudioWorkletNodeOptions);

    postStaticPlayoutTargetForTuning(playNode, tuning);
    this.lastPostedTargetPlayoutMs =
      computeStaticPlayoutTargetMsForTuning(tuning);

    playNode.port.onmessage = (e: MessageEvent) => {
      const d = e.data as DmVoiceGcallPlayoutWorkletMessage;
      if (d?.type !== 'gcallPlayoutMetrics') return;
      if (Number.isFinite(d.bufferedMs)) {
        this.latestPlayoutBufferedMs = Math.max(0, d.bufferedMs ?? 0);
      }
      if (Number.isFinite(d.preProcessBufferedMs)) {
        this.latestPreProcessBufferedMs = Math.max(
          0,
          d.preProcessBufferedMs ?? 0
        );
      }
      this.latestPlayoutOutsideBandUnder = d.outsideBandUnder === true;
      this.latestPlayoutConcealmentUsed = d.concealmentUsed === true;
      if (d.playoutStarted) {
        this.hasObservedPlayoutStart = true;
        this.startupReadyStallSinceMs = null;
      }
      this.callbacks?.onPlayoutWorkletMessage?.(d);
    };

    const speakerGain = ctx.createGain();
    speakerGain.gain.value = 1;
    playNode.connect(speakerGain);
    speakerGain.connect(connectTo);

    this.playbackNode = playNode;
    this.pcmRing = pcmRing;

    if (fecDesired) {
      this.fecPipeline = new GcallOpusFecPlayoutPipeline(
        (addr) =>
          addr === this.peerAddress
            ? (this.playbackNode ?? undefined)
            : undefined,
        (addr, stats) => {
          this.callbacks?.metricsRef?.current?.recordWasmFecDecodeStats(
            addr,
            stats
          );
          this.callbacks?.onWasmFecDecodeStats?.({
            sourceAddr: addr,
            ...stats,
          });
        },
        (addr, pcmBatch, _frameCount, ingressAtMs) => {
          if (addr !== this.peerAddress) return false;
          return this.pushPcmToPlayout(pcmBatch, ingressAtMs);
        }
      );
      try {
        const w = new OpusFecWorker();
        w.onmessage = (
          ev: MessageEvent<
            | {
                type: 'decoded';
                sourceAddr: string;
                pcm: Float32Array;
                frameCount: number;
                stats: {
                  plcFrames: number;
                  fecAttempts: number;
                  fecSuccessCoarse: number;
                };
              }
            | { type: 'error'; sourceAddr?: string; message: string }
          >
        ) => {
          const d = ev.data;
          if (d.type === 'error') {
            console.error('[DM voice] opus-fec worker:', d.message);
            this.fallbackFromWasmFecToWebCodecs('worker-message-error');
            return;
          }
          if (d.type !== 'decoded' || !this.fecPipeline || !this.opusFecWorker)
            return;
          const ingressAtMs = this.fecPipeline.consumeInflightIngressAtMs(
            d.sourceAddr
          );
          this.fecPipeline.completeInflight(d.sourceAddr);
          this.fecPipeline.postBatch(
            d.sourceAddr,
            d.pcm,
            d.frameCount,
            d.stats,
            true,
            ingressAtMs
          );
          this.fecPipeline.pump(this.opusFecWorker, d.sourceAddr);
        };
        w.onerror = (err) => {
          console.error('[DM voice] opus-fec worker error', err);
          this.fallbackFromWasmFecToWebCodecs('worker-onerror');
        };
        this.opusFecWorker = w;
        this.wasmFecActive = true;
      } catch (error) {
        console.error('[DM voice] opus-fec worker init failed', error);
        this.fallbackFromWasmFecToWebCodecs('worker-init');
      }
    } else {
      await this.ensureWebCodecsDecoder();
      this.wasmFecActive = false;
    }

    const jitterSched = new AudioWorkletNode(ctx, 'gcall-jitter-scheduler');
    jitterSched.port.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type !== 'tick') return;
      const tickStartedAt = performance.now();
      this.syncJitterGeometryFromMetrics(true);
      const jb = this.jitter;
      let missedFramesThisTick = 0;
      if (!jb) {
        this.callbacks?.afterDrain?.({ missedFramesThisTick: 0 });
        return;
      }
      const activeSourceCount = this.resolveActiveSourceCount();
      const targetPlayoutMs =
        this.lastPostedTargetPlayoutMs ??
        computeStaticPlayoutTargetMsForTuning(tuning);
      const lastPushAgeMs =
        this.lastPushAtPerfMs === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, tickStartedAt - this.lastPushAtPerfMs);
      const bufferedFrames = jb.getBufferedFrames();
      const metricsSnapshot = this.callbacks?.metricsRef?.current?.getSnapshot();
      const postBurstLatencyLockoutActive = metricsSnapshot
        ? shouldApplyPostBurstLatencyLockout({
            nowMs: Date.now(),
            lastRecoveryAtMs: this.lastBurstGapResetAtMs,
            lastDroppedFrames: this.lastBurstGapDroppedFrames,
            activeSourceCount,
            playoutUnderTargetFraction:
              metricsSnapshot.playoutUnderTargetFraction,
            avgPlayoutRate: metricsSnapshot.avgPlayoutRate,
          })
        : false;
      const n1SteadyHoldFrames = computeN1SteadyPrimedHoldFrames({
        activeSourceCount,
        adaptiveNetworkMode: this.lastJitterAdaptiveMode ?? 'low-latency',
        hasObservedPlayoutStart: this.hasObservedPlayoutStart,
        hasReadyFrame: jb.hasReadyFrame(),
        bufferedFrames,
        lastPushAgeMs,
        targetPlayoutMs,
      });
      jb.setSteadyPrimedHoldFrames(
        computePostBurstSteadyPrimedHoldFrames({
          lockoutActive: postBurstLatencyLockoutActive,
          activeSourceCount,
          defaultHoldFrames: n1SteadyHoldFrames,
        })
      );
      const shedFrames = this.shedRecoveredJitterLatency({
        bufferedFrames,
        targetPlayoutMs,
      });
      const effectiveBufferedFrames =
        shedFrames > 0 ? jb.getBufferedFrames() : bufferedFrames;
      let hasReadyFrame = jb.hasReadyFrame();
      if (!hasReadyFrame) {
        const readyStallForcePrime = decideReadyStallForcePrime({
          hasObservedPlayoutStart: this.hasObservedPlayoutStart,
          activeSourceCount,
          hasReadyFrame,
          bufferedFrames: effectiveBufferedFrames,
          stallSinceMs: this.startupReadyStallSinceMs,
          nowMs: tickStartedAt,
          lastPushAgeMs,
          targetPlayoutMs,
        });
        this.startupReadyStallSinceMs = readyStallForcePrime.nextStallSinceMs;
        if (readyStallForcePrime.shouldForcePrime) {
          const preserveBurstRecoveryHold =
            this.jitterBurstHeadroomState.level > 0;
          jb.forcePrimeForRecoveryEscape(
            GCALL_READY_STALL_FORCE_PRIMED_HOLD_MS,
            { clearBurstRecoveryHold: !preserveBurstRecoveryHold }
          );
          hasReadyFrame = jb.hasReadyFrame();
        }
      } else {
        this.startupReadyStallSinceMs = null;
      }
      if (!hasReadyFrame) {
        missedFramesThisTick = 0;
      } else {
        if (this.wasmFecActive && this.fecPipeline && this.opusFecWorker) {
          this.fecPipeline.clearPostedThisTick();
          this.fecPipeline.prefetchDeferredForAllSources([this.peerAddress]);
        }
        const drainBudget = computeStarvedBacklogDrainBudget({
          hasReadyFrame,
          bufferedFrames: jb.getBufferedFrames(),
          maxEntries: jb.getMaxEntries(),
          playoutBufferedMs: this.latestPlayoutBufferedMs,
          preProcessBufferedMs: this.latestPreProcessBufferedMs,
          outsideBandUnder: this.latestPlayoutOutsideBandUnder,
          concealmentUsed: this.latestPlayoutConcealmentUsed,
        });
        this.jitterDrainReadyTicks++;
        this.lastJitterDrainBudget = drainBudget;
        let drainedFramesThisTick = 0;
        for (let i = 0; i < drainBudget; i++) {
          if (!jb.hasReadyFrame()) break;
          const beforeDrainFrames = jb.getBufferedFrames();
          const missed = this.drainOneFrame();
          const afterDrainFrames = jb.getBufferedFrames();
          if (afterDrainFrames >= beforeDrainFrames) break;
          missedFramesThisTick += missed;
          drainedFramesThisTick++;
        }
        this.lastJitterDrainPoppedFrames = drainedFramesThisTick;
        if (drainedFramesThisTick === 0) {
          this.jitterDrainReadyNoPopTicks++;
        }
        if (drainedFramesThisTick > 1) {
          this.starvedBacklogDrainCount++;
          this.starvedBacklogDrainFrames += drainedFramesThisTick - 1;
          this.lastStarvedBacklogDrainFrames = drainedFramesThisTick;
          this.lastStarvedBacklogDrainAtMs = Date.now();
        }
      }
      const tickFinishedAt = performance.now();
      if (
        tickFinishedAt - this.lastDrainMetricSampleAtMs >=
        (OPUS_FRAME_SAMPLES / OPUS_SAMPLE_RATE) * 1000
      ) {
        this.lastDrainMetricSampleAtMs = tickFinishedAt;
        this.callbacks?.metricsRef?.current?.recordJitterTickDuration(
          tickFinishedAt - tickStartedAt
        );
        if (!this.pcmRing) {
          this.callbacks?.metricsRef?.current?.recordJitterDrainTelemetry({
            sourceCount: 1,
            depthSum: effectiveBufferedFrames,
            worstDepth: effectiveBufferedFrames,
            notReadyCount: hasReadyFrame ? 0 : 1,
            rawEmptyCount: effectiveBufferedFrames === 0 ? 1 : 0,
          });
        }
        if (!hasReadyFrame && !this.pcmRing) {
          this.callbacks?.metricsRef?.current?.recordJitterUnderrun(
            1,
            this.peerAddress
          );
        }
      }
      this.callbacks?.onJitterTickTelemetry?.({
        sourceAddr: this.peerAddress,
        durationMs: tickFinishedAt - tickStartedAt,
        bufferedFrames: effectiveBufferedFrames,
        hasReadyFrame,
        rawEmpty: effectiveBufferedFrames === 0,
      });
      this.callbacks?.afterDrain?.({ missedFramesThisTick });
    };
    const jitterSchedGain = ctx.createGain();
    jitterSchedGain.gain.value = 0.0001;
    jitterSched.connect(jitterSchedGain);
    jitterSchedGain.connect(ctx.destination);

    this.schedulerNode = jitterSched;
    this.schedulerGain = jitterSchedGain;
    this.speakerGain = speakerGain;
  }

  private resetJitterPushDiagnostics(): void {
    this.jitterPushAccepted = 0;
    this.jitterPushStale = 0;
    this.jitterPushDuplicate = 0;
    this.jitterPushTrimmedFrames = 0;
    this.jitterPushTrimEvents = 0;
    this.jitterPushDepthHighWater = 0;
    this.jitterPushDepthHighWaterSinceLastHeadroomStep = 0;
    this.jitterLastTrimmedFrames = 0;
    this.jitterLastTrimAtMs = 0;
    this.jitterTrimmedFramesAtLastHeadroomStep = 0;
    this.jitterBurstHeadroomState = createGcallJitterBurstHeadroomState();
    this.lastJitterBurstHeadroomReason = null;
    this.lastDecodedPushWallMs = 0;
    this.burstGapWatchStartedAtMs = 0;
    this.burstGapWatchFrames = 0;
    this.burstGapWatchGapMs = 0;
    this.burstGapWatchTrimmedFramesStart = 0;
    this.burstGapResetCount = 0;
    this.burstGapRecoveryCount = 0;
    this.burstGapDroppedFrames = 0;
    this.lastBurstGapMs = 0;
    this.lastBurstGapFrames = 0;
    this.lastBurstGapDroppedFrames = 0;
    this.lastBurstGapResetAtMs = 0;
    this.postBurstLatencyLockoutUntilMs = 0;
    this.postBurstLatencyShedFrames = 0;
    this.lastPostBurstLatencyShedAtMs = 0;
    this.lastPostBurstLatencyShedFrames = 0;
    this.latestPlayoutBufferedMs = 0;
    this.latestPreProcessBufferedMs = 0;
    this.latestPlayoutOutsideBandUnder = false;
    this.latestPlayoutConcealmentUsed = false;
    this.starvedBacklogDrainCount = 0;
    this.starvedBacklogDrainFrames = 0;
    this.lastStarvedBacklogDrainAtMs = 0;
    this.lastStarvedBacklogDrainFrames = 0;
    this.jitterDrainReadyTicks = 0;
    this.jitterDrainReadyNoPopTicks = 0;
    this.jitterDrainPoppedFrames = 0;
    this.lastJitterDrainBudget = 0;
    this.lastJitterDrainPoppedFrames = 0;
    this.pcmPostAcceptedFrames = 0;
    this.pcmPostRejectedFrames = 0;
    this.pcmPostOverrunCount = 0;
    this.lastPcmPostRejectedAtMs = 0;
  }

  private resetDecodedPlayoutStateForBurstGap(): void {
    this.pendingDecodedIngressAtMs = [];
    this.pcmRing?.reset();
    this.playbackNode?.port.postMessage({ type: 'reset' });
    if (this.wasmFecActive && this.opusFecWorker) {
      this.opusFecWorker.postMessage({
        type: 'reset',
        sourceAddr: this.peerAddress,
      });
    }
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.reset();
      } catch {
        /* ignore */
      }
    }
  }

  private noteDecodedBurstGapBeforePush(nowMs: number): void {
    if (this.lastDecodedPushWallMs <= 0) return;
    const gapMs = nowMs - this.lastDecodedPushWallMs;
    if (
      !shouldStartBurstGapRecoveryWatch({
        hasObservedPlayoutStart: this.hasObservedPlayoutStart,
        gapMs,
        nowMs,
        lastRecoveryAtMs: this.lastBurstGapResetAtMs,
      })
    ) {
      return;
    }
    this.burstGapWatchStartedAtMs = nowMs;
    this.burstGapWatchFrames = 0;
    this.burstGapWatchGapMs = gapMs;
    this.burstGapWatchTrimmedFramesStart = this.jitterPushTrimmedFrames;
    this.burstGapResetCount++;
    this.lastBurstGapMs = gapMs;
    this.lastJitterBurstHeadroomReason = 'burst-gap-watch';
  }

  private maybeCommitBurstGapRecovery(nowMs: number): void {
    const jb = this.jitter;
    if (!jb || this.burstGapWatchStartedAtMs <= 0) return;
    const windowAgeMs = nowMs - this.burstGapWatchStartedAtMs;
    if (windowAgeMs > GCALL_BURST_GAP_RECOVERY_WINDOW_MS) {
      this.burstGapWatchStartedAtMs = 0;
      this.burstGapWatchFrames = 0;
      this.burstGapWatchGapMs = 0;
      this.burstGapWatchTrimmedFramesStart = 0;
      return;
    }
    const pcmBufferedMs = Math.max(
      this.latestPlayoutBufferedMs,
      this.latestPreProcessBufferedMs
    );
    if (
      !shouldCommitBurstGapRecovery({
        burstGapMs: this.burstGapWatchGapMs,
        burstWindowAgeMs: windowAgeMs,
        burstFrameCount: this.burstGapWatchFrames,
        jitterBufferedFrames: jb.getBufferedFrames(),
        jitterMaxEntries: jb.getMaxEntries(),
        trimmedFramesDuringWatch: Math.max(
          0,
          this.jitterPushTrimmedFrames - this.burstGapWatchTrimmedFramesStart
        ),
        pcmStarved:
          pcmBufferedMs <= GCALL_STARVED_BACKLOG_DRAIN_PCM_MAX_MS &&
          (this.latestPlayoutOutsideBandUnder ||
            this.latestPlayoutConcealmentUsed),
      })
    ) {
      return;
    }
    const keepFrames = Math.max(1, GCALL_BURST_GAP_RECOVERY_KEEP_FRAMES);
    const dropFrames = Math.max(0, jb.getBufferedFrames() - keepFrames);
    const dropped = dropFrames > 0 ? jb.discardOldest(dropFrames) : 0;
    this.burstGapRecoveryCount++;
    this.burstGapDroppedFrames += dropped;
    this.lastBurstGapFrames = this.burstGapWatchFrames;
    this.lastBurstGapDroppedFrames = dropped;
    this.lastBurstGapMs = this.burstGapWatchGapMs;
    this.lastBurstGapResetAtMs = nowMs;
    if (dropped > 0) {
      this.postBurstLatencyLockoutUntilMs =
        nowMs + GCALL_POST_BURST_LATENCY_LOCKOUT_MS;
    }
    const shouldResetDecodedPlayout =
      shouldResetDecodedPlayoutStateAfterBurstGapRecovery({
        droppedFrames: dropped,
      });
    if (shouldResetDecodedPlayout) {
      this.resetDecodedPlayoutStateForBurstGap();
    } else {
      this.jitterBurstHeadroomState = createGcallJitterBurstHeadroomState();
      this.jitterTrimmedFramesAtLastHeadroomStep =
        this.jitterPushTrimmedFrames;
      this.jitterPushDepthHighWaterSinceLastHeadroomStep =
        jb.getBufferedFrames();
      this.lastJitterAdaptiveMode = null;
      this.lastJitterBurstHeadroomReason = 'burst-gap-latency-shed';
      this.syncJitterGeometryFromMetrics(false);
    }
    jb.forcePrimeForRecoveryEscape(GCALL_READY_STALL_FORCE_PRIMED_HOLD_MS, {
      clearBurstRecoveryHold: true,
    });
    if (shouldResetDecodedPlayout) {
      this.lastJitterBurstHeadroomReason = 'burst-gap-reanchor';
    }
    this.burstGapWatchStartedAtMs = 0;
    this.burstGapWatchFrames = 0;
    this.burstGapWatchGapMs = 0;
    this.burstGapWatchTrimmedFramesStart = 0;
  }

  private syncJitterGeometryFromMetrics(stepHeadroom = true): void {
    const jb = this.jitter;
    const tuning = this.tuning;
    const m = this.callbacks?.metricsRef?.current;
    if (!jb || !tuning || !m) return;
    const metricsMode = m.getSnapshot().adaptiveNetworkMode;
    const mode = this.forcedJitterAdaptiveMode ?? metricsMode;
    const activeSourceCount = this.resolveActiveSourceCount();
    const snapshot = m.getSnapshot();
    const nowMs = Date.now();
    const postBurstLatencyLockoutActive = shouldApplyPostBurstLatencyLockout({
      nowMs,
      lastRecoveryAtMs: this.lastBurstGapResetAtMs,
      lastDroppedFrames: this.lastBurstGapDroppedFrames,
      activeSourceCount,
      playoutUnderTargetFraction: snapshot.playoutUnderTargetFraction,
      avgPlayoutRate: snapshot.avgPlayoutRate,
    });
    if (stepHeadroom) {
      const trimCount =
        this.jitterPushTrimmedFrames -
        this.jitterTrimmedFramesAtLastHeadroomStep;
      this.jitterTrimmedFramesAtLastHeadroomStep = this.jitterPushTrimmedFrames;
      const depthHighWater = this.jitterPushDepthHighWaterSinceLastHeadroomStep;
      this.jitterPushDepthHighWaterSinceLastHeadroomStep =
        jb.getBufferedFrames();
      const stepped = stepGcallJitterBurstHeadroom({
        state: this.jitterBurstHeadroomState,
        enabled: mode === 'recovery' && !postBurstLatencyLockoutActive,
        nowMs,
        trimCount,
        depthHighWater,
        maxDepthFrames: jb.getMaxEntries(),
        playoutUnderTargetFraction: snapshot.playoutUnderTargetFraction,
        avgPlayoutRate: snapshot.avgPlayoutRate,
      });
      this.jitterBurstHeadroomState = stepped.state;
      if (stepped.reason) this.lastJitterBurstHeadroomReason = stepped.reason;
    }
    if (
      postBurstLatencyLockoutActive &&
      this.jitterBurstHeadroomState.level !== 0
    ) {
      this.jitterBurstHeadroomState = createGcallJitterBurstHeadroomState();
      this.lastJitterBurstHeadroomReason = 'post-burst-latency-lockout';
    }
    const geometryMode =
      postBurstLatencyLockoutActive && mode === 'recovery'
        ? 'low-latency'
        : mode;
    if (
      this.lastJitterAdaptiveMode === geometryMode &&
      this.lastJitterActiveSourceCount === activeSourceCount &&
      !stepHeadroom
    ) {
      return;
    }
    this.lastJitterAdaptiveMode = geometryMode;
    this.lastJitterActiveSourceCount = activeSourceCount;
    const base =
      geometryMode === 'recovery'
        ? getEffectiveJitterTuning(tuning, 'recovery', {
            tier2MultiSource: true,
            activeSourceCount,
          })
        : getEffectiveJitterTuning(tuning, 'low-latency');
    const eff = applyGcallJitterBurstHeadroom(
      base,
      this.jitterBurstHeadroomState.level,
      {
        boostStartThreshold:
          !(activeSourceCount === 1 && this.hasObservedPlayoutStart),
      }
    );
    jb.applyJitterTuning(eff);
    jb.setSoftUnprimeMs(
      computeSoftUnprimeMsForTier2(
        activeSourceCount,
        geometryMode === 'recovery' && activeSourceCount >= 2
      )
    );
    jb.setSteadyPrimedHoldFrames(
      computePostBurstSteadyPrimedHoldFrames({
        lockoutActive: postBurstLatencyLockoutActive,
        activeSourceCount,
        defaultHoldFrames: geometryMode !== 'recovery' ? 1 : 0,
      })
    );
  }

  private shedRecoveredJitterLatency(opts: {
    bufferedFrames: number;
    targetPlayoutMs: number;
  }): number {
    const jb = this.jitter;
    const metrics = this.callbacks?.metricsRef?.current?.getSnapshot();
    if (!jb || !metrics) return 0;
    const postBurstShedFrames = computePostBurstLatencyShedFrames({
      lockoutActive: shouldApplyPostBurstLatencyLockout({
        nowMs: Date.now(),
        lastRecoveryAtMs: this.lastBurstGapResetAtMs,
        lastDroppedFrames: this.lastBurstGapDroppedFrames,
        activeSourceCount: this.resolveActiveSourceCount(),
        playoutUnderTargetFraction: metrics.playoutUnderTargetFraction,
        avgPlayoutRate: metrics.avgPlayoutRate,
      }),
      bufferedFrames: opts.bufferedFrames,
      targetPlayoutMs: opts.targetPlayoutMs,
    });
    if (postBurstShedFrames > 0) {
      const dropped = jb.discardOldest(postBurstShedFrames);
      if (dropped > 0) {
        this.postBurstLatencyShedFrames += dropped;
        this.lastPostBurstLatencyShedFrames = dropped;
        this.lastPostBurstLatencyShedAtMs = Date.now();
      }
      return dropped;
    }
    if ((this.lastJitterAdaptiveMode ?? 'low-latency') !== 'recovery') {
      return 0;
    }
    if (!Number.isFinite(opts.targetPlayoutMs) || opts.targetPlayoutMs <= 0) {
      return 0;
    }
    const maxEntries = jb.getMaxEntries();
    if (maxEntries <= 0) return 0;
    const nearCap =
      opts.bufferedFrames >=
      Math.max(
        1,
        Math.floor(maxEntries * GCALL_RECOVERY_LATENCY_SHED_MIN_CAP_RATIO)
      );
    if (!nearCap) return 0;
    const stableEnough =
      metrics.playoutUnderTargetFraction <=
        GCALL_RECOVERY_LATENCY_SHED_UNDERTARGET_MAX &&
      metrics.avgPlayoutRate >= GCALL_RECOVERY_LATENCY_SHED_PLAYOUT_RATE_MIN;
    if (!stableEnough) return 0;
    const targetFrames = Math.max(
      4,
      Math.ceil(opts.targetPlayoutMs / OPUS_FRAME_DURATION_MS) +
        GCALL_RECOVERY_LATENCY_SHED_TARGET_HEADROOM_FRAMES
    );
    const overTargetFrames = opts.bufferedFrames - targetFrames;
    if (overTargetFrames < GCALL_RECOVERY_LATENCY_SHED_MIN_OVER_TARGET_FRAMES) {
      return 0;
    }
    return jb.discardOldest(
      Math.min(
        GCALL_RECOVERY_LATENCY_SHED_MAX_FRAMES_PER_TICK,
        overTargetFrames
      )
    );
  }

  private drainOneFrame(): number {
    if (this.wasmFecActive) {
      return this.drainOneWasmFrame();
    } else {
      return this.drainOneWebCodecsFrame();
    }
  }

  private drainOneWasmFrame(): number {
    const jb = this.jitter;
    const w = this.opusFecWorker;
    const pipeline = this.fecPipeline;
    const tuning = this.tuning;
    if (!jb || !w || !pipeline || !tuning) return 0;
    if (!jb.hasReadyFrame()) return 0;
    const frame = jb.pop();
    if (!frame) return 0;
    this.jitterDrainPoppedFrames++;
    const missedInc = jb.consumePendingMissedFrames();
    const ingressAtMs = jb.consumeLastPoppedReceivedAtMs();
    const playedSeq = jb.getLastPlayedSeq();
    if (playedSeq >= 0) {
      this.callbacks?.onPlayedSeqAdvanced?.({
        sourceAddr: this.peerAddress,
        playedSeq,
      });
    }
    const rawGap = jb.consumeLastRawGapAfterPop();
    if (rawGap > tuning.wasmFecMaxGapReset) {
      w.postMessage({ type: 'reset', sourceAddr: this.peerAddress });
    }
    const gapForWorker = Math.min(rawGap, 48);
    const packetCopy = new Uint8Array(frame.byteLength);
    packetCopy.set(frame);
    pipeline.enqueueDecode(
      w,
      this.peerAddress,
      packetCopy,
      gapForWorker,
      ingressAtMs
    );
    return missedInc;
  }

  private drainOneWebCodecsFrame(): number {
    const jb = this.jitter;
    const decoder = this.decoder;
    if (!jb || !decoder || decoder.state === 'closed') return 0;
    if (!jb.hasReadyFrame()) return 0;
    const frame = jb.pop();
    if (!frame) return 0;
    this.jitterDrainPoppedFrames++;
    const missedInc = jb.consumePendingMissedFrames();
    const ingressAtMs = jb.consumeLastPoppedReceivedAtMs();
    const playedSeq = jb.getLastPlayedSeq();
    if (playedSeq >= 0) {
      this.callbacks?.onPlayedSeqAdvanced?.({
        sourceAddr: this.peerAddress,
        playedSeq,
      });
    }
    try {
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: frame,
      });
      this.pendingDecodedIngressAtMs.push(ingressAtMs);
      decoder.decode(chunk);
    } catch {
      /* ignore */
    }
    return missedInc;
  }

  pushDecoded(packets: DecodedAudioPacket[]): void {
    const jb = this.jitter;
    if (!jb) return;
    const nowMs = Date.now();
    this.noteDecodedBurstGapBeforePush(nowMs);
    let pushedAny = false;
    for (const p of packets) {
      if (p.opusFrame?.length) {
        const result = jb.push(p.seq, p.opusFrame);
        if (result.status === 'accepted') {
          this.jitterPushAccepted++;
          if (this.burstGapWatchStartedAtMs > 0) {
            this.burstGapWatchFrames++;
          }
          pushedAny = true;
        } else if (result.status === 'stale') {
          this.jitterPushStale++;
        } else {
          this.jitterPushDuplicate++;
        }
        this.jitterPushDepthHighWater = Math.max(
          this.jitterPushDepthHighWater,
          result.depth
        );
        this.jitterPushDepthHighWaterSinceLastHeadroomStep = Math.max(
          this.jitterPushDepthHighWaterSinceLastHeadroomStep,
          result.depth
        );
        if (result.trimmed > 0) {
          this.jitterPushTrimmedFrames += result.trimmed;
          this.jitterPushTrimEvents++;
          this.jitterLastTrimmedFrames = result.trimmed;
          this.jitterLastTrimAtMs = Date.now();
        }
      }
    }
    if (pushedAny) {
      this.lastPushAtPerfMs = performance.now();
      this.lastDecodedPushWallMs = nowMs;
      this.maybeCommitBurstGapRecovery(nowMs);
    }
  }

  async stop(): Promise<void> {
    const dec = this.decoder;
    const playNode = this.playbackNode;
    const spGain = this.speakerGain;
    const sched = this.schedulerNode;
    const schedGain = this.schedulerGain;
    const pcmRing = this.pcmRing;
    const w = this.opusFecWorker;

    this.decoder = null;
    this.playbackNode = null;
    this.speakerGain = null;
    this.schedulerNode = null;
    this.schedulerGain = null;
    this.pcmRing = null;
    this.jitter = null;
    this.tuning = null;
    this.fecPipeline = null;
    this.opusFecWorker = null;
    this.wasmFecActive = false;
    this.peerAddress = '';
    this.callbacks = null;
    this.lastJitterAdaptiveMode = null;
    this.lastPostedTargetPlayoutMs = null;
    this.pendingDecodedIngressAtMs = [];
    this.lastDrainMetricSampleAtMs = 0;
    this.startupReadyStallSinceMs = null;
    this.hasObservedPlayoutStart = false;
    this.lastPushAtPerfMs = null;
    this.resetJitterPushDiagnostics();

    pcmRing?.reset();
    disconnectSafe(playNode);
    disconnectSafe(spGain);
    disconnectSafe(sched);
    disconnectSafe(schedGain);
    if (w) {
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
    }
    if (dec && dec.state !== 'closed') {
      try {
        dec.close();
      } catch {
        /* ignore */
      }
    }
  }
}
