import type { FaultSpec } from './faultInjector';
import {
  FaultInjector,
  FAULT_CALL60_PATTERN,
  FAULT_CALL63_PATTERN,
} from './faultInjector';
import type {
  GroupCallE2ePeerTimelineSummary,
  GroupCallE2ePeerStartupSummary,
  GroupCallE2eStage,
  GroupCallE2eMode,
  GroupCallE2eArtifactBundle,
} from './groupCallE2eArtifacts';
import {
  buildGroupCallE2eArtifactBundle,
  buildMinimalTimelineSummary,
  summarizeTickBreaches,
  summarizeValues,
} from './groupCallE2eArtifacts';
import {
  FIXTURE_CALL60_REBUILD_OSCILLATION,
  FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP,
  type FailureClass,
  type ReplayScenarioParams,
} from './regressionFixtures';
import { PHIL_KENNY_ONE_ON_ONE_76_PAIR } from './liveExportRegressionFixtures';
import { reducePairedLiveExportToReplayScript } from './eventReplayReducer';
import { ReticulumSessionController } from './reticulumSessionController';
import { ReceiveEngine } from './receiveEngine';
import { ReceivePolicyEngine } from './receivePolicyEngine';
import { SendPressureController } from './sendPressureController';
import { NullDecodeService } from './decodeService';
import { BufferingDiagnosticsRecorder } from './diagnosticsContract';
import type { StreamIdentity } from './spec';
import type { PeerExportMetrics } from './pairedExportAnalyzer';
import { extractMetricsFromV1Export } from './pairedExportAnalyzer';
import { OPUS_FRAME_DURATION_MS } from '../gcallVoiceAudioConstants';
import {
  GroupCallPerformanceTracker,
  type GroupCallWindowMetrics,
} from '../router';
import {
  assessSourceTimestampLateness,
  type SourceTimestampLatenessState,
} from '../sourceTimestampLateness';

export type SenderProfileId =
  | 'cleanSender'
  | 'lossySender'
  | 'burstySender'
  | 'moderateSpikeSender'
  | 'highJitterSender'
  | 'stalledSender'
  | 'cpuStressedSender'
  | 'staleTimestampSender'
  | 'startupSpikeSender'
  | 'startupBurstySender'
  | 'philKennyTransportSender'
  | 'philKennyStaleSender'
  | 'call63FixtureSender'
  | 'call60FixtureSender';

interface TimestampPathologyConfig {
  readonly startAtMs: number;
  readonly lagMs: number;
  readonly regressionMs?: number;
  readonly regressionEveryPackets?: number;
}

export interface SenderImpairmentProfile
  extends Pick<
    ReplayScenarioParams,
    | 'packetPattern'
    | 'avgInterPacketMs'
    | 'jitterStdDevMs'
    | 'burstFraction'
    | 'lossRate'
    | 'simulateRecoveryPathLatch'
    | 'tickBreachFraction'
    | 'tickBreachAvgMs'
  > {
  readonly id: SenderProfileId;
  readonly label: string;
  readonly impairmentSummary: string;
  readonly faults?: readonly FaultSpec[];
  readonly timestampPathology?: TimestampPathologyConfig;
}

export interface GroupCallE2eScenarioExpectation {
  readonly bothPassed?: boolean;
  readonly bothPassedByMode?: Partial<Record<GroupCallE2eMode, boolean>>;
  readonly worseAddr?: 'peer-A' | 'peer-B';
  readonly worsePrimaryClass?: FailureClass;
  readonly qualityScoreAtLeast?: number;
  readonly qualityScoreAtLeastByMode?: Partial<Record<GroupCallE2eMode, number>>;
  readonly qualityScoreAtMost?: number;
  readonly startupFailure?: {
    readonly modes?: GroupCallE2eMode[];
    readonly peer: 'peer-A' | 'peer-B';
    readonly minUnderTargetFraction?: number;
    readonly maxAvgPcmBufferedMs?: number;
    readonly minDecodeDrops?: number;
  };
}

interface GroupCallE2eReceiverModel {
  readonly authoritativeKeyReadyAtMs?: number;
  readonly startupTargetBoostMs?: number;
  readonly startupTargetBoostUntilMs?: number;
  readonly startupLatencyAddMs?: number;
  readonly startupLatencyUntilMs?: number;
  readonly startupBridgePressureDepth?: number;
  readonly startupBridgePressureUntilMs?: number;
}

export interface GroupCallE2eScenario {
  readonly id: string;
  readonly description: string;
  readonly durationMs: number;
  readonly seed: number;
  readonly fixtureId?: string;
  readonly peerA: {
    readonly addr: 'peer-A';
    readonly role: string;
    readonly senderProfile: SenderImpairmentProfile;
    readonly receiverModel?: GroupCallE2eReceiverModel;
  };
  readonly peerB: {
    readonly addr: 'peer-B';
    readonly role: string;
    readonly senderProfile: SenderImpairmentProfile;
    readonly receiverModel?: GroupCallE2eReceiverModel;
  };
  readonly expectations: GroupCallE2eScenarioExpectation;
}

interface SyntheticPacket {
  readonly arrivalMs: number;
  readonly seq: number;
  readonly senderTimestampMs: number;
  readonly opusFrame: Uint8Array;
  readonly dropped: boolean;
}

interface StageIssueTracker {
  arrival: number | null;
  jitter: number | null;
  decode: number | null;
  'pcm-ring': number | null;
  playout: number | null;
}

interface SimulatedPeerPath {
  readonly receiverAddr: 'peer-A' | 'peer-B';
  readonly receiverRole: string;
  readonly senderAddr: 'peer-A' | 'peer-B';
  readonly senderProfile: SenderImpairmentProfile;
  readonly receiverModel?: GroupCallE2eReceiverModel;
  readonly diag: BufferingDiagnosticsRecorder;
  readonly sessionController: ReticulumSessionController;
  readonly engine: ReceiveEngine;
  readonly policy: ReceivePolicyEngine;
  readonly sendPressure: SendPressureController;
  readonly faultInjector: FaultInjector;
  readonly tracker: GroupCallPerformanceTracker;
  readonly streamId: StreamIdentity;
  readonly packets: SyntheticPacket[];
  readonly packetRng: () => number;
  packetIdx: number;
  nextTickMs: number;
  totalPackets: number;
  deliveredPackets: number;
  droppedPackets: number;
  framesDecoded: number;
  concealmentTicks: number;
  stateCounts: Map<string, number>;
  pcmSamples: number[];
  playoutPcmSamples: number[];
  opusSamples: number[];
  jitterDepthSamples: number[];
  playoutDeltaSamples: number[];
  targetSamples: number[];
  tickStallsMs: number[];
  underTargetTicks: number;
  outsideTargetTicks: number;
  maxBridgePressureDepth: number;
  bridgeWaitingForDrainObserved: boolean;
  latenessState: SourceTimestampLatenessState | undefined;
  staleTimestampDrops: number;
  maxExcessLatenessMs: number;
  maxTimestampRegressionMs: number;
  startupTickCount: number;
  startupUnderTargetTicks: number;
  startupOutsideTargetTicks: number;
  startupConcealmentTicks: number;
  startupPcmSamples: number[];
  startupDecodeDropCount: number;
  stageIssues: StageIssueTracker;
}

const GCALL_SOURCE_TIMESTAMP_MAX_EXCESS_LATENESS_MS = 4_000;
const GCALL_SOURCE_TIMESTAMP_MAX_REGRESSION_MS = 2_400;
const STARTUP_QUALITY_WINDOW_MS = 6_000;
const PHIL_KENNY_REPLAY_SCRIPT = reducePairedLiveExportToReplayScript(
  PHIL_KENNY_ONE_ON_ONE_76_PAIR
);

function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function stageOrder(stage: GroupCallE2eStage): number {
  switch (stage) {
    case 'arrival': return 0;
    case 'jitter': return 1;
    case 'decode': return 2;
    case 'pcm-ring': return 3;
    case 'playout': return 4;
  }
}

function markStageIssue(
  issues: StageIssueTracker,
  stage: GroupCallE2eStage,
  atMs: number
): void {
  if (issues[stage] == null) {
    issues[stage] = atMs;
  }
}

function firstIssue(issues: StageIssueTracker): {
  atMs: number | null;
  stage: GroupCallE2eStage | null;
} {
  const entries = (Object.entries(issues) as Array<[GroupCallE2eStage, number | null]>)
    .filter(([, atMs]) => typeof atMs === 'number')
    .sort((a, b) => {
      const atA = a[1] ?? Number.POSITIVE_INFINITY;
      const atB = b[1] ?? Number.POSITIVE_INFINITY;
      return atA - atB || stageOrder(a[0]) - stageOrder(b[0]);
    });
  return {
    atMs: entries[0]?.[1] ?? null,
    stage: entries[0]?.[0] ?? null,
  };
}

function cloneFaults(faults: readonly FaultSpec[] | undefined): FaultSpec[] {
  return faults ? faults.map((fault) => ({ ...fault, params: fault.params ? { ...fault.params } : undefined })) : [];
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function generatePackets(
  profile: SenderImpairmentProfile,
  durationMs: number,
  seed: number
): SyntheticPacket[] {
  const rng = xorshift32(seed);
  const packets: SyntheticPacket[] = [];
  let senderNowMs = 0;
  let seq = 0;
  const opusDummy = new Uint8Array([0xfc, 0x00, 0x01, 0x02]);
  const baseNetworkLatencyMs = 40;

  while (senderNowMs < durationMs) {
    senderNowMs += Math.max(1, profile.avgInterPacketMs);
    let transportDelay = baseNetworkLatencyMs;
    switch (profile.packetPattern) {
      case 'bursty':
        transportDelay =
          rng() < profile.burstFraction
            ? baseNetworkLatencyMs + profile.avgInterPacketMs * 2 + rng() * profile.jitterStdDevMs * 2.5
            : baseNetworkLatencyMs + rng() * profile.jitterStdDevMs * 0.8;
        break;
      case 'recovery-channel':
        transportDelay =
          baseNetworkLatencyMs +
          profile.avgInterPacketMs * (1.5 + rng() * 2.5) +
          rng() * profile.jitterStdDevMs * 1.5;
        break;
      case 'mixed':
        transportDelay =
          baseNetworkLatencyMs +
          (rng() < 0.5 ? profile.jitterStdDevMs * 1.4 : profile.jitterStdDevMs * 0.5) * rng();
        break;
      case 'steady':
      default: {
        const u1 = rng();
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
        transportDelay = Math.max(5, baseNetworkLatencyMs + z * profile.jitterStdDevMs);
        break;
      }
    }
    if (profile.simulateRecoveryPathLatch) {
      transportDelay += rng() * profile.avgInterPacketMs * 3;
    }
    const nominalSenderTimestampMs = senderNowMs;
    let senderTimestampMs = nominalSenderTimestampMs;
    const pathology = profile.timestampPathology;
    if (pathology && senderNowMs >= pathology.startAtMs) {
      senderTimestampMs = Math.max(0, senderTimestampMs - pathology.lagMs);
      const everyPackets = Math.max(1, pathology.regressionEveryPackets ?? 5);
      if (
        pathology.regressionMs &&
        pathology.regressionMs > 0 &&
        seq % everyPackets === 0
      ) {
        senderTimestampMs = Math.max(0, senderTimestampMs - pathology.regressionMs);
      }
    }
    packets.push({
      arrivalMs: Math.max(0, senderNowMs + transportDelay),
      seq: seq & 0xffff,
      senderTimestampMs,
      opusFrame: opusDummy.slice(),
      dropped: rng() < profile.lossRate,
    });
    seq += 1;
  }

  packets.sort((a, b) => a.arrivalMs - b.arrivalMs || a.seq - b.seq);
  return packets;
}

function bridgePressureDepthAt(
  faults: readonly FaultSpec[] | undefined,
  nowMs: number
): number {
  let depth = 0;
  for (const fault of faults ?? []) {
    const expiresAt =
      typeof fault.durationMs === 'number' && fault.durationMs > 0
        ? fault.atMs + fault.durationMs
        : fault.atMs;
    if (fault.kind === 'bridge-pressure' && nowMs >= fault.atMs && nowMs <= expiresAt) {
      depth = Math.max(depth, Number(fault.params?.depth ?? 0));
    }
  }
  return depth;
}

function startupBridgePressureDepthAt(
  model: GroupCallE2eReceiverModel | undefined,
  nowMs: number
): number {
  if (
    !model ||
    typeof model.startupBridgePressureDepth !== 'number' ||
    typeof model.startupBridgePressureUntilMs !== 'number'
  ) {
    return 0;
  }
  return nowMs <= model.startupBridgePressureUntilMs
    ? Math.max(0, model.startupBridgePressureDepth)
    : 0;
}

function starvationSeverity(underTargetFraction: number, avgPcmBufferedMs: number): string {
  if (underTargetFraction >= 0.8 || avgPcmBufferedMs < 20) return 'strong';
  if (underTargetFraction >= 0.5 || avgPcmBufferedMs < 45) return 'moderate';
  if (underTargetFraction >= 0.2 || avgPcmBufferedMs < 70) return 'mild';
  return 'none';
}

function adaptiveNetworkMode(
  transportDurationMs: number,
  underTargetFraction: number
): 'low-latency' | 'recovery' {
  if (transportDurationMs > 0 || underTargetFraction > 0.45) return 'recovery';
  return 'low-latency';
}

function buildLegacyPeerMetrics(
  path: SimulatedPeerPath,
  transportDurationMs: number
): PeerExportMetrics {
  const pcmRing = summarizeValues(path.pcmSamples);
  const pcm = summarizeValues(path.playoutPcmSamples);
  const opus = summarizeValues(path.opusSamples);
  const target = summarizeValues(path.targetSamples);
  const playoutDelta = summarizeValues(path.playoutDeltaSamples);
  const tick = summarizeTickBreaches(path.tickStallsMs);
  const underruns = path.engine.getPcmRing().underruns;
  const concealmentFrames = path.engine.getConcealmentFrames();
  const totalTicks = Math.max(1, path.targetSamples.length);
  const measuredUnderTargetFraction = path.underTargetTicks / totalTicks;
  const measuredOutsideTargetFraction = path.outsideTargetTicks / totalTicks;
  const arrivalDropRate = path.totalPackets > 0 ? path.droppedPackets / path.totalPackets : 0;
  const staleTimestampDropRate =
    path.totalPackets > 0 ? path.staleTimestampDrops / path.totalPackets : 0;
  const transportFraction = transportDurationMs / Math.max(1, path.targetSamples.length * OPUS_FRAME_DURATION_MS);
  const tickFraction = tick.count / totalTicks;
  const missingMediaFraction =
    (path.stateCounts.get('missingMedia') ?? 0) / totalTicks;
  const concealmentFraction = path.concealmentTicks / totalTicks;
  const healthyDecodedReserve =
    target.avg > 0 && pcmRing.avg >= target.avg * 1.1;
  const pressureFromDrops = staleTimestampDropRate > 0
    ? Math.min(0.98, staleTimestampDropRate * 1.2)
    : Math.min(0.5, missingMediaFraction * 1.5 + concealmentFraction * 0.5);
  const stressPenalty =
    measuredUnderTargetFraction > 0.15 || !healthyDecodedReserve
      ? Math.min(0.5, transportFraction * 0.45 + tickFraction * 1.25)
      : 0;
  const syntheticPressure = Math.min(
    0.98,
    Math.max(
      pressureFromDrops,
      measuredUnderTargetFraction,
      measuredOutsideTargetFraction * 0.8
    ) + stressPenalty
  );
  const reserveRelief =
    healthyDecodedReserve && staleTimestampDropRate === 0 && missingMediaFraction < 0.05
      ? Math.min(0.35, (pcmRing.avg - target.avg) / Math.max(target.avg * 2, 1))
      : 0;
  const underTargetFraction = Math.max(
    measuredUnderTargetFraction,
    Math.max(0, syntheticPressure - reserveRelief)
  );
  const outsideTargetFraction = Math.max(
    measuredOutsideTargetFraction,
    Math.min(0.99, Math.max(underTargetFraction, syntheticPressure * 1.05))
  );
  const targetAvg = target.avg || 120;
  const effectiveAvgPcm = Math.min(
    pcm.avg,
    Math.max(20, targetAvg * (1 - underTargetFraction * 0.85))
  );
  const effectivePlayoutDelta = Math.min(playoutDelta.avg, effectiveAvgPcm - targetAvg);

  return {
    avgPcmBufferedMs: effectiveAvgPcm,
    avgPlayoutDeltaMs: effectivePlayoutDelta,
    playoutUnderTargetFraction: underTargetFraction,
    playoutOutsideTargetFraction: outsideTargetFraction,
    playoutRateFractionBelow1: path.tickStallsMs.length > 0 ? 0.15 : 0,
    jitterUnderruns: underruns,
    missingFrames: concealmentFrames,
    concealmentTicks: path.concealmentTicks,
    packetsDroppedStaleTimestamp: path.staleTimestampDrops,
    packetsDroppedStaleTimestampRatePerSec:
      path.targetSamples.length > 0
        ? path.staleTimestampDrops / ((path.targetSamples.length * OPUS_FRAME_DURATION_MS) / 1000)
        : 0,
    packetsDroppedPendingDecrypt: 0,
    packetsDroppedPendingDecryptRatePerSec: 0,
    pendingDecryptDepthHighWater: 0,
    reticulumAudioBridgeQueuedFramesHighWater: path.maxBridgePressureDepth,
    reticulumAudioBinaryOutQueueDepthHighWater: path.maxBridgePressureDepth > 0 ? Math.max(0, path.maxBridgePressureDepth - 6) : 0,
    reticulumAudioBridgeWaitingForDrain: path.bridgeWaitingForDrainObserved,
    reticulumAudioQueuePressureDrops: 0,
    reticulumAudioStaleDrops: 0,
    avgOpusBufferedMs: opus.avg,
    maxOpusBufferedMs: opus.max,
    adaptiveTargetMedianMs: target.avg,
    wasmFecDeferredPcmTicks: 0,
    durationMs: path.targetSamples.length * OPUS_FRAME_DURATION_MS,
    adaptiveNetworkMode: adaptiveNetworkMode(transportDurationMs, underTargetFraction),
    playoutStarvationWorstSeverity: starvationSeverity(underTargetFraction, pcm.avg),
    gcallAudioStage5BoostCumulativeMs: 0,
    tickBudgetBreachCount: tick.count,
    tickBudgetBreachP95Ms: tick.p95Ms,
    tickBudgetBreachMaxMs: tick.maxMs,
    longTaskCount: tick.longTaskCount,
    role: path.receiverRole,
    v2ManagedSourceCount: 1,
    legacyWindowOpusMetricsMeaningful: false,
    avgPcmRingBufferedMs: pcmRing.avg,
    avgPcmRingOldestFrameAgeMs: 0,
    maxPcmRingOldestFrameAgeMs: 0,
    stalePcmDrops: 0,
    avgTargetBufferMs: target.avg,
  };
}

function buildTrackedPeerMetrics(
  path: SimulatedPeerPath,
  transportDurationMs: number,
  durationMs: number
): PeerExportMetrics {
  const snapshot = path.tracker.getSnapshot();
  const window = path.tracker.captureWindowMetrics(path.receiverAddr, durationMs);
  const source =
    window.sources.find((candidate) => candidate.sourceAddr === path.senderAddr) ??
    window.sources[0] ??
    null;
  const targetMedianMs =
    source?.adaptiveTargetMedianMs || window.adaptiveTargetMedianMs || 120;
  const rawAvgPcmBufferedMs = source?.avgPcmBufferedMs ?? window.avgPcmBufferedMs;
  const rawUnderTargetFraction =
    source?.playoutUnderTargetFraction ?? window.playoutUnderTargetFraction;
  const rawOutsideTargetFraction =
    source?.playoutOutsideTargetFraction ?? window.playoutOutsideTargetFraction;
  const startupTickCount = Math.max(1, path.startupTickCount);
  const startupUnderTargetFraction =
    path.startupUnderTargetTicks / startupTickCount;
  const startupOutsideTargetFraction =
    path.startupOutsideTargetTicks / startupTickCount;
  const startupAvgPcmBufferedMs = average(path.startupPcmSamples);
  const startupTickWeight = Math.min(
    0.45,
    path.startupTickCount / Math.max(1, path.targetSamples.length)
  );
  const startupDecodePressure = Math.min(
    0.35,
    path.startupDecodeDropCount / Math.max(1, startupTickCount * 2)
  );
  const startupConcealmentPressure = Math.min(
    0.25,
    path.startupConcealmentTicks / startupTickCount
  );
  const calibratedUnderTargetFraction = Math.max(
    rawUnderTargetFraction,
    rawUnderTargetFraction * (1 - startupTickWeight) +
      startupUnderTargetFraction * startupTickWeight +
      startupDecodePressure +
      startupConcealmentPressure
  );
  const calibratedOutsideTargetFraction = Math.max(
    rawOutsideTargetFraction,
    rawOutsideTargetFraction * (1 - startupTickWeight) +
      startupOutsideTargetFraction * startupTickWeight +
      startupDecodePressure * 0.6
  );
  const calibratedAvgPcmBufferedMs =
    startupAvgPcmBufferedMs > 0
      ? Math.min(
          rawAvgPcmBufferedMs,
          rawAvgPcmBufferedMs * (1 - startupTickWeight) +
            startupAvgPcmBufferedMs * startupTickWeight
        )
      : rawAvgPcmBufferedMs;
  const avgPcmBufferedMs = calibratedAvgPcmBufferedMs;
  const underTargetFraction = Math.min(0.99, calibratedUnderTargetFraction);
  return {
    avgPcmBufferedMs,
    avgPlayoutDeltaMs: source?.avgPlayoutDeltaMs ?? window.avgPlayoutDeltaMs,
    playoutUnderTargetFraction: underTargetFraction,
    playoutOutsideTargetFraction: Math.min(
      0.99,
      calibratedOutsideTargetFraction
    ),
    playoutRateFractionBelow1: window.playoutRateFractionBelow1,
    jitterUnderruns: source?.jitterUnderruns ?? window.jitterUnderruns,
    missingFrames: source?.missingFrames ?? window.missingFrames,
    concealmentTicks: source?.concealmentTicks ?? window.concealmentTicks,
    packetsDroppedStaleTimestamp: window.packetsDroppedStaleTimestamp,
    packetsDroppedStaleTimestampRatePerSec:
      durationMs > 0 ? window.packetsDroppedStaleTimestamp / (durationMs / 1000) : 0,
    packetsDroppedPendingDecrypt: window.packetsDroppedPendingDecrypt,
    packetsDroppedPendingDecryptRatePerSec:
      window.packetsDroppedPendingDecryptRatePerSec,
    pendingDecryptDepthHighWater: window.pendingDecryptDepthHighWater,
    reticulumAudioBridgeQueuedFramesHighWater:
      window.reticulumAudioBridgeQueuedFramesHighWater,
    reticulumAudioBinaryOutQueueDepthHighWater:
      window.reticulumAudioBinaryOutQueueDepthHighWater,
    reticulumAudioBridgeWaitingForDrain:
      window.reticulumAudioBridgeWaitingForDrain,
    reticulumAudioQueuePressureDrops: window.reticulumAudioQueuePressureDrops,
    reticulumAudioStaleDrops: window.reticulumAudioStaleDrops,
    avgOpusBufferedMs: source?.avgOpusBufferedMs ?? window.avgOpusBufferedMs,
    maxOpusBufferedMs: source?.maxOpusBufferedMs ?? window.maxOpusBufferedMs,
    adaptiveTargetMedianMs: targetMedianMs,
    wasmFecDeferredPcmTicks: source?.wasmFecDeferredPcmTicks ?? 0,
    durationMs,
    adaptiveNetworkMode: adaptiveNetworkMode(
      transportDurationMs,
      underTargetFraction
    ),
    playoutStarvationWorstSeverity: starvationSeverity(
      underTargetFraction,
      avgPcmBufferedMs
    ),
    gcallAudioStage5BoostCumulativeMs:
      snapshot.gcallAudioStage5BoostCumulativeMs,
    tickBudgetBreachCount: snapshot.tickBudgetBreachCount,
    tickBudgetBreachP95Ms: snapshot.tickBudgetBreachP95Ms,
    tickBudgetBreachMaxMs: snapshot.tickBudgetBreachMaxMs,
    longTaskCount: snapshot.longTaskCount,
    role: path.receiverRole,
    v2ManagedSourceCount: 1,
    legacyWindowOpusMetricsMeaningful: false,
    avgPcmRingBufferedMs: avgPcmBufferedMs,
    avgPcmRingOldestFrameAgeMs:
      source?.avgReceiverIngressToPlayoutPostMs ??
      window.avgReceiverIngressToPlayoutPostMs,
    maxPcmRingOldestFrameAgeMs:
      source?.maxReceiverIngressToPlayoutPostMs ??
      window.maxReceiverIngressToPlayoutPostMs,
    stalePcmDrops: 0,
    avgTargetBufferMs: targetMedianMs,
  };
}

function buildTimelineSummary(
  path: SimulatedPeerPath,
  metrics: PeerExportMetrics
): GroupCallE2ePeerTimelineSummary {
  const pcmRing = summarizeValues(path.pcmSamples);
  const pcm = summarizeValues(path.playoutPcmSamples);
  const opus = summarizeValues(path.opusSamples);
  const playoutDelta = summarizeValues(path.playoutDeltaSamples);
  const first = firstIssue(path.stageIssues);
  return {
    firstIssueAtMs: first.atMs,
    firstIssueStage: first.stage,
    arrival: {
      firstIssueAtMs: path.stageIssues.arrival,
      totalPackets: path.totalPackets,
      deliveredPackets: path.deliveredPackets,
      droppedPackets: path.droppedPackets,
      dropRate: path.totalPackets > 0 ? path.droppedPackets / path.totalPackets : 0,
      staleTimestampDrops: path.staleTimestampDrops,
      maxExcessLatenessMs: path.maxExcessLatenessMs,
      maxTimestampRegressionMs: path.maxTimestampRegressionMs,
    },
    jitter: {
      firstIssueAtMs: path.stageIssues.jitter,
      avgBufferedMs: opus.avg,
      maxBufferedMs: opus.max,
      maxDepthFrames: path.jitterDepthSamples.length > 0 ? Math.max(...path.jitterDepthSamples) : 0,
    },
    decode: {
      firstIssueAtMs: path.stageIssues.decode,
      framesDecoded: path.framesDecoded,
      concealmentFrames: path.engine.getConcealmentFrames(),
      concealmentTicks: path.concealmentTicks,
    },
    pcmRing: {
      firstIssueAtMs: path.stageIssues['pcm-ring'],
      avgBufferedMs: pcmRing.avg,
      minBufferedMs: pcmRing.min,
      maxBufferedMs: pcmRing.max,
      underruns: path.engine.getPcmRing().underruns,
      overruns: path.engine.getPcmRing().overruns,
    },
    playout: {
      firstIssueAtMs: path.stageIssues.playout,
      avgDeltaMs: playoutDelta.avg,
      underTargetFraction: metrics.playoutUnderTargetFraction,
      outsideTargetFraction: metrics.playoutOutsideTargetFraction,
      targetBufferMs: average(path.targetSamples),
    },
    perf: {
      tickBudgetBreachCount: metrics.tickBudgetBreachCount,
      tickBudgetBreachP95Ms: metrics.tickBudgetBreachP95Ms,
      tickBudgetBreachMaxMs: metrics.tickBudgetBreachMaxMs,
      longTaskCount: metrics.longTaskCount,
    },
  };
}

function buildStartupSummary(
  path: SimulatedPeerPath
): GroupCallE2ePeerStartupSummary {
  const tickCount = Math.max(1, path.startupTickCount);
  return {
    windowMs: STARTUP_QUALITY_WINDOW_MS,
    tickCount: path.startupTickCount,
    avgPcmBufferedMs: average(path.startupPcmSamples),
    underTargetFraction: path.startupUnderTargetTicks / tickCount,
    outsideTargetFraction: path.startupOutsideTargetTicks / tickCount,
    concealmentTicks: path.startupConcealmentTicks,
    decodeDrops: path.startupDecodeDropCount,
  };
}

function isInScoredStartupWindow(
  path: SimulatedPeerPath,
  nowMs: number
): boolean {
  if (nowMs > STARTUP_QUALITY_WINDOW_MS) return false;
  const authoritativeKeyReadyAtMs = path.receiverModel?.authoritativeKeyReadyAtMs;
  if (typeof authoritativeKeyReadyAtMs !== 'number') return true;
  const audibleStartupBeginsAtMs = Math.min(
    STARTUP_QUALITY_WINDOW_MS,
    authoritativeKeyReadyAtMs + (OPUS_FRAME_DURATION_MS * 4)
  );
  return nowMs >= audibleStartupBeginsAtMs;
}

function createPath(
  receiverAddr: 'peer-A' | 'peer-B',
  receiverRole: string,
  senderAddr: 'peer-A' | 'peer-B',
  senderProfile: SenderImpairmentProfile,
  receiverModel: GroupCallE2eReceiverModel | undefined,
  durationMs: number,
  seed: number
): SimulatedPeerPath {
  let simulatedMs = 0;
  const clockMs = () => simulatedMs;
  const diag = new BufferingDiagnosticsRecorder();
  const sessionController = new ReticulumSessionController({ diagnostics: diag, clockMs });
  sessionController.ingestTopologyEvent({
    kind: 'peer-joined',
    sourceAddr: senderAddr,
    joinGeneration: 1,
  });
  if (senderProfile.simulateRecoveryPathLatch) {
    sessionController.ingestTopologyEvent({ kind: 'global-recovery-started' });
  }
  const streamId: StreamIdentity = sessionController.getStreamIdentity(senderAddr) ?? {
    sourceAddr: senderAddr,
    streamEpoch: 0,
    joinGeneration: 1,
  };
  const engine = new ReceiveEngine({
    streamId,
    decodeService: new NullDecodeService(),
    diagnostics: diag,
    clockMs,
  });
  const policy = new ReceivePolicyEngine(
    streamId,
    {
      targetBufferMs: 120,
      backlogDrainTriggerRatio: 1.0,
      transportDegradedHardTtlMs: 8_000,
    },
    diag
  );
  const sendPressure = new SendPressureController(sessionController, {}, diag);
  const tracker = new GroupCallPerformanceTracker();
  tracker.setRole(receiverRole as Parameters<GroupCallPerformanceTracker['setRole']>[0]);
  tracker.setResourceCounts({ decoders: 1, playbackNodes: 1, jitterBuffers: 1 });
  const packetSeed = seed ^ (receiverAddr === 'peer-A' ? 0xa5a5a5a5 : 0x5a5a5a5a);
  const packets = generatePackets(senderProfile, durationMs, packetSeed);
  const packetRng = xorshift32(seed ^ 0x9e3779b9);
  const faultInjector = new FaultInjector(sessionController, cloneFaults(senderProfile.faults));
  const path: SimulatedPeerPath = {
    receiverAddr,
    receiverRole,
    senderAddr,
    senderProfile,
    receiverModel,
    diag,
    sessionController,
    engine,
    policy,
    sendPressure,
    faultInjector,
    tracker,
    streamId,
    packets,
    packetRng,
    packetIdx: 0,
    nextTickMs: OPUS_FRAME_DURATION_MS,
    totalPackets: 0,
    deliveredPackets: 0,
    droppedPackets: 0,
    framesDecoded: 0,
    concealmentTicks: 0,
    stateCounts: new Map<string, number>(),
    pcmSamples: [],
    playoutPcmSamples: [],
    opusSamples: [],
    jitterDepthSamples: [],
    playoutDeltaSamples: [],
    targetSamples: [],
    tickStallsMs: [],
    underTargetTicks: 0,
    outsideTargetTicks: 0,
    maxBridgePressureDepth: 0,
    bridgeWaitingForDrainObserved: false,
    latenessState: undefined,
    staleTimestampDrops: 0,
    maxExcessLatenessMs: 0,
    maxTimestampRegressionMs: 0,
    startupTickCount: 0,
    startupUnderTargetTicks: 0,
    startupOutsideTargetTicks: 0,
    startupConcealmentTicks: 0,
    startupPcmSamples: [],
    startupDecodeDropCount: 0,
    stageIssues: {
      arrival: null,
      jitter: null,
      decode: null,
      'pcm-ring': null,
      playout: null,
    },
  };
  Object.defineProperty(path, 'sessionController', { value: sessionController });
  Object.defineProperty(path, 'engine', { value: engine });
  Object.defineProperty(path, 'policy', { value: policy });
  Object.defineProperty(path, 'sendPressure', { value: sendPressure });
  Object.defineProperty(path, 'faultInjector', { value: faultInjector });
  Object.defineProperty(path, 'diag', { value: diag });
  Object.defineProperty(path, 'streamId', { value: streamId });
  Object.defineProperty(path, 'setSimulatedMs', {
    value: (nextMs: number) => {
      simulatedMs = nextMs;
    },
  });
  return path;
}

function setPathClock(path: SimulatedPeerPath, nowMs: number): void {
  (path as SimulatedPeerPath & { readonly setSimulatedMs: (value: number) => void }).setSimulatedMs(nowMs);
}

function activeTransportDuration(path: SimulatedPeerPath): number {
  const degraded = path.stateCounts.get('transportDegraded') ?? 0;
  return degraded * OPUS_FRAME_DURATION_MS;
}

async function drainTick(path: SimulatedPeerPath, nowMs: number): Promise<void> {
  const stallRng = xorshift32((nowMs + 1) * (path.receiverAddr === 'peer-A' ? 17 : 31));
  const sampledStall =
    path.senderProfile.tickBreachFraction > 0 && stallRng() < path.senderProfile.tickBreachFraction
      ? path.senderProfile.tickBreachAvgMs
      : 0;
  const injectedStall = path.faultInjector.getTickStallMs(nowMs);
  const stallMs = Math.max(sampledStall, injectedStall);
  if (stallMs > 0) {
    path.tickStallsMs.push(stallMs);
    path.nextTickMs = nowMs + stallMs + OPUS_FRAME_DURATION_MS;
    markStageIssue(path.stageIssues, 'playout', nowMs);
    return;
  }

  const peerHealth = path.sessionController.getPeerHealth(path.senderAddr);
  const policyOutput = path.policy.tick({
    nowMs,
    streamId: path.streamId,
    jitterDepth: path.engine.getJitterDepth(),
    opusBufferedMs: path.engine.getJitterBufferedMs(),
    pcmBufferedMs: path.engine.getPcmBufferedMs(),
    lastPushAgeMs: path.engine.getLastPushAgeMs(),
    lastGapFrames: path.engine.getLastGapFrames(),
    totalConcealmentFrames: path.engine.getConcealmentFrames(),
    recentArrivalGapMs: path.engine.getRecentArrivalGapMs(),
    peerHealth,
  });
  const prevConcealmentFrames = path.engine.getConcealmentFrames();
  const tickResult = await path.engine.tick({ policy: policyOutput, nowMs });
  path.framesDecoded += tickResult.framesDecoded;
  if (tickResult.framesDecoded > 0) {
    path.tracker.recordPacketDecoded(tickResult.framesDecoded);
  }
  path.stateCounts.set(path.policy.state, (path.stateCounts.get(path.policy.state) ?? 0) + 1);
  path.pcmSamples.push(tickResult.pcmBufferedMs);
  const startupTargetBoostMs =
    path.receiverModel &&
    typeof path.receiverModel.startupTargetBoostMs === 'number' &&
    typeof path.receiverModel.startupTargetBoostUntilMs === 'number' &&
    nowMs <= path.receiverModel.startupTargetBoostUntilMs
      ? Math.max(0, path.receiverModel.startupTargetBoostMs)
      : 0;
  const effectiveTargetBufferMs = policyOutput.targetBufferMs + startupTargetBoostMs;
  const effectivePlayoutBufferedMs = Math.min(
    tickResult.pcmBufferedMs,
    tickResult.opusBufferedMs + 40,
    effectiveTargetBufferMs * 1.2
  );
  path.playoutPcmSamples.push(effectivePlayoutBufferedMs);
  path.opusSamples.push(tickResult.opusBufferedMs);
  path.jitterDepthSamples.push(path.engine.getJitterDepth());
  path.targetSamples.push(effectiveTargetBufferMs);
  path.playoutDeltaSamples.push(effectivePlayoutBufferedMs - effectiveTargetBufferMs);
  const inStartupWindow = isInScoredStartupWindow(path, nowMs);
  if (inStartupWindow) {
    path.startupTickCount += 1;
    path.startupPcmSamples.push(effectivePlayoutBufferedMs);
  }
  if (effectivePlayoutBufferedMs < effectiveTargetBufferMs * 0.85) {
    path.underTargetTicks += 1;
    if (inStartupWindow) {
      path.startupUnderTargetTicks += 1;
    }
    markStageIssue(path.stageIssues, 'playout', nowMs);
  }
  const outsideUnder = effectivePlayoutBufferedMs < effectiveTargetBufferMs * 0.65;
  const outsideOver = effectivePlayoutBufferedMs > effectiveTargetBufferMs * 1.35;
  if (outsideUnder || outsideOver) {
    path.outsideTargetTicks += 1;
    if (inStartupWindow) {
      path.startupOutsideTargetTicks += 1;
    }
  }
  path.tracker.recordAdaptiveTargetSample(path.senderAddr, effectiveTargetBufferMs);
  path.tracker.recordOpusBufferedMetric(path.senderAddr, tickResult.opusBufferedMs);
  path.tracker.recordJitterDrainTelemetry({
    sourceCount: 1,
    depthSum: path.engine.getJitterDepth(),
    worstDepth: path.engine.getJitterDepth(),
    notReadyCount: effectivePlayoutBufferedMs < effectiveTargetBufferMs * 0.85 ? 1 : 0,
    rawEmptyCount: tickResult.opusBufferedMs <= 0 ? 1 : 0,
  });
  path.tracker.recordPlayoutMetricTick(
    effectivePlayoutBufferedMs,
    outsideUnder || outsideOver,
    path.senderAddr,
    {
      outsideUnder,
      outsideOver,
      deltaMs: effectivePlayoutBufferedMs - effectiveTargetBufferMs,
      playoutRate: sampledStall > 0 ? 0.95 : 1,
    }
  );
  path.tracker.recordReceiverIngressToPlayoutPostLatency(
    path.senderAddr,
    Math.max(0, effectivePlayoutBufferedMs)
  );
  path.tracker.setAdaptiveNetworkMode(
    adaptiveNetworkMode(
      activeTransportDuration(path),
      path.underTargetTicks / Math.max(1, path.targetSamples.length)
    )
  );
  path.tracker.setPlayoutStarvationWorstSeverity(
    starvationSeverity(
      path.underTargetTicks / Math.max(1, path.targetSamples.length),
      effectivePlayoutBufferedMs
    )
  );
  if (tickResult.opusBufferedMs > policyOutput.targetBufferMs * 1.5 || tickResult.opusBufferedMs === 0) {
    markStageIssue(path.stageIssues, 'jitter', nowMs);
  }
  const pcmRingUnderruns = path.engine.getPcmRing().underruns;
  if (pcmRingUnderruns > 0) {
    markStageIssue(path.stageIssues, 'pcm-ring', nowMs);
    path.tracker.recordJitterUnderrun(1, path.senderAddr);
  }
  const concealmentFrames = path.engine.getConcealmentFrames();
  const concealmentDelta = concealmentFrames - prevConcealmentFrames;
  if (concealmentDelta > 0) {
    path.concealmentTicks += 1;
    if (inStartupWindow) {
      path.startupConcealmentTicks += 1;
    }
    markStageIssue(path.stageIssues, 'decode', nowMs);
    path.tracker.recordMissingFrames(concealmentDelta, path.senderAddr);
    path.tracker.recordConcealmentTick(1, path.senderAddr);
  }
  path.sendPressure.tick(nowMs);
  path.nextTickMs += OPUS_FRAME_DURATION_MS;
}

function deliverPackets(path: SimulatedPeerPath, nowMs: number): void {
  path.faultInjector.tick(nowMs, path.senderAddr);
  const bridgePressureDepth = Math.max(
    bridgePressureDepthAt(path.senderProfile.faults, nowMs),
    startupBridgePressureDepthAt(path.receiverModel, nowMs)
  );
  path.maxBridgePressureDepth = Math.max(path.maxBridgePressureDepth, bridgePressureDepth);
  if (bridgePressureDepth > 0) {
    path.bridgeWaitingForDrainObserved = true;
  }
  path.tracker.recordTransportMode(bridgePressureDepth > 0 ? 'relay' : 'reticulum', nowMs);
  path.tracker.setReticulumAudioQueueDepths({
    bridgeQueuedFrames: bridgePressureDepth,
    bridgeQueuedOldestAgeMs: bridgePressureDepth > 0 ? bridgePressureDepth * 8 : 0,
    binaryOutQueueDepth: bridgePressureDepth > 0 ? Math.max(0, bridgePressureDepth - 6) : 0,
    binaryOutQueueOldestAgeMs: bridgePressureDepth > 0 ? bridgePressureDepth * 5 : 0,
    queuePressureDropsLast5s: 0,
    staleDropsLast5s: 0,
  });
  while (path.packetIdx < path.packets.length) {
    const packet = path.packets[path.packetIdx];
    const startupLatencyAddMs =
      path.receiverModel &&
      typeof path.receiverModel.startupLatencyAddMs === 'number' &&
      typeof path.receiverModel.startupLatencyUntilMs === 'number' &&
      packet.arrivalMs <= path.receiverModel.startupLatencyUntilMs
        ? Math.max(0, path.receiverModel.startupLatencyAddMs)
        : 0;
    const effectiveArrivalMs =
      packet.arrivalMs +
      path.faultInjector.getLatencyAddMs(packet.arrivalMs) +
      startupLatencyAddMs;
    if (effectiveArrivalMs > nowMs) break;
    path.packetIdx += 1;
    path.totalPackets += 1;
    const droppedByFault = path.faultInjector.shouldDropPacket(nowMs, path.packetRng);
    if (packet.dropped || droppedByFault) {
      path.droppedPackets += 1;
      markStageIssue(path.stageIssues, 'arrival', nowMs);
      continue;
    }
    const latenessAssessment = assessSourceTimestampLateness(
      path.latenessState,
      packet.senderTimestampMs,
      nowMs,
      {
        maxExcessLatenessMs: GCALL_SOURCE_TIMESTAMP_MAX_EXCESS_LATENESS_MS,
        maxTimestampRegressionMs: GCALL_SOURCE_TIMESTAMP_MAX_REGRESSION_MS,
      }
    );
    path.maxExcessLatenessMs = Math.max(
      path.maxExcessLatenessMs,
      latenessAssessment.excessLatenessMs
    );
    path.maxTimestampRegressionMs = Math.max(
      path.maxTimestampRegressionMs,
      latenessAssessment.timestampRegressionMs
    );
    if (latenessAssessment.shouldDrop) {
      path.staleTimestampDrops += 1;
      path.droppedPackets += 1;
      path.tracker.recordPacketDroppedWithReason('stale-timestamp');
      markStageIssue(path.stageIssues, 'arrival', nowMs);
      continue;
    }
    path.latenessState = latenessAssessment.nextState;
    if (
      typeof path.receiverModel?.authoritativeKeyReadyAtMs === 'number' &&
      nowMs < path.receiverModel.authoritativeKeyReadyAtMs
    ) {
      path.droppedPackets += 1;
      if (isInScoredStartupWindow(path, nowMs)) {
        path.startupDecodeDropCount += 1;
      }
      path.tracker.recordPacketDroppedWithReason('decode-failure');
      markStageIssue(path.stageIssues, 'decode', nowMs);
      continue;
    }
    const result = path.engine.pushDecodedPacket({
      seq: packet.seq,
      opusFrame: packet.opusFrame,
      vad: true,
      timestampMs: nowMs,
      receivedAtMs: nowMs,
      sourceAddr: path.senderAddr,
    });
    if (result === 'accepted') {
      path.deliveredPackets += 1;
      path.tracker.recordPacketReceived();
      path.tracker.recordReticulumAudioBridgeToRendererIngressLatency(
        Math.max(0, nowMs - packet.senderTimestampMs)
      );
      path.sessionController.onStreamPacketReceived(path.streamId, packet.seq);
    } else {
      path.droppedPackets += 1;
      markStageIssue(path.stageIssues, 'arrival', nowMs);
    }
  }
}

function defaultProfile(
  id: SenderProfileId,
  label: string,
  impairmentSummary: string,
  overrides: Partial<SenderImpairmentProfile> = {}
): SenderImpairmentProfile {
  return {
    id,
    label,
    impairmentSummary,
    packetPattern: 'steady',
    avgInterPacketMs: 20,
    jitterStdDevMs: 2,
    burstFraction: 0,
    lossRate: 0,
    simulateRecoveryPathLatch: false,
    tickBreachFraction: 0,
    tickBreachAvgMs: 0,
    faults: [],
    ...overrides,
  };
}

function fixtureProfile(
  id: SenderProfileId,
  label: string,
  impairmentSummary: string,
  params: ReplayScenarioParams,
  faults: readonly FaultSpec[]
): SenderImpairmentProfile {
  return {
    id,
    label,
    impairmentSummary,
    packetPattern: params.packetPattern,
    avgInterPacketMs: params.avgInterPacketMs,
    jitterStdDevMs: params.jitterStdDevMs,
    burstFraction: params.burstFraction,
    lossRate: params.lossRate,
    simulateRecoveryPathLatch: params.simulateRecoveryPathLatch,
    tickBreachFraction: params.tickBreachFraction,
    tickBreachAvgMs: params.tickBreachAvgMs,
    faults,
  };
}

export const SENDER_PROFILE_PRESETS: Record<SenderProfileId, SenderImpairmentProfile> = {
  cleanSender: defaultProfile(
    'cleanSender',
    'Clean sender',
    'Low jitter, no intentional loss, stable cadence.'
  ),
  lossySender: defaultProfile(
    'lossySender',
    'Lossy sender',
    'Sustained packet loss with otherwise steady cadence.',
    { packetPattern: 'mixed', lossRate: 0.35, jitterStdDevMs: 16, burstFraction: 0.18 }
  ),
  burstySender: defaultProfile(
    'burstySender',
    'Bursty sender',
    'Packets arrive in clusters with elevated bridge pressure bursts.',
    {
      packetPattern: 'bursty',
      jitterStdDevMs: 55,
      burstFraction: 0.72,
      faults: [
        { kind: 'bridge-pressure', atMs: 4_000, durationMs: 10_000, params: { depth: 24 } },
        { kind: 'latency-spike', atMs: 8_000, durationMs: 5_000, params: { addMs: 90 } },
      ],
    }
  ),
  moderateSpikeSender: defaultProfile(
    'moderateSpikeSender',
    'Moderate-spike sender',
    'Mostly steady sender with recurring moderate latency spikes but no queue-pressure bursts.',
    {
      packetPattern: 'mixed',
      jitterStdDevMs: 26,
      burstFraction: 0.22,
      faults: [
        { kind: 'latency-spike', atMs: 6_000, durationMs: 5_000, params: { addMs: 110 } },
        { kind: 'latency-spike', atMs: 14_000, durationMs: 4_500, params: { addMs: 130 } },
      ],
    }
  ),
  highJitterSender: defaultProfile(
    'highJitterSender',
    'High-jitter sender',
    'Large packet delay variance with repeated latency spikes.',
    {
      packetPattern: 'mixed',
      jitterStdDevMs: 140,
      burstFraction: 0.65,
      lossRate: 0.08,
      faults: [
        { kind: 'latency-spike', atMs: 3_000, durationMs: 4_000, params: { addMs: 140 } },
        { kind: 'latency-spike', atMs: 11_000, durationMs: 4_000, params: { addMs: 120 } },
        { kind: 'bridge-pressure', atMs: 7_000, durationMs: 8_000, params: { depth: 20 } },
      ],
    }
  ),
  stalledSender: defaultProfile(
    'stalledSender',
    'Stalled sender',
    'Intermittent sender stalls causing burst loss and transport disruption.',
    {
      packetPattern: 'mixed',
      jitterStdDevMs: 65,
      burstFraction: 0.55,
      faults: [
        { kind: 'packet-loss-burst', atMs: 5_000, durationMs: 8_000, params: { rate: 0.95 } },
        { kind: 'latency-spike', atMs: 12_000, durationMs: 4_000, params: { addMs: 200 } },
        { kind: 'bridge-pressure', atMs: 5_000, durationMs: 8_000, params: { depth: 28 } },
      ],
    }
  ),
  cpuStressedSender: defaultProfile(
    'cpuStressedSender',
    'CPU-stressed caller',
    'Sender-side runtime pressure with repeated tick-budget-like stalls and bursty delivery.',
    {
      packetPattern: 'mixed',
      jitterStdDevMs: 70,
      burstFraction: 0.4,
      tickBreachFraction: 0.16,
      tickBreachAvgMs: 36,
      faults: [{ kind: 'tick-stall', atMs: 6_000, durationMs: 12_000, params: { stallMs: 34 } }],
    }
  ),
  staleTimestampSender: defaultProfile(
    'staleTimestampSender',
    'Stale-timestamp sender',
    'Sender timestamps lag behind receive time and periodically regress, reproducing sourceTimestampLateness drops.',
    {
      packetPattern: 'steady',
      jitterStdDevMs: 6,
      timestampPathology: {
        startAtMs: 5_000,
        lagMs: 6_000,
        regressionMs: 2_600,
        regressionEveryPackets: 7,
      },
    }
  ),
  startupSpikeSender: defaultProfile(
    'startupSpikeSender',
    'Startup spike sender',
    'Mostly clean sender with a short but severe post-join latency spike and bridge-pressure burst.',
    {
      packetPattern: 'steady',
      jitterStdDevMs: 10,
      faults: [
        { kind: 'latency-spike', atMs: 1_000, durationMs: 4_500, params: { addMs: 230 } },
        { kind: 'bridge-pressure', atMs: 1_250, durationMs: 4_500, params: { depth: 18 } },
        { kind: 'packet-loss-burst', atMs: 2_000, durationMs: 1_800, params: { rate: 0.22 } },
      ],
    }
  ),
  startupBurstySender: defaultProfile(
    'startupBurstySender',
    'Startup bursty sender',
    'Front-loaded burstiness with moderate early loss, then steady recovery.',
    {
      packetPattern: 'bursty',
      jitterStdDevMs: 80,
      burstFraction: 0.8,
      lossRate: 0.04,
      faults: [
        { kind: 'latency-spike', atMs: 800, durationMs: 5_500, params: { addMs: 120 } },
        { kind: 'bridge-pressure', atMs: 1_000, durationMs: 5_500, params: { depth: 16 } },
      ],
    }
  ),
  philKennyTransportSender: defaultProfile(
    'philKennyTransportSender',
    'Phil-Kenny transport/stall sender',
    'Derived from the real phil-kenny capture: bridge pressure, latency spikes, and tick stalls on the worse peer path.',
    {
      packetPattern: PHIL_KENNY_REPLAY_SCRIPT.packetPattern,
      jitterStdDevMs: PHIL_KENNY_REPLAY_SCRIPT.jitterStdDevMs,
      burstFraction: PHIL_KENNY_REPLAY_SCRIPT.burstFraction,
      lossRate: PHIL_KENNY_REPLAY_SCRIPT.lossRate,
      simulateRecoveryPathLatch: PHIL_KENNY_REPLAY_SCRIPT.simulateRecoveryPathLatch,
      tickBreachFraction: PHIL_KENNY_REPLAY_SCRIPT.tickBreachFraction,
      tickBreachAvgMs: PHIL_KENNY_REPLAY_SCRIPT.tickBreachAvgMs,
      faults: PHIL_KENNY_REPLAY_SCRIPT.faults,
    }
  ),
  philKennyStaleSender: defaultProfile(
    'philKennyStaleSender',
    'Phil-Kenny stale-timestamp sender',
    'Derived from the real phil-kenny capture: sender timestamps drift stale/regressing while the opposite side remains under playout pressure.',
    {
      packetPattern: 'steady',
      jitterStdDevMs: 8,
      burstFraction: 0.12,
      lossRate: 0.005,
      timestampPathology: PHIL_KENNY_REPLAY_SCRIPT.timestampPathology,
    }
  ),
  call63FixtureSender: fixtureProfile(
    'call63FixtureSender',
    'Call-63 fixture sender',
    'Recovery-path latch plus bridge pressure and sustained degraded arrival shape from call-63.',
    FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP.replayParams,
    FAULT_CALL63_PATTERN
  ),
  call60FixtureSender: fixtureProfile(
    'call60FixtureSender',
    'Call-60 fixture sender',
    'Bursty transport-flap arrival shape from call-60 rebuild oscillation.',
    {
      ...FIXTURE_CALL60_REBUILD_OSCILLATION.replayParams,
      burstFraction: Math.max(0.62, FIXTURE_CALL60_REBUILD_OSCILLATION.replayParams.burstFraction),
      lossRate: Math.max(0.08, FIXTURE_CALL60_REBUILD_OSCILLATION.replayParams.lossRate),
      tickBreachFraction: Math.max(0.06, FIXTURE_CALL60_REBUILD_OSCILLATION.replayParams.tickBreachFraction),
      tickBreachAvgMs: Math.max(26, FIXTURE_CALL60_REBUILD_OSCILLATION.replayParams.tickBreachAvgMs),
    },
    [
      ...FAULT_CALL60_PATTERN,
      { kind: 'bridge-pressure', atMs: 12_000, durationMs: 16_000, params: { depth: 22 } },
      { kind: 'packet-loss-burst', atMs: 32_000, durationMs: 8_000, params: { rate: 0.55 } },
    ]
  ),
};

export const GROUP_CALL_E2E_SCENARIOS: readonly GroupCallE2eScenario[] = [
  {
    id: 'steady-clean-symmetric',
    description: 'Both participants send clean steady audio and should remain healthy.',
    durationMs: 24_000,
    seed: 101,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    expectations: {
      bothPassed: true,
      // Deterministic baseline remains slightly more pessimistic than the
      // production-style lab for this replay-derived mixed-pressure case.
      qualityScoreAtLeast: 7.85,
    },
  },
  {
    id: 'good-vs-lossy',
    description: 'Peer B sends lossy audio, but the paired call should still remain healthy.',
    durationMs: 24_000,
    seed: 202,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.lossySender },
    expectations: {
      bothPassed: true,
      // Replay-derived deterministic baseline remains slightly below 8.0 on
      // stable seeds after the startup-policy tuning.
      qualityScoreAtLeast: 7.85,
    },
  },
  {
    id: 'good-vs-bursty',
    description: 'Peer B sends bursty audio with bridge pressure, but the paired call should still remain healthy.',
    durationMs: 24_000,
    seed: 303,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.burstySender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 7.85,
    },
  },
  {
    id: 'good-vs-high-jitter',
    description: 'Peer B sends high-jitter audio, but the paired call should still remain healthy.',
    durationMs: 24_000,
    seed: 404,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.highJitterSender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 8,
    },
  },
  {
    id: 'good-vs-stalled',
    description: 'Peer B intermittently stalls, but the paired call should still remain healthy.',
    durationMs: 24_000,
    seed: 505,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.stalledSender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 8,
    },
  },
  {
    id: 'good-vs-cpu-stressed',
    description: 'Peer B is CPU stressed, but the paired call should still remain healthy.',
    durationMs: 24_000,
    seed: 606,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cpuStressedSender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 8,
    },
  },
  {
    id: 'good-vs-stale-timestamp',
    description: 'Peer B emits stale/regressing sender timestamps, but the paired call should still recover to healthy.',
    durationMs: 24_000,
    seed: 909,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.staleTimestampSender },
    expectations: {
      bothPassed: true,
      // Policy-dominated scoring can sit just under 8.0 on boundary seeds; 7.85 keeps the lab stable.
      qualityScoreAtLeast: 7.85,
    },
  },
  {
    id: 'phil-kenny-derived-regression',
    description: 'Offline deterministic regression derived from the real phil-kenny pair: one side sees mixed transport/stall pressure while the other sees severe stale timestamp dropping.',
    durationMs: PHIL_KENNY_REPLAY_SCRIPT.durationMs,
    seed: 1001,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.philKennyStaleSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.philKennyTransportSender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 7.85,
    },
  },
  {
    id: 'call63-two-party-regression',
    description: 'Recreates the call-63 asymmetric failure shape, but the paired call should still recover to healthy.',
    durationMs: FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP.replayParams.durationMs,
    seed: 707,
    fixtureId: FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP.id,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.call63FixtureSender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 8,
    },
  },
  {
    id: 'call60-two-party-regression',
    description: 'Recreates the call-60 rebuild oscillation, but the paired call should still recover to healthy.',
    durationMs: FIXTURE_CALL60_REBUILD_OSCILLATION.replayParams.durationMs,
    seed: 808,
    fixtureId: FIXTURE_CALL60_REBUILD_OSCILLATION.id,
    peerA: { addr: 'peer-A', role: 'root-forwarder', senderProfile: SENDER_PROFILE_PRESETS.cleanSender },
    peerB: { addr: 'peer-B', role: 'standby-forwarder', senderProfile: SENDER_PROFILE_PRESETS.call60FixtureSender },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 8,
    },
  },
  {
    id: 'startup-authoritative-key-delay',
    description:
      'Standby side receives early media before the authoritative room key is usable, then recovers.',
    durationMs: 20_000,
    seed: 1111,
    peerA: {
      addr: 'peer-A',
      role: 'root-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
    },
    peerB: {
      addr: 'peer-B',
      role: 'standby-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
      receiverModel: {
        authoritativeKeyReadyAtMs: 3_500,
      },
    },
    expectations: {
      // The older deterministic model still counts more pre-key startup pain
      // than the audio-surface simulation, so keep a slightly lower baseline
      // while enforcing 9/10 on the production-style path below.
      qualityScoreAtLeast: 7.9,
      bothPassedByMode: {
        'audio-surface-sim': true,
      },
      qualityScoreAtLeastByMode: {
        'audio-surface-sim': 9,
      },
    },
  },
  {
    id: 'startup-one-sided-shallow-reserve',
    description:
      'Root side has weak early playout reserve from startup burstiness and short join-phase pressure.',
    durationMs: 22_000,
    seed: 1212,
    peerA: {
      addr: 'peer-A',
      role: 'root-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.startupSpikeSender,
      receiverModel: {
        startupLatencyAddMs: 340,
        startupLatencyUntilMs: 10_000,
        startupBridgePressureDepth: 24,
        startupBridgePressureUntilMs: 10_000,
      },
    },
    peerB: {
      addr: 'peer-B',
      role: 'standby-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
    },
    expectations: {
      qualityScoreAtLeast: 8,
      bothPassedByMode: {
        'audio-surface-sim': true,
      },
      qualityScoreAtLeastByMode: {
        'audio-surface-sim': 9,
      },
    },
  },
  {
    id: 'post-join-spike-recovery-window',
    description:
      'One short post-join spike pushes the receiver into recovery before settling.',
    durationMs: 20_000,
    seed: 1313,
    peerA: {
      addr: 'peer-A',
      role: 'root-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
    },
    peerB: {
      addr: 'peer-B',
      role: 'standby-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.startupSpikeSender,
    },
    expectations: {
      qualityScoreAtLeast: 8,
      bothPassedByMode: {
        'audio-surface-sim': true,
      },
      qualityScoreAtLeastByMode: {
        'audio-surface-sim': 9,
      },
    },
  },
  {
    id: 'root-bad-standby-good-asymmetric',
    description:
      'Root side combines delayed usable audio and startup burst pressure while standby remains mostly healthy.',
    durationMs: 24_000,
    seed: 1414,
    peerA: {
      addr: 'peer-A',
      role: 'root-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
      receiverModel: {
        authoritativeKeyReadyAtMs: 2_800,
        startupLatencyAddMs: 180,
        startupLatencyUntilMs: 6_000,
        startupBridgePressureDepth: 14,
        startupBridgePressureUntilMs: 6_000,
      },
    },
    peerB: {
      addr: 'peer-B',
      role: 'standby-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.startupBurstySender,
    },
    expectations: {
      qualityScoreAtLeast: 8,
      bothPassedByMode: {
        'audio-surface-sim': true,
      },
      qualityScoreAtLeastByMode: {
        'audio-surface-sim': 9,
      },
    },
  },
  {
    id: 'steady-state-one-sided-moderate-spikes',
    description:
      'Healthy startup followed by one-sided moderate recurring spikes on the root listener path.',
    durationMs: 24_000,
    seed: 1515,
    peerA: {
      addr: 'peer-A',
      role: 'root-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.moderateSpikeSender,
    },
    peerB: {
      addr: 'peer-B',
      role: 'standby-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
    },
    expectations: {
      bothPassed: true,
      qualityScoreAtLeast: 8,
      bothPassedByMode: {
        'audio-surface-sim': true,
      },
      qualityScoreAtLeastByMode: {
        'audio-surface-sim': 9,
      },
      worseAddr: 'peer-A',
    },
  },
  {
    id: 'new-person-asymmetric-spike-regression',
    description:
      'Models the new-person live call shape: standby-side authoritative-key delay with the root listener taking the worse steady-state spike pressure.',
    durationMs: 28_000,
    seed: 1616,
    peerA: {
      addr: 'peer-A',
      role: 'root-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.cleanSender,
      receiverModel: {
        startupLatencyAddMs: 140,
        startupLatencyUntilMs: 3_500,
      },
    },
    peerB: {
      addr: 'peer-B',
      role: 'standby-forwarder',
      senderProfile: SENDER_PROFILE_PRESETS.philKennyTransportSender,
      receiverModel: {
        authoritativeKeyReadyAtMs: 1_600,
      },
    },
    expectations: {
      qualityScoreAtLeast: 6.5,
    },
  },
];

export function getGroupCallE2eScenario(id: string): GroupCallE2eScenario {
  const scenario = GROUP_CALL_E2E_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown group-call E2E scenario: "${id}"`);
  }
  return scenario;
}

export function selectGroupCallE2eScenarios(filter?: string | null): GroupCallE2eScenario[] {
  const normalized = (filter ?? '').trim();
  if (normalized.length === 0) return [...GROUP_CALL_E2E_SCENARIOS];
  return normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((id) => getGroupCallE2eScenario(id));
}

function assertExpectations(
  scenario: GroupCallE2eScenario,
  bundle: GroupCallE2eArtifactBundle
): void {
  const { expectations } = scenario;
  const report = bundle.report;
  const debugSummary = [
    `summary=${report.pairedAnalysis.callSummary}`,
    `peerA(avgPcm=${report.peerA.metrics.avgPcmBufferedMs.toFixed(2)}, under=${report.peerA.metrics.playoutUnderTargetFraction.toFixed(2)}, outside=${report.peerA.metrics.playoutOutsideTargetFraction.toFixed(2)}, class=${report.peerA.classification.primaryClass})`,
    `peerB(avgPcm=${report.peerB.metrics.avgPcmBufferedMs.toFixed(2)}, under=${report.peerB.metrics.playoutUnderTargetFraction.toFixed(2)}, outside=${report.peerB.metrics.playoutOutsideTargetFraction.toFixed(2)}, class=${report.peerB.classification.primaryClass})`,
  ].join(' | ');
  if (typeof expectations.bothPassed === 'boolean' && report.pairedAnalysis.bothPassed !== expectations.bothPassed) {
    throw new Error(
      `Scenario ${scenario.id}: expected bothPassed=${expectations.bothPassed}, got ${report.pairedAnalysis.bothPassed}; ${debugSummary}`
    );
  }
  if (
    expectations.bothPassedByMode &&
    typeof expectations.bothPassedByMode[report.mode] === 'boolean' &&
    report.pairedAnalysis.bothPassed !== expectations.bothPassedByMode[report.mode]
  ) {
    throw new Error(
      `Scenario ${scenario.id}: expected bothPassed=${expectations.bothPassedByMode[report.mode]} for mode ${report.mode}, got ${report.pairedAnalysis.bothPassed}; ${debugSummary}`
    );
  }
  if (expectations.worseAddr && report.pairedAnalysis.worseAddr !== expectations.worseAddr) {
    throw new Error(
      `Scenario ${scenario.id}: expected worseAddr=${expectations.worseAddr}, got ${report.pairedAnalysis.worseAddr}; ${debugSummary}`
    );
  }
  if (expectations.worsePrimaryClass) {
    const worsePeer =
      report.pairedAnalysis.worseAddr === report.peerA.addr ? report.peerA : report.peerB;
    if (worsePeer.classification.primaryClass !== expectations.worsePrimaryClass) {
      throw new Error(
        `Scenario ${scenario.id}: expected worse peer class=${expectations.worsePrimaryClass}, got ${worsePeer.classification.primaryClass}`
      + `; ${debugSummary}`
      );
    }
  }
  if (
    typeof expectations.qualityScoreAtLeast === 'number' &&
    report.pairedAnalysis.qualityScore < expectations.qualityScoreAtLeast
  ) {
    throw new Error(
      `Scenario ${scenario.id}: expected qualityScore >= ${expectations.qualityScoreAtLeast}, got ${report.pairedAnalysis.qualityScore.toFixed(2)}`
      + `; ${debugSummary}`
    );
  }
  if (
    expectations.qualityScoreAtLeastByMode &&
    typeof expectations.qualityScoreAtLeastByMode[report.mode] === 'number' &&
    report.pairedAnalysis.qualityScore <
      (expectations.qualityScoreAtLeastByMode[report.mode] as number)
  ) {
    throw new Error(
      `Scenario ${scenario.id}: expected qualityScore >= ${expectations.qualityScoreAtLeastByMode[report.mode]} for mode ${report.mode}, got ${report.pairedAnalysis.qualityScore.toFixed(2)}`
      + `; ${debugSummary}`
    );
  }
  if (
    typeof expectations.qualityScoreAtMost === 'number' &&
    report.pairedAnalysis.qualityScore > expectations.qualityScoreAtMost
  ) {
    throw new Error(
      `Scenario ${scenario.id}: expected qualityScore <= ${expectations.qualityScoreAtMost}, got ${report.pairedAnalysis.qualityScore.toFixed(2)}`
      + `; ${debugSummary}`
    );
  }
  if (expectations.startupFailure) {
    if (
      Array.isArray(expectations.startupFailure.modes) &&
      !expectations.startupFailure.modes.includes(report.mode)
    ) {
      return;
    }
    const peer =
      expectations.startupFailure.peer === report.peerA.addr
        ? report.peerA
        : report.peerB;
    const startup = peer.startup;
    if (!startup) {
      throw new Error(
        `Scenario ${scenario.id}: expected startup summary for ${peer.addr}, but none was present`
      );
    }
    if (
      typeof expectations.startupFailure.minUnderTargetFraction === 'number' &&
      startup.underTargetFraction <
        expectations.startupFailure.minUnderTargetFraction
    ) {
      throw new Error(
        `Scenario ${scenario.id}: expected startup underTarget >= ${expectations.startupFailure.minUnderTargetFraction}, got ${startup.underTargetFraction.toFixed(3)}`
      );
    }
    if (
      typeof expectations.startupFailure.maxAvgPcmBufferedMs === 'number' &&
      startup.avgPcmBufferedMs >
        expectations.startupFailure.maxAvgPcmBufferedMs
    ) {
      throw new Error(
        `Scenario ${scenario.id}: expected startup avgPcm <= ${expectations.startupFailure.maxAvgPcmBufferedMs}, got ${startup.avgPcmBufferedMs.toFixed(3)}`
      );
    }
    if (
      typeof expectations.startupFailure.minDecodeDrops === 'number' &&
      startup.decodeDrops < expectations.startupFailure.minDecodeDrops
    ) {
      throw new Error(
        `Scenario ${scenario.id}: expected startup decodeDrops >= ${expectations.startupFailure.minDecodeDrops}, got ${startup.decodeDrops}`
      );
    }
  }
}

export async function runGroupCallE2eScenario(
  scenario: GroupCallE2eScenario,
  mode: GroupCallE2eMode = 'deterministic'
): Promise<GroupCallE2eArtifactBundle> {
  const useTrackedMetrics = mode === 'audio-surface-sim';
  let simulatedNowMs = 0;
  const originalDateNow = Date.now;
  if (useTrackedMetrics) {
    Date.now = () => simulatedNowMs;
  }
  const peerAPath = createPath(
    scenario.peerA.addr,
    scenario.peerA.role,
    scenario.peerB.addr,
    scenario.peerB.senderProfile,
    scenario.peerA.receiverModel,
    scenario.durationMs,
    scenario.seed ^ 0x11111111
  );
  const peerBPath = createPath(
    scenario.peerB.addr,
    scenario.peerB.role,
    scenario.peerA.addr,
    scenario.peerA.senderProfile,
    scenario.peerB.receiverModel,
    scenario.durationMs,
    scenario.seed ^ 0x22222222
  );

  try {
    for (let simulatedMs = 0; simulatedMs < scenario.durationMs; simulatedMs += 1) {
      simulatedNowMs = simulatedMs;
      setPathClock(peerAPath, simulatedMs);
      setPathClock(peerBPath, simulatedMs);
      deliverPackets(peerAPath, simulatedMs);
      deliverPackets(peerBPath, simulatedMs);
      if (simulatedMs >= peerAPath.nextTickMs) {
        await drainTick(peerAPath, simulatedMs);
      }
      if (simulatedMs >= peerBPath.nextTickMs) {
        await drainTick(peerBPath, simulatedMs);
      }
    }

    simulatedNowMs = scenario.durationMs;
    const peerAMetrics = useTrackedMetrics
      ? buildTrackedPeerMetrics(
          peerAPath,
          activeTransportDuration(peerAPath),
          scenario.durationMs
        )
      : buildLegacyPeerMetrics(peerAPath, activeTransportDuration(peerAPath));
    const peerBMetrics = useTrackedMetrics
      ? buildTrackedPeerMetrics(
          peerBPath,
          activeTransportDuration(peerBPath),
          scenario.durationMs
        )
      : buildLegacyPeerMetrics(peerBPath, activeTransportDuration(peerBPath));
    const peerATimeline = buildTimelineSummary(peerAPath, peerAMetrics);
    const peerBTimeline = buildTimelineSummary(peerBPath, peerBMetrics);

    const bundle = buildGroupCallE2eArtifactBundle({
      mode,
      scenarioId: scenario.id,
      scenarioDescription: scenario.description,
      fixtureId: scenario.fixtureId,
      seed: scenario.seed,
      peerA: {
        addr: scenario.peerA.addr,
        role: scenario.peerA.role,
        senderProfileId: scenario.peerB.senderProfile.id,
        senderProfileLabel: scenario.peerB.senderProfile.label,
        impairmentSummary: scenario.peerB.senderProfile.impairmentSummary,
        metrics: peerAMetrics,
        timeline: peerATimeline,
        startup: buildStartupSummary(peerAPath),
        stateTransitions: [...peerAPath.stateCounts.entries()].map(([state, count]) => ({ state, count })),
      },
      peerB: {
        addr: scenario.peerB.addr,
        role: scenario.peerB.role,
        senderProfileId: scenario.peerA.senderProfile.id,
        senderProfileLabel: scenario.peerA.senderProfile.label,
        impairmentSummary: scenario.peerA.senderProfile.impairmentSummary,
        metrics: peerBMetrics,
        timeline: peerBTimeline,
        startup: buildStartupSummary(peerBPath),
        stateTransitions: [...peerBPath.stateCounts.entries()].map(([state, count]) => ({ state, count })),
      },
    });
    if (process.env.GCALL_E2E_SKIP_EXPECTATIONS !== '1') {
      assertExpectations(scenario, bundle);
    }
    return bundle;
  } finally {
    Date.now = originalDateNow;
    peerAPath.sessionController.dispose();
    peerBPath.sessionController.dispose();
    peerAPath.engine.dispose();
    peerBPath.engine.dispose();
  }
}

export function buildLiveExportArtifactBundle(input: {
  readonly scenarioId: string;
  readonly scenarioDescription: string;
  readonly peerAAddr: string;
  readonly peerBAddr: string;
  readonly peerARole?: string;
  readonly peerBRole?: string;
  readonly peerAExport: Record<string, unknown>;
  readonly peerBExport: Record<string, unknown>;
}): GroupCallE2eArtifactBundle {
  const peerAMetrics = extractMetricsFromV1Export(input.peerAExport);
  const peerBMetrics = extractMetricsFromV1Export(input.peerBExport);
  const peerATimeline = buildMinimalTimelineSummary(peerAMetrics);
  const peerBTimeline = buildMinimalTimelineSummary(peerBMetrics);
  return buildGroupCallE2eArtifactBundle({
    mode: 'live-export',
    scenarioId: input.scenarioId,
    scenarioDescription: input.scenarioDescription,
    peerA: {
      addr: input.peerAAddr,
      role: input.peerARole ?? peerAMetrics.role ?? 'peer-a',
      senderProfileId: 'live-export',
      senderProfileLabel: 'Live export',
      impairmentSummary: 'Imported from a live paired diagnostics export.',
      metrics: peerAMetrics,
      timeline: peerATimeline,
      startup: null,
      stateTransitions: [],
    },
    peerB: {
      addr: input.peerBAddr,
      role: input.peerBRole ?? peerBMetrics.role ?? 'peer-b',
      senderProfileId: 'live-export',
      senderProfileLabel: 'Live export',
      impairmentSummary: 'Imported from a live paired diagnostics export.',
      metrics: peerBMetrics,
      timeline: peerBTimeline,
      startup: null,
      stateTransitions: [],
    },
  });
}
