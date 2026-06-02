import type { AnyGcallV2Event } from './diagnosticsContract';
import type { FaultSpec } from './faultInjector';
import type { LiveExportRegressionFixturePair } from './liveExportRegressionFixtures';

export interface ReducedReplayScript {
  readonly durationMs: number;
  readonly avgInterPacketMs: number;
  readonly packetPattern: 'steady' | 'bursty' | 'recovery-channel' | 'mixed';
  readonly jitterStdDevMs: number;
  readonly burstFraction: number;
  readonly lossRate: number;
  readonly simulateRecoveryPathLatch: boolean;
  readonly tickBreachFraction: number;
  readonly tickBreachAvgMs: number;
  readonly faults: readonly FaultSpec[];
  readonly timestampPathology?: {
    readonly startAtMs: number;
    readonly lagMs: number;
    readonly regressionMs?: number;
    readonly regressionEveryPackets?: number;
  };
  readonly derivedSignals: {
    readonly primaryRole: string;
    readonly staleRole: string;
    readonly primaryBacklogDrainActivations: number;
    readonly primaryPeakJitterBufferedMs: number;
    readonly primaryMinPcmBufferedMs: number;
    readonly primaryTransportEvidenceKinds: readonly string[];
    readonly staleTimestampDrops: number;
  };
}

interface ExportReplaySignals {
  readonly role: string;
  readonly durationMs: number;
  readonly tickBudgetBreachCount: number;
  readonly tickBudgetBreachP95Ms: number;
  readonly playoutUnderTargetFraction: number;
  readonly avgPcmBufferedMs: number;
  readonly bridgeQueuedFramesHighWater: number;
  readonly queuePressureDrops: number;
  readonly staleTimestampDrops: number;
  readonly transportEvidenceKinds: string[];
  readonly backlogDrainActivations: number;
  readonly peakJitterBufferedMs: number;
  readonly minPcmBufferedMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(obj: Record<string, unknown>, key: string): number {
  return typeof obj[key] === 'number' ? (obj[key] as number) : 0;
}

function getEvents(json: Record<string, unknown>): AnyGcallV2Event[] {
  const v2 = (json.v2Diagnostics ?? {}) as Record<string, unknown>;
  return Array.isArray(v2.events) ? (v2.events as AnyGcallV2Event[]) : [];
}

function extractSignals(json: Record<string, unknown>): ExportReplaySignals {
  const live = (json.liveMetricsSnapshot ?? {}) as Record<string, unknown>;
  const win = (json.exportWindowMetrics ?? {}) as Record<string, unknown>;
  const perf = ((json.gcallPerfSnapshot as Record<string, unknown> | undefined)?.meta ?? {}) as Record<string, unknown>;
  const events = getEvents(json);

  const transportEvidenceKinds = new Set<string>();
  let backlogDrainActivations = 0;
  let peakJitterBufferedMs = 0;
  let minPcmBufferedMs = Number.POSITIVE_INFINITY;

  for (const event of events) {
    if (event.kind === 'transport-evidence') {
      const payload = event.payload as Record<string, unknown>;
      const kind = typeof payload.kind === 'string' ? payload.kind : null;
      if (kind) transportEvidenceKinds.add(kind);
      continue;
    }
    if (event.kind === 'state-transition') {
      const payload = event.payload as Record<string, unknown>;
      if (payload.toState === 'backlogDrain') {
        backlogDrainActivations += 1;
      }
      continue;
    }
    if (event.kind === 'jitter-stats') {
      const payload = event.payload as Record<string, unknown>;
      peakJitterBufferedMs = Math.max(peakJitterBufferedMs, num(payload, 'bufferedMs'));
      continue;
    }
    if (event.kind === 'pcm-ring-stats') {
      const payload = event.payload as Record<string, unknown>;
      minPcmBufferedMs = Math.min(minPcmBufferedMs, num(payload, 'bufferedMs'));
    }
  }

  return {
    role: typeof live.role === 'string' ? (live.role as string) : 'unknown',
    durationMs: num(win, 'durationMs'),
    tickBudgetBreachCount: num(perf, 'tickBudgetBreachCount'),
    tickBudgetBreachP95Ms: num(perf, 'tickBudgetBreachP95Ms'),
    playoutUnderTargetFraction: num(live, 'playoutUnderTargetFraction'),
    avgPcmBufferedMs: num(live, 'avgPcmBufferedMs'),
    bridgeQueuedFramesHighWater: num(live, 'reticulumAudioBridgeQueuedFramesHighWater'),
    queuePressureDrops: num(live, 'reticulumAudioQueuePressureDrops'),
    staleTimestampDrops: num(live, 'packetsDroppedStaleTimestamp'),
    transportEvidenceKinds: [...transportEvidenceKinds],
    backlogDrainActivations,
    peakJitterBufferedMs,
    minPcmBufferedMs: Number.isFinite(minPcmBufferedMs) ? minPcmBufferedMs : 0,
  };
}

export function reducePairedLiveExportToReplayScript(
  pair: LiveExportRegressionFixturePair
): ReducedReplayScript {
  const peerA = extractSignals(pair.peerAExport);
  const peerB = extractSignals(pair.peerBExport);
  const primary =
    peerA.tickBudgetBreachP95Ms + peerA.bridgeQueuedFramesHighWater + peerA.backlogDrainActivations * 20 >=
      peerB.tickBudgetBreachP95Ms + peerB.bridgeQueuedFramesHighWater + peerB.backlogDrainActivations * 20
      ? peerA
      : peerB;
  const stale = peerA.staleTimestampDrops >= peerB.staleTimestampDrops ? peerA : peerB;
  const durationMs = Math.max(peerA.durationMs, peerB.durationMs, 24_000);
  const tickCount = Math.max(1, durationMs / 20);
  const tickBreachFraction = clamp(primary.tickBudgetBreachCount / tickCount, 0, 0.25);
  const tickBreachAvgMs = clamp(primary.tickBudgetBreachP95Ms || 0, 0, 60);
  const packetPattern =
    primary.backlogDrainActivations > 0 && stale.staleTimestampDrops > 0
      ? 'mixed'
      : primary.backlogDrainActivations > 0
        ? 'bursty'
        : primary.transportEvidenceKinds.includes('path-warming')
          ? 'recovery-channel'
          : 'steady';
  const jitterStdDevMs = clamp(
    8 + primary.peakJitterBufferedMs / 8 + Math.max(peerA.playoutUnderTargetFraction, peerB.playoutUnderTargetFraction) * 12,
    8,
    80
  );
  const burstFraction = clamp(
    0.08 + primary.backlogDrainActivations * 0.08 + primary.transportEvidenceKinds.length * 0.04,
    0.08,
    0.7
  );
  const lossRate = clamp(
    0.005 + Math.max(primary.queuePressureDrops, 0) * 0.001,
    0.005,
    0.08
  );
  const simulateRecoveryPathLatch = primary.transportEvidenceKinds.includes('path-warming');
  const faults: FaultSpec[] = [];
  if (primary.bridgeQueuedFramesHighWater >= 16) {
    faults.push({
      kind: 'bridge-pressure',
      atMs: 2_000,
      durationMs: Math.min(12_000, Math.round(durationMs * 0.35)),
      params: { depth: primary.bridgeQueuedFramesHighWater },
    });
  }
  if (primary.transportEvidenceKinds.includes('path-warming') || primary.backlogDrainActivations > 0) {
    faults.push({
      kind: 'latency-spike',
      atMs: 4_000,
      durationMs: 5_000,
      params: { addMs: clamp(Math.round(primary.peakJitterBufferedMs * 0.35), 60, 140) },
    });
  }
  if (primary.queuePressureDrops > 0) {
    faults.push({
      kind: 'latency-spike',
      atMs: 10_000,
      durationMs: 4_000,
      params: { addMs: clamp(40 + primary.queuePressureDrops * 4, 60, 140) },
    });
  }
  if (tickBreachAvgMs > 15) {
    faults.push({
      kind: 'tick-stall',
      atMs: 7_000,
      durationMs: 9_000,
      params: { stallMs: clamp(Math.round(tickBreachAvgMs - 5), 20, 50) },
    });
  }
  const timestampPathology =
    stale.staleTimestampDrops >= 32
      ? {
          startAtMs: 5_000,
          lagMs: stale.staleTimestampDrops >= 500 ? 6_000 : 5_000,
          regressionMs: stale.staleTimestampDrops >= 500 ? 2_600 : 2_200,
          regressionEveryPackets: stale.staleTimestampDrops >= 500 ? 7 : 9,
        }
      : undefined;

  return {
    durationMs,
    avgInterPacketMs: 20,
    packetPattern,
    jitterStdDevMs: Math.round(jitterStdDevMs),
    burstFraction,
    lossRate,
    simulateRecoveryPathLatch,
    tickBreachFraction,
    tickBreachAvgMs: Math.round(tickBreachAvgMs),
    faults,
    timestampPathology,
    derivedSignals: {
      primaryRole: primary.role,
      staleRole: stale.role,
      primaryBacklogDrainActivations: primary.backlogDrainActivations,
      primaryPeakJitterBufferedMs: primary.peakJitterBufferedMs,
      primaryMinPcmBufferedMs: primary.minPcmBufferedMs,
      primaryTransportEvidenceKinds: primary.transportEvidenceKinds,
      staleTimestampDrops: stale.staleTimestampDrops,
    },
  };
}
