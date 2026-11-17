/**
 * Group Call V2 — Regression Fixtures
 *
 * Canonical bad-call shapes captured from production exports. These fixtures
 * drive the deterministic replay harness and serve as release gates: any
 * architectural change that regresses a fixture is a blocker.
 *
 * Each fixture describes:
 *  - The observable failure signature (what metrics looked bad)
 *  - The root cause category (transport/policy/decrypt/stall)
 *  - The pass bar for the new architecture (what "fixed" means)
 *  - Enough timeline data to synthesize a replay scenario
 *
 * Adding a new fixture: run the call, export paired diagnostics, run
 * pairedExportAnalyzer to classify, then capture the summary here.
 */

import type { ReceiveState } from './spec';
import type { FaultSpec } from './faultInjector';
import {
  PHIL_KENNY_ONE_ON_ONE_76_PAIR,
  PHIL_KENNY_ONE_ON_ONE_77_PAIR,
} from './liveExportRegressionFixtures';
import { reducePairedLiveExportToReplayScript } from './eventReplayReducer';

// ---------------------------------------------------------------------------
// Fixture schema
// ---------------------------------------------------------------------------

export type FailureClass =
  | 'policy-dominated'    // bad jitter metrics with calm transport / decrypt
  | 'transport-dominated' // transport triad hot
  | 'decrypt-dominated'   // pending-decrypt drops with calm triad
  | 'stall-dominated'     // main-thread long tasks / tick budget breaches
  | 'mixed';              // multiple contributing factors

export interface RegressionFixture {
  /** Unique ID used in test names and replay CLI. */
  readonly id: string;
  /** Human-readable description of the call failure. */
  readonly description: string;
  /** Primary failure class. */
  readonly primaryClass: FailureClass;
  /** Secondary failure class if mixed. */
  readonly secondaryClass?: FailureClass;
  /**
   * The peer-side that was failing (e.g. "root-forwarder" or "standby-forwarder").
   * In paired exports, both sides are captured; this names the worse one.
   */
  readonly failingRole: string;
  /** Key metrics from the failing peer's export window. */
  readonly failingPeerMetrics: {
    avgPcmBufferedMs: number;
    avgPlayoutDeltaMs: number;
    playoutUnderTargetFraction: number;
    playoutOutsideTargetFraction: number;
    adaptiveNetworkMode: string;
    playoutStarvationWorstSeverity: string;
    tickBudgetBreachCount: number;
    jitterUnderruns: number;
    adaptiveTargetMedianMs: number;
    opusBufferedMs: number;
  };
  /** Specific state transitions or events that characterize the trap. */
  readonly trapSignature: string[];
  /** What the new architecture must demonstrate to "pass" this fixture. */
  readonly passBars: RegressionPassBar[];
  /**
   * Replay parameters: how to synthesize this call shape in the
   * deterministic replay harness without needing live Reticulum.
   */
  readonly replayParams: ReplayScenarioParams;
}

export interface RegressionPassBar {
  readonly metric: string;
  readonly operator: '<' | '<=' | '>' | '>=' | '===';
  readonly threshold: number;
  readonly description: string;
}

export interface ReplayScenarioParams {
  /** How many simulated peers. */
  peerCount: number;
  /** Duration of the scenario in ms. */
  durationMs: number;
  /** Packet arrival pattern. */
  packetPattern:
    | 'steady'           // constant 50pps
    | 'bursty'           // periodic bursts matching the call shape
    | 'recovery-channel' // extra latency / jitter matching acceptOnlyRecoveryPath
    | 'mixed';
  /** Average inter-packet delay in ms. */
  avgInterPacketMs: number;
  /** Jitter on inter-packet delay (ms std dev). */
  jitterStdDevMs: number;
  /** Fraction of packets that arrive late by a multiple of the nominal interval. */
  burstFraction: number;
  /** Loss rate [0–1]. */
  lossRate: number;
  /** Whether to simulate the sticky acceptOnlyRecoveryPath latch. */
  simulateRecoveryPathLatch: boolean;
  /** Tick budget breach fraction (fraction of ticks that breach the budget). */
  tickBreachFraction: number;
  /** Tick breach average ms (when a breach occurs). */
  tickBreachAvgMs: number;
  /** Optional transport/control-plane faults to inject during replay. */
  faults?: readonly FaultSpec[];
  /** Optional sender timestamp pathology to reproduce stale timestamp drops. */
  timestampPathology?: {
    readonly startAtMs: number;
    readonly lagMs: number;
    readonly regressionMs?: number;
    readonly regressionEveryPackets?: number;
  };
}

const PHIL_KENNY_REPLAY_SCRIPT = reducePairedLiveExportToReplayScript(
  PHIL_KENNY_ONE_ON_ONE_76_PAIR
);
const PHIL_KENNY_77_REPLAY_SCRIPT = reducePairedLiveExportToReplayScript(
  PHIL_KENNY_ONE_ON_ONE_77_PAIR
);

// ---------------------------------------------------------------------------
// Fixture: call-63 one-remote playout trap
// ---------------------------------------------------------------------------

/**
 * The canonical "call-63" failure: Phil (root-forwarder) experiences permanent
 * strong playout starvation from the moment Kenny (standby-forwarder) joins,
 * for the entire 58-second export window. avgPcmBufferedMs = 7.8 ms against a
 * 185 ms target. Kenny was fine (avgPcmBufferedMs = 95 ms).
 *
 * Root causes:
 *  1. `acceptOnlyRecoveryPath: true` sticky latch — all packets forced through
 *     the recovery DataChannel (3 retransmits), raising jitter variance by 5
 *     orders of magnitude (currentVar = 3965 vs baseline = 0.007).
 *  2. `n1SevereRebuildDeadzoneReset` cycle — severeForcedReleaseRebuildActive
 *     runs for 6+ s at a time, PCM never reaches minEscapeFrames = 10. Fires 3×
 *     during the 58s window. The rebuild clamp (5 frames/tick) actively prevents
 *     PCM fill when jitter buffer has a full target's worth of Opus waiting.
 *  3. Tick budget breaches on Phil's machine (28 breaches, P95 = 23 ms,
 *     max = 35 ms on a 6 ms budget) stall jitter buffer processing.
 *  4. `adaptiveNetworkMode` stuck in "recovery" (12 s cooldown) even while
 *     packets are actively arriving.
 */
export const FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP: RegressionFixture = {
  id: 'call-63-one-remote-playout-trap',
  description:
    'Phil (root-forwarder) stuck in strong playout starvation for entire call. ' +
    'avgPcmBufferedMs=7.8ms vs 185ms target. Kenny (standby-forwarder) healthy. ' +
    'acceptOnlyRecoveryPath latch + n1SevereRebuildDeadzoneReset cycle.',
  primaryClass: 'policy-dominated',
  secondaryClass: 'transport-dominated',
  failingRole: 'root-forwarder',
  failingPeerMetrics: {
    avgPcmBufferedMs: 7.784,
    avgPlayoutDeltaMs: -176.503,
    playoutUnderTargetFraction: 0.974,
    playoutOutsideTargetFraction: 0.985,
    adaptiveNetworkMode: 'recovery',
    playoutStarvationWorstSeverity: 'strong',
    tickBudgetBreachCount: 28,
    jitterUnderruns: 1491,
    adaptiveTargetMedianMs: 185,
    opusBufferedMs: 109.928,
  },
  trapSignature: [
    'acceptOnlyRecoveryPath=true for entire session',
    'n1SevereRebuildDeadzoneReset fires 3+ times',
    'severeForcedReleaseRebuildActive continuously from t+5s',
    'microWidenV1: currentVar=3965 vs baseline=0.007',
    'panicZoneActivated within 2.5s of peer join',
    'gcallAudioStage5BoostCumulativeMs=12142ms',
  ],
  passBars: [
    {
      metric: 'avgPcmBufferedMs',
      operator: '>=',
      threshold: 60,
      description: 'PCM buffer must stay above 60ms (at least 0.32× of a 185ms target)',
    },
    {
      metric: 'playoutUnderTargetFraction',
      operator: '<=',
      threshold: 0.35,
      description: 'Must spend ≤35% of time below target (provisional pass bar)',
    },
    {
      metric: 'avgPlayoutDeltaMs',
      operator: '>=',
      threshold: -80,
      description: 'Average playout delta must not exceed -80ms',
    },
    {
      metric: 'starvationDeadzoneResets',
      operator: '===',
      threshold: 0,
      description: 'The rebuild-deadzone-reset cycle must not occur at all',
    },
    {
      metric: 'acceptOnlyRecoveryPathDurationMs',
      operator: '<=',
      threshold: 3000,
      description: 'Recovery path latch must expire within 3s when fresh media is arriving',
    },
  ],
  replayParams: {
    peerCount: 2,
    durationMs: 60_000,
    packetPattern: 'recovery-channel',
    avgInterPacketMs: 20,
    jitterStdDevMs: 45,
    burstFraction: 0.35,
    lossRate: 0.006,
    simulateRecoveryPathLatch: true,
    tickBreachFraction: 0.014,
    tickBreachAvgMs: 18,
  },
};

// ---------------------------------------------------------------------------
// Fixture: call-60 severe rebuild oscillation
// ---------------------------------------------------------------------------

/**
 * The call-60 failure: Kenny's inbound path flapped between Reticulum packet/link
 * transports 4× in the first 75s. Packets arrived in bursts, jitter buffer peaked
 * at 400ms (≥24 frames — the singleRemoteDepthMs trim ceiling) yet avgPcmBufferedMs
 * never climbed out of the 8–85ms band. n1SevereRebuildReadyEscape fired 19×,
 * n1SevereRebuildDeadzoneReset 7×.
 *
 * Root cause: The 5-frame/tick rebuild clamp couldn't match worklet drain + 0.947×
 * playout stretch. The opus-overflow exit was not present, so the system could not
 * break the feedback loop when Opus > target's worth was queued.
 * (The GCALL_N1_SEVERE_RELEASE_OPUS_OVERFLOW_EXIT_RATIO fix addresses this in v1,
 * but the v2 architecture eliminates the pattern entirely via the backlogDrain FSM state.)
 */
export const FIXTURE_CALL60_REBUILD_OSCILLATION: RegressionFixture = {
  id: 'call-60-rebuild-oscillation',
  description:
    'Kenny jitter buffer peaked at 400ms but PCM stuck at 8-85ms. ' +
    'n1SevereRebuildReadyEscape fired 19×, deadzoneReset 7×. ' +
    'Transport flap between packet/link caused bursty arrival pattern.',
  primaryClass: 'policy-dominated',
  failingRole: 'standby-forwarder',
  failingPeerMetrics: {
    avgPcmBufferedMs: 38.0,
    avgPlayoutDeltaMs: -110.0,
    playoutUnderTargetFraction: 0.92,
    playoutOutsideTargetFraction: 0.95,
    adaptiveNetworkMode: 'recovery',
    playoutStarvationWorstSeverity: 'strong',
    tickBudgetBreachCount: 4,
    jitterUnderruns: 800,
    adaptiveTargetMedianMs: 145,
    opusBufferedMs: 320,
  },
  trapSignature: [
    'singleRemoteDepthFrames trimmed at 24 frames (400ms) multiple times',
    'n1SevereRebuildReadyEscape fires 19×',
    'n1SevereRebuildDeadzoneReset fires 7×',
    'transport link/packet flap 4× in 75s',
    'avgPcmBufferedMs oscillates 8–85ms, never recovers to target',
  ],
  passBars: [
    {
      metric: 'avgPcmBufferedMs',
      operator: '>=',
      threshold: 55,
      description: 'PCM buffer must stay above 55ms',
    },
    {
      metric: 'starvationDeadzoneResets',
      operator: '===',
      threshold: 0,
      description: 'No deadzone resets in the backlogDrain FSM state',
    },
    {
      metric: 'backlogDrainActivations',
      operator: '>=',
      threshold: 1,
      description: 'backlogDrain state must activate and clear the backlog',
    },
  ],
  replayParams: {
    peerCount: 2,
    durationMs: 90_000,
    packetPattern: 'bursty',
    avgInterPacketMs: 20,
    jitterStdDevMs: 60,
    burstFraction: 0.40,
    lossRate: 0.01,
    simulateRecoveryPathLatch: false,
    tickBreachFraction: 0.004,
    tickBreachAvgMs: 14,
  },
};

// ---------------------------------------------------------------------------
// Fixture: seq-wrap muting
// ---------------------------------------------------------------------------

/**
 * When seq wraps from 65535 → 0, the legacy watermark comparison
 * (`seq <= lastPlayedSeq`) evaluates true for all small seq numbers,
 * causing every packet after the wrap to be silently dropped as "stale".
 * The call goes mute at exactly 65535 * 20ms ≈ 21.8 minutes.
 */
export const FIXTURE_SEQ_WRAP_MUTING: RegressionFixture = {
  id: 'seq-wrap-muting',
  description:
    'Call goes mute at 65535*20ms≈21.8min due to unsigned seq wrap. ' +
    'lastPlayedSeq stays at 65535; all subsequent packets dropped as stale.',
  primaryClass: 'policy-dominated',
  failingRole: 'any',
  failingPeerMetrics: {
    avgPcmBufferedMs: 0,
    avgPlayoutDeltaMs: -999,
    playoutUnderTargetFraction: 1.0,
    playoutOutsideTargetFraction: 1.0,
    adaptiveNetworkMode: 'recovery',
    playoutStarvationWorstSeverity: 'strong',
    tickBudgetBreachCount: 0,
    jitterUnderruns: 9999,
    adaptiveTargetMedianMs: 185,
    opusBufferedMs: 0,
  },
  trapSignature: [
    'all packets dropped as stale after seq=65535',
    'jitter buffer empty for entire post-wrap window',
    'stream not reset on epoch change',
  ],
  passBars: [
    {
      metric: 'packetsDroppedOnSeqWrap',
      operator: '===',
      threshold: 0,
      description: 'No packets dropped due to seq wrap — modulo-safe math required',
    },
    {
      metric: 'avgPcmBufferedMsPostWrap',
      operator: '>=',
      threshold: 60,
      description: 'Buffer must remain healthy after seq wrap',
    },
  ],
  replayParams: {
    peerCount: 2,
    durationMs: 22 * 60 * 1000,
    packetPattern: 'steady',
    avgInterPacketMs: 20,
    jitterStdDevMs: 5,
    burstFraction: 0.0,
    lossRate: 0.0,
    simulateRecoveryPathLatch: false,
    tickBreachFraction: 0,
    tickBreachAvgMs: 0,
  },
};

// ---------------------------------------------------------------------------
// Fixture: phil-kenny mixed offline replay
// ---------------------------------------------------------------------------

/**
 * Reduced offline replay of the real phil-kenny paired capture:
 *  - Phil side showed mixed stall + transport pressure
 *  - Kenny side showed prolonged stale-timestamp dropping with recovery-mode playout
 *
 * This fixture intentionally combines those impairments into one deterministic
 * stream so the replay harness can reproduce the same family of failures
 * offline without a fresh live call.
 */
export const FIXTURE_PHIL_KENNY_MIXED_OFFLINE_REPLAY: RegressionFixture = {
  id: 'phil-kenny-mixed-offline-replay',
  description:
    'Reduced replay of the phil-kenny capture: mixed bridge pressure and tick stalls plus stale sender timestamps.',
  primaryClass: 'mixed',
  secondaryClass: 'transport-dominated',
  failingRole: 'root-forwarder',
  failingPeerMetrics: {
    avgPcmBufferedMs: 90.851,
    avgPlayoutDeltaMs: -29.149,
    playoutUnderTargetFraction: 0.481,
    playoutOutsideTargetFraction: 0.689,
    adaptiveNetworkMode: 'recovery',
    playoutStarvationWorstSeverity: 'none',
    tickBudgetBreachCount: 23,
    jitterUnderruns: 0,
    adaptiveTargetMedianMs: 120,
    opusBufferedMs: 74.716,
  },
  trapSignature: [
    `derived primary role=${PHIL_KENNY_REPLAY_SCRIPT.derivedSignals.primaryRole}`,
    `derived stale role=${PHIL_KENNY_REPLAY_SCRIPT.derivedSignals.staleRole}`,
    `derived backlogDrain activations=${PHIL_KENNY_REPLAY_SCRIPT.derivedSignals.primaryBacklogDrainActivations}`,
    `derived stale timestamp drops=${PHIL_KENNY_REPLAY_SCRIPT.derivedSignals.staleTimestampDrops}`,
  ],
  passBars: [
    {
      metric: 'qualityScore',
      operator: '>=',
      threshold: 8,
      description: 'The phil-kenny replay family should score as a good call after runtime fixes.',
    },
    {
      metric: 'maxPcmRingOldestFrameAgeMs',
      operator: '<=',
      threshold: 260,
      description: 'Decoded PCM age must stay bounded instead of growing into conversationally-late audio.',
    },
  ],
  replayParams: {
    peerCount: 2,
    durationMs: PHIL_KENNY_REPLAY_SCRIPT.durationMs,
    packetPattern: PHIL_KENNY_REPLAY_SCRIPT.packetPattern,
    avgInterPacketMs: PHIL_KENNY_REPLAY_SCRIPT.avgInterPacketMs,
    jitterStdDevMs: PHIL_KENNY_REPLAY_SCRIPT.jitterStdDevMs,
    burstFraction: PHIL_KENNY_REPLAY_SCRIPT.burstFraction,
    lossRate: PHIL_KENNY_REPLAY_SCRIPT.lossRate,
    simulateRecoveryPathLatch: PHIL_KENNY_REPLAY_SCRIPT.simulateRecoveryPathLatch,
    tickBreachFraction: PHIL_KENNY_REPLAY_SCRIPT.tickBreachFraction,
    tickBreachAvgMs: PHIL_KENNY_REPLAY_SCRIPT.tickBreachAvgMs,
    faults: PHIL_KENNY_REPLAY_SCRIPT.faults,
    timestampPathology: PHIL_KENNY_REPLAY_SCRIPT.timestampPathology,
  },
};

export const FIXTURE_PHIL_KENNY_77_OFFLINE_REPLAY: RegressionFixture = {
  id: 'phil-kenny-77-offline-replay',
  description:
    'Reduced replay of the improved phil-kenny call: residual root-forwarder stalls and playout instability plus milder standby stale timestamp dropping.',
  primaryClass: 'stall-dominated',
  secondaryClass: 'policy-dominated',
  failingRole: 'root-forwarder',
  failingPeerMetrics: {
    avgPcmBufferedMs: 132.748,
    avgPlayoutDeltaMs: 12.748,
    playoutUnderTargetFraction: 0.217,
    playoutOutsideTargetFraction: 0.597,
    adaptiveNetworkMode: 'recovery',
    playoutStarvationWorstSeverity: 'none',
    tickBudgetBreachCount: 17,
    jitterUnderruns: 0,
    adaptiveTargetMedianMs: 120,
    opusBufferedMs: 106.954,
  },
  trapSignature: [
    `derived primary role=${PHIL_KENNY_77_REPLAY_SCRIPT.derivedSignals.primaryRole}`,
    `derived stale role=${PHIL_KENNY_77_REPLAY_SCRIPT.derivedSignals.staleRole}`,
    `derived backlogDrain activations=${PHIL_KENNY_77_REPLAY_SCRIPT.derivedSignals.primaryBacklogDrainActivations}`,
    `derived stale timestamp drops=${PHIL_KENNY_77_REPLAY_SCRIPT.derivedSignals.staleTimestampDrops}`,
  ],
  passBars: [
    {
      metric: 'qualityScore',
      operator: '>=',
      threshold: 9,
      description: 'The improved phil-kenny replay family should score as a great call after follow-up fixes.',
    },
    {
      metric: 'maxPcmRingOldestFrameAgeMs',
      operator: '<=',
      threshold: 260,
      description: 'Decoded PCM age must stay bounded instead of growing into conversationally-late audio.',
    },
  ],
  replayParams: {
    peerCount: 2,
    durationMs: PHIL_KENNY_77_REPLAY_SCRIPT.durationMs,
    packetPattern: PHIL_KENNY_77_REPLAY_SCRIPT.packetPattern,
    avgInterPacketMs: PHIL_KENNY_77_REPLAY_SCRIPT.avgInterPacketMs,
    jitterStdDevMs: PHIL_KENNY_77_REPLAY_SCRIPT.jitterStdDevMs,
    burstFraction: PHIL_KENNY_77_REPLAY_SCRIPT.burstFraction,
    lossRate: PHIL_KENNY_77_REPLAY_SCRIPT.lossRate,
    simulateRecoveryPathLatch:
      PHIL_KENNY_77_REPLAY_SCRIPT.simulateRecoveryPathLatch,
    tickBreachFraction: PHIL_KENNY_77_REPLAY_SCRIPT.tickBreachFraction,
    tickBreachAvgMs: PHIL_KENNY_77_REPLAY_SCRIPT.tickBreachAvgMs,
    faults: PHIL_KENNY_77_REPLAY_SCRIPT.faults,
    timestampPathology: PHIL_KENNY_77_REPLAY_SCRIPT.timestampPathology,
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_REGRESSION_FIXTURES: readonly RegressionFixture[] = [
  FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP,
  FIXTURE_CALL60_REBUILD_OSCILLATION,
  FIXTURE_SEQ_WRAP_MUTING,
  FIXTURE_PHIL_KENNY_MIXED_OFFLINE_REPLAY,
  FIXTURE_PHIL_KENNY_77_OFFLINE_REPLAY,
];

/**
 * Look up a fixture by ID. Throws if not found (test harness usage).
 */
export function getFixture(id: string): RegressionFixture {
  const f = ALL_REGRESSION_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Regression fixture not found: "${id}"`);
  return f;
}

/**
 * Given a set of observed metrics from a call export, classify which fixtures
 * it most closely matches. Used by the pairedExportAnalyzer for triage.
 */
export function classifyCallAgainstFixtures(metrics: {
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  avgPlayoutDeltaMs: number;
  playoutStarvationWorstSeverity: string;
  n1SevereDeadzoneResets?: number;
  seqWrapDetected?: boolean;
}): RegressionFixture[] {
  const matches: RegressionFixture[] = [];

  if (
    metrics.seqWrapDetected === true
  ) {
    matches.push(FIXTURE_SEQ_WRAP_MUTING);
  }

  if (
    metrics.avgPcmBufferedMs < 20 &&
    metrics.playoutUnderTargetFraction > 0.9 &&
    metrics.playoutStarvationWorstSeverity === 'strong'
  ) {
    matches.push(FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP);
  }

  if (
    (metrics.n1SevereDeadzoneResets ?? 0) >= 3 &&
    metrics.avgPcmBufferedMs < 60 &&
    metrics.avgPlayoutDeltaMs < -80
  ) {
    matches.push(FIXTURE_CALL60_REBUILD_OSCILLATION);
  }

  return matches;
}
