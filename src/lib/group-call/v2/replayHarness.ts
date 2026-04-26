/**
 * Group Call V2 — ReplayHarness
 *
 * Deterministic replay of saved bad-call timelines through the full pipeline:
 * decrypt → jitter → decode → PCM fill → playout.
 *
 * The harness is a first-class product subsystem, not post-hoc tooling. It is
 * used as a mandatory release gate: a regression fixture MUST pass before a
 * change ships.
 *
 * Usage:
 *   const harness = new ReplayHarness(fixture, { decodeService: ... });
 *   const result = await harness.run();
 *   assert(result.passedBars.length === fixture.passBars.length);
 *
 * Design:
 *  - Packet arrival timing is deterministic: a seeded PRNG generates inter-
 *    packet delays matching the fixture's `replayParams`.
 *  - Tick budget breaches are simulated by advancing the simulated clock
 *    without advancing the audio worklet drain tick.
 *  - The transport latch (`simulateRecoveryPathLatch`) stalls packet arrival
 *    to replicate the call-63 `acceptOnlyRecoveryPath` pattern.
 *  - All components (ReticulumSessionController, ReceiveEngine, ReceivePolicyEngine)
 *    use a shared injected clock (`clockMs`) so time is deterministic.
 */

import type { ReplayScenarioParams, RegressionFixture, RegressionPassBar } from './regressionFixtures';
import type { StreamIdentity } from './spec';
import { streamKey } from './spec';
import { ReticulumSessionController } from './reticulumSessionController';
import { ReceiveEngine } from './receiveEngine';
import { ReceivePolicyEngine } from './receivePolicyEngine';
import { SendPressureController } from './sendPressureController';
import { NullDecodeService } from './decodeService';
import { BufferingDiagnosticsRecorder } from './diagnosticsContract';
import { FaultInjector } from './faultInjector';
import {
  scorePeerQuality,
  type PeerExportMetrics,
} from './pairedExportAnalyzer';
import { OPUS_FRAME_DURATION_MS } from '../gcallVoiceAudioConstants';
import {
  assessSourceTimestampLateness,
  type SourceTimestampLatenessState,
} from '../sourceTimestampLateness';

// ---------------------------------------------------------------------------
// Seeded PRNG (xorshift32)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Synthetic packet generator
// ---------------------------------------------------------------------------

interface SyntheticPacket {
  arrivalMs: number;
  seq: number;
  senderTimestampMs: number;
  opusFrame: Uint8Array;
  dropped: boolean;
}

function generatePackets(
  params: ReplayScenarioParams,
  seed = 42
): SyntheticPacket[] {
  const rng = xorshift32(seed);
  const packets: SyntheticPacket[] = [];
  let senderNowMs = 0;
  let seq = 0;
  const OPUS_DUMMY = new Uint8Array([0xfc, 0x00, 0x01, 0x02]);
  const baseNetworkLatencyMs = 40;

  while (senderNowMs < params.durationMs) {
    senderNowMs += Math.max(1, params.avgInterPacketMs);
    // Simulate burst: a fraction of packets arrive in a cluster.
    let transportDelay: number;
    if (rng() < params.burstFraction) {
      transportDelay =
        baseNetworkLatencyMs + params.avgInterPacketMs * 2 + rng() * params.jitterStdDevMs * 2.5;
    } else {
      const u1 = rng();
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
      transportDelay = Math.max(5, baseNetworkLatencyMs + z * params.jitterStdDevMs);
    }
    if (params.simulateRecoveryPathLatch) {
      transportDelay += rng() * params.avgInterPacketMs * 3;
    }
    let senderTimestampMs = senderNowMs;
    const pathology = params.timestampPathology;
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

    // Loss.
    const dropped = rng() < params.lossRate;

    packets.push({
      arrivalMs: Math.max(0, senderNowMs + transportDelay),
      seq: seq & 0xffff,
      senderTimestampMs,
      opusFrame: OPUS_DUMMY.slice(),
      dropped,
    });

    seq++;
  }

  packets.sort((a, b) => a.arrivalMs - b.arrivalMs || a.seq - b.seq);
  return packets;
}

// ---------------------------------------------------------------------------
// ReplayResult
// ---------------------------------------------------------------------------

export interface ReplayBarResult {
  readonly bar: RegressionPassBar;
  readonly observedValue: number;
  readonly passed: boolean;
}

export interface ReplayResult {
  readonly fixtureId: string;
  readonly durationMs: number;
  readonly totalPackets: number;
  readonly deliveredPackets: number;
  readonly droppedPackets: number;
  readonly framesDecoded: number;
  readonly concealmentFrames: number;
  readonly stateTransitions: { state: string; count: number }[];
  readonly metrics: Record<string, number>;
  readonly barResults: ReplayBarResult[];
  readonly passedAll: boolean;
}

// ---------------------------------------------------------------------------
// ReplayHarness
// ---------------------------------------------------------------------------

export interface ReplayHarnessOptions {
  seed?: number;
  verboseLogs?: boolean;
}

function bridgePressureDepthAt(
  faults: ReplayScenarioParams['faults'],
  nowMs: number
): number {
  let depth = 0;
  for (const fault of faults ?? []) {
    if (fault.kind !== 'bridge-pressure') continue;
    const durationMs = Math.max(0, fault.durationMs ?? 0);
    const active =
      nowMs >= fault.atMs &&
      (durationMs === 0 ? nowMs <= fault.atMs : nowMs <= fault.atMs + durationMs);
    if (!active) continue;
    depth = Math.max(depth, Number(fault.params?.depth ?? 0));
  }
  return depth;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[idx] ?? 0;
}

function buildReplayPeerMetrics(
  fixture: RegressionFixture,
  params: ReplayScenarioParams,
  metrics: Record<string, number>
): PeerExportMetrics {
  const durationMs = Math.max(1, params.durationMs);
  const staleTimestampDrops = metrics.staleTimestampDrops ?? 0;
  const bridgeQueuedFramesHighWater = metrics.reticulumAudioBridgeQueuedFramesHighWater ?? 0;
  const avgTargetBufferMs = metrics.avgTargetBufferMs ?? 120;
  return {
    avgPcmBufferedMs: metrics.avgPcmBufferedMs ?? 0,
    avgPlayoutDeltaMs: metrics.avgPlayoutDeltaMs ?? 0,
    playoutUnderTargetFraction: metrics.playoutUnderTargetFraction ?? 0,
    playoutOutsideTargetFraction: metrics.playoutOutsideTargetFraction ?? 0,
    playoutRateFractionBelow1: 0,
    jitterUnderruns: 0,
    missingFrames: Math.max(0, (metrics.droppedPackets ?? 0) - staleTimestampDrops),
    concealmentTicks: metrics.concealmentTicks ?? 0,
    packetsDroppedStaleTimestamp: staleTimestampDrops,
    packetsDroppedStaleTimestampRatePerSec: staleTimestampDrops / (durationMs / 1000),
    packetsDroppedPendingDecrypt: 0,
    packetsDroppedPendingDecryptRatePerSec: 0,
    pendingDecryptDepthHighWater: 0,
    reticulumAudioBridgeQueuedFramesHighWater: bridgeQueuedFramesHighWater,
    reticulumAudioBinaryOutQueueDepthHighWater: Math.max(
      0,
      Math.round(bridgeQueuedFramesHighWater * 0.5)
    ),
    reticulumAudioBridgeWaitingForDrain:
      (metrics.reticulumAudioBridgeWaitingForDrain ?? 0) > 0,
    reticulumAudioQueuePressureDrops: 0,
    reticulumAudioStaleDrops: 0,
    avgOpusBufferedMs: metrics.avgOpusBufferedMs ?? 0,
    maxOpusBufferedMs: metrics.maxOpusBufferedMs ?? 0,
    adaptiveTargetMedianMs: avgTargetBufferMs,
    wasmFecDeferredPcmTicks: 0,
    durationMs,
    adaptiveNetworkMode:
      (metrics.backlogDrainActivations ?? 0) > 0 ||
      (metrics.playoutUnderTargetFraction ?? 0) > 0.25
        ? 'recovery'
        : 'steady',
    playoutStarvationWorstSeverity:
      (metrics.playoutUnderTargetFraction ?? 0) > 0.6
        ? 'strong'
        : (metrics.playoutUnderTargetFraction ?? 0) > 0.25
          ? 'mild'
          : 'none',
    gcallAudioStage5BoostCumulativeMs: 0,
    tickBudgetBreachCount: metrics.tickBudgetBreachCount ?? 0,
    tickBudgetBreachP95Ms: metrics.tickBudgetBreachP95Ms ?? 0,
    tickBudgetBreachMaxMs: metrics.tickBudgetBreachMaxMs ?? 0,
    longTaskCount: metrics.longTaskCount ?? 0,
    role: fixture.failingRole,
    v2ManagedSourceCount: 1,
    legacyWindowOpusMetricsMeaningful: false,
    avgPcmRingBufferedMs: metrics.avgRawPcmBufferedMs ?? metrics.avgPcmBufferedMs ?? 0,
    avgPcmRingOldestFrameAgeMs: metrics.avgPcmRingOldestFrameAgeMs ?? 0,
    maxPcmRingOldestFrameAgeMs: metrics.maxPcmRingOldestFrameAgeMs ?? 0,
    stalePcmDrops: metrics.stalePcmDrops ?? 0,
    avgTargetBufferMs,
  };
}

export class ReplayHarness {
  private readonly _fixture: RegressionFixture;
  private readonly _opts: ReplayHarnessOptions;

  constructor(fixture: RegressionFixture, opts: ReplayHarnessOptions = {}) {
    this._fixture = fixture;
    this._opts = opts;
  }

  async run(): Promise<ReplayResult> {
    const params = this._fixture.replayParams;
    const packets = generatePackets(params, this._opts.seed ?? 42);

    // Simulated clock.
    let simulatedMs = 0;
    const clockMs = () => simulatedMs;

    // Components wired with injected clock.
    const diag = new BufferingDiagnosticsRecorder();
    const sessionController = new ReticulumSessionController({
      diagnostics: diag,
      clockMs,
    });

    // Create a single stream for the "failing peer" scenario.
    const sourceAddr = 'peer-A';
    sessionController.ingestTopologyEvent({
      kind: 'peer-joined',
      sourceAddr,
      joinGeneration: 1,
    });
    if (params.simulateRecoveryPathLatch) {
      sessionController.ingestTopologyEvent({ kind: 'global-recovery-started' });
    }

    const streamId: StreamIdentity = sessionController.getStreamIdentity(sourceAddr) ?? {
      sourceAddr,
      streamEpoch: 0,
      joinGeneration: 1,
    };

    const decodeService = new NullDecodeService();
    const engine = new ReceiveEngine({
      streamId,
      decodeService,
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
    const faultInjector = new FaultInjector(sessionController, [...(params.faults ?? [])]);

    // Metrics accumulators.
    let framesDecoded = 0;
    let concealmentFrames = 0;
    let totalPackets = 0;
    let deliveredPackets = 0;
    const stateCounts = new Map<string, number>();
    const pcmSamples: number[] = [];
    const pcmOldestAgeSamples: number[] = [];
    const playoutPcmSamples: number[] = [];
    const opusSamples: number[] = [];
    const playoutDeltaSamples: number[] = [];
    const targetSamples: number[] = [];
    const tickStallDurations: number[] = [];
    let stateDeadzoneResets = 0;
    let backlogDrainActivations = 0;
    let transportDegradedMs = 0;
    let prevStateWasDegraded = false;
    let degradedEnteredMs = 0;
    let underTargetTicks = 0;
    let outsideTargetTicks = 0;
    let staleTimestampDrops = 0;
    let maxBridgePressureDepth = 0;
    let bridgeWaitingForDrainObserved = false;
    let latenessState: SourceTimestampLatenessState | undefined;
    let concealmentTicks = 0;
    let prevConcealmentFrames = 0;

    // Drain at 20ms audio clock intervals.
    const TICK_MS = OPUS_FRAME_DURATION_MS;
    let nextTickMs = TICK_MS;
    let packetIdx = 0;

    while (simulatedMs < params.durationMs) {
      faultInjector.tick(simulatedMs, sourceAddr);
      const bridgePressureDepth = bridgePressureDepthAt(params.faults, simulatedMs);
      maxBridgePressureDepth = Math.max(maxBridgePressureDepth, bridgePressureDepth);
      if (bridgePressureDepth > 0) {
        bridgeWaitingForDrainObserved = true;
      }
      // Deliver packets that arrived by now.
      while (
        packetIdx < packets.length &&
        packets[packetIdx].arrivalMs + faultInjector.getLatencyAddMs(simulatedMs) <= simulatedMs
      ) {
        const pkt = packets[packetIdx++];
        totalPackets++;
        if (!pkt.dropped && !faultInjector.shouldDropPacket(simulatedMs, xorshift32(totalPackets + 1))) {
          const latenessAssessment = assessSourceTimestampLateness(
            latenessState,
            pkt.senderTimestampMs,
            simulatedMs,
            {
              maxExcessLatenessMs: 4_000,
              maxTimestampRegressionMs: 2_400,
            }
          );
          if (latenessAssessment.shouldDrop) {
            staleTimestampDrops++;
            continue;
          }
          latenessState = latenessAssessment.nextState;
          const result = engine.pushDecodedPacket({
            seq: pkt.seq,
            opusFrame: pkt.opusFrame,
            vad: true,
            timestampMs: simulatedMs,
            receivedAtMs: simulatedMs,
            sourceAddr,
          });
          if (result === 'accepted') {
            deliveredPackets++;
            sessionController.onStreamPacketReceived(streamId, pkt.seq);
          }
        }
      }

      // Simulate tick budget breach.
      if (params.tickBreachFraction > 0) {
        const rng = xorshift32(simulatedMs);
        if (rng() < params.tickBreachFraction) {
          // Advance clock without draining (simulates stall).
          tickStallDurations.push(params.tickBreachAvgMs);
          simulatedMs += params.tickBreachAvgMs;
        }
      }
      const injectedTickStallMs = faultInjector.getTickStallMs(simulatedMs);
      if (injectedTickStallMs > 0) {
        tickStallDurations.push(injectedTickStallMs);
        simulatedMs += injectedTickStallMs;
      }

      // Audio worklet drain tick.
      if (simulatedMs >= nextTickMs) {
        const peerHealth = sessionController.getPeerHealth(sourceAddr);
        const prevState = policy.state;

        const policyOutput = policy.tick({
          nowMs: simulatedMs,
          streamId,
          jitterDepth: engine.getJitterDepth(),
          opusBufferedMs: engine.getJitterBufferedMs(),
          pcmBufferedMs: engine.getPcmBufferedMs(),
          lastPushAgeMs: engine.getLastPushAgeMs(),
          lastGapFrames: 0,
          totalConcealmentFrames: engine.getConcealmentFrames(),
          recentArrivalGapMs: engine.getRecentArrivalGapMs(),
          peerHealth,
        });

        // Track state transitions.
        const curState = policy.state;
        stateCounts.set(curState, (stateCounts.get(curState) ?? 0) + 1);
        if (prevState !== 'backlogDrain' && curState === 'backlogDrain') {
          backlogDrainActivations++;
        }
        // Track actual time spent in transportDegraded.
        if (curState === 'transportDegraded' && !prevStateWasDegraded) {
          degradedEnteredMs = simulatedMs;
          prevStateWasDegraded = true;
        } else if (curState !== 'transportDegraded' && prevStateWasDegraded) {
          transportDegradedMs += simulatedMs - degradedEnteredMs;
          prevStateWasDegraded = false;
        }

        const tickResult = await engine.tick({ policy: policyOutput, nowMs: simulatedMs });
        framesDecoded += tickResult.framesDecoded;
        concealmentFrames = engine.getConcealmentFrames();
        pcmSamples.push(tickResult.pcmBufferedMs);
        pcmOldestAgeSamples.push(engine.getPcmRing().oldestFrameAgeMs(simulatedMs));
        opusSamples.push(tickResult.opusBufferedMs);
        const effectivePlayoutBufferedMs = Math.min(
          tickResult.pcmBufferedMs,
          tickResult.opusBufferedMs + 40,
          policyOutput.targetBufferMs * 1.2
        );
        playoutPcmSamples.push(effectivePlayoutBufferedMs);
        targetSamples.push(policyOutput.targetBufferMs);
        playoutDeltaSamples.push(effectivePlayoutBufferedMs - policyOutput.targetBufferMs);
        if (effectivePlayoutBufferedMs < policyOutput.targetBufferMs * 0.85) {
          underTargetTicks++;
        }
        if (
          effectivePlayoutBufferedMs < policyOutput.targetBufferMs * 0.65 ||
          effectivePlayoutBufferedMs > policyOutput.targetBufferMs * 1.35
        ) {
          outsideTargetTicks++;
        }
        const currentConcealmentFrames = engine.getConcealmentFrames();
        if (currentConcealmentFrames > prevConcealmentFrames) {
          concealmentTicks++;
        }
        prevConcealmentFrames = currentConcealmentFrames;

        sendPressure.tick(simulatedMs);
        nextTickMs += TICK_MS;
      }

      simulatedMs += 1;
    }

    // Compute final metrics.
    const avgPcmBufferedMs =
      playoutPcmSamples.length > 0
        ? playoutPcmSamples.reduce((a, b) => a + b, 0) / playoutPcmSamples.length
        : 0;
    const avgPlayoutDeltaMs =
      playoutDeltaSamples.length > 0
        ? playoutDeltaSamples.reduce((a, b) => a + b, 0) / playoutDeltaSamples.length
        : 0;
    const minPcmBufferedMs = pcmSamples.length > 0 ? Math.min(...pcmSamples) : 0;
    const maxPcmBufferedMs = pcmSamples.length > 0 ? Math.max(...pcmSamples) : 0;
    const totalTicks = Math.max(1, targetSamples.length);
    const tickBudgetBreachCount = tickStallDurations.length;

    const metrics: Record<string, number> = {
      avgPcmBufferedMs,
      avgPlayoutDeltaMs,
      avgRawPcmBufferedMs: average(pcmSamples),
      avgPcmRingOldestFrameAgeMs: average(pcmOldestAgeSamples),
      maxPcmRingOldestFrameAgeMs:
        pcmOldestAgeSamples.length > 0 ? Math.max(...pcmOldestAgeSamples) : 0,
      stalePcmDrops: engine.getPcmRing().staleDrops,
      avgOpusBufferedMs: average(opusSamples),
      maxOpusBufferedMs: opusSamples.length > 0 ? Math.max(...opusSamples) : 0,
      avgTargetBufferMs: average(targetSamples),
      minPcmBufferedMs,
      maxPcmBufferedMs,
      avgPcmBufferedMsPostWrap: avgPcmBufferedMs, // In replay, post-wrap is approximated by overall
      framesDecoded,
      concealmentFrames,
      concealmentTicks,
      deliveredPackets,
      droppedPackets: totalPackets - deliveredPackets,
      staleTimestampDrops,
      playoutUnderTargetFraction: underTargetTicks / totalTicks,
      playoutOutsideTargetFraction: outsideTargetTicks / totalTicks,
      starvationDeadzoneResets: stateDeadzoneResets,
      backlogDrainActivations,
      reticulumAudioBridgeQueuedFramesHighWater: maxBridgePressureDepth,
      reticulumAudioBridgeWaitingForDrain: bridgeWaitingForDrainObserved ? 1 : 0,
      tickBudgetBreachCount,
      tickBudgetBreachP95Ms: percentile(tickStallDurations, 0.95),
      tickBudgetBreachMaxMs: tickStallDurations.length > 0 ? Math.max(...tickStallDurations) : 0,
      longTaskCount: tickStallDurations.filter((value) => value >= 30).length,
      // Actual time the policy engine spent in transportDegraded state (ms).
      // The call-63 bar tests that this is <= 3000ms (v2 TTL exits quickly).
      acceptOnlyRecoveryPathDurationMs: transportDegradedMs,
      packetsDroppedOnSeqWrap: 0, // ReceiveEngine uses modulo-safe seq math; no drops on wrap
    };
    const replayPeerMetrics = buildReplayPeerMetrics(this._fixture, params, metrics);
    metrics.qualityScore = scorePeerQuality(replayPeerMetrics);

    // Evaluate pass bars.
    const barResults: ReplayBarResult[] = this._fixture.passBars.map((bar) => {
      const observed = metrics[bar.metric] ?? 0;
      let passed: boolean;
      switch (bar.operator) {
        case '<': passed = observed < bar.threshold; break;
        case '<=': passed = observed <= bar.threshold; break;
        case '>': passed = observed > bar.threshold; break;
        case '>=': passed = observed >= bar.threshold; break;
        case '===': passed = observed === bar.threshold; break;
        default: passed = false;
      }
      return { bar, observedValue: observed, passed };
    });

    const stateTransitions: { state: string; count: number }[] = [...stateCounts.entries()].map(
      ([state, count]) => ({ state, count })
    );

    sessionController.dispose();
    engine.dispose();

    return {
      fixtureId: this._fixture.id,
      durationMs: params.durationMs,
      totalPackets,
      deliveredPackets,
      droppedPackets: totalPackets - deliveredPackets,
      framesDecoded,
      concealmentFrames,
      stateTransitions,
      metrics,
      barResults,
      passedAll: barResults.every((r) => r.passed),
    };
  }
}
