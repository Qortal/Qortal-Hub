/**
 * Group Call V2 — PairedExportAnalyzer
 *
 * Automated analysis of paired diagnostic exports (one from each peer in a call).
 * Classifies each call according to the Phase 0 classification scheme:
 *
 *  - stall-dominated: long tasks / tick budget breaches correlate with bad jitter
 *  - decrypt-dominated: pending-decrypt drops with calm transport triad
 *  - transport-dominated: transport triad hot (bridge pressure + stale drops)
 *  - policy-dominated: bad jitter metrics with low stalls / decrypt / triad
 *  - mixed: multiple contributing factors
 *
 * Implements the `phase5PairedVerificationHint`: a fix is NOT successful if one
 * peer passes provisional bars and the other fails. Both peers must be measured
 * against the same bars.
 *
 * Input: Two raw diagnostic bundles (v1 schema from existing exports, or v2).
 * Output: A classification report with per-peer grades and root-cause attribution.
 */

import type { FailureClass } from './regressionFixtures';

// ---------------------------------------------------------------------------
// Input schema (matches existing v1 export shape)
// ---------------------------------------------------------------------------

export interface PeerExportMetrics {
  /** From exportWindowMetrics */
  avgPcmBufferedMs: number;
  avgPlayoutDeltaMs: number;
  playoutUnderTargetFraction: number;
  playoutOutsideTargetFraction: number;
  playoutRateFractionBelow1: number;
  jitterUnderruns: number;
  missingFrames: number;
  concealmentTicks: number;
  packetsDroppedStaleTimestamp: number;
  packetsDroppedStaleTimestampRatePerSec: number;
  packetsDroppedPendingDecrypt: number;
  packetsDroppedPendingDecryptRatePerSec: number;
  pendingDecryptDepthHighWater: number;
  reticulumAudioBridgeQueuedFramesHighWater: number;
  reticulumAudioBinaryOutQueueDepthHighWater: number;
  reticulumAudioBridgeWaitingForDrain: boolean;
  reticulumAudioQueuePressureDrops: number;
  reticulumAudioStaleDrops: number;
  avgOpusBufferedMs: number;
  maxOpusBufferedMs: number;
  adaptiveTargetMedianMs: number;
  wasmFecDeferredPcmTicks: number;
  durationMs: number;
  /** From liveMetricsSnapshot */
  adaptiveNetworkMode: string;
  playoutStarvationWorstSeverity: string;
  gcallAudioStage5BoostCumulativeMs: number;
  /** From gcallPerfSnapshot */
  tickBudgetBreachCount: number;
  tickBudgetBreachP95Ms: number;
  tickBudgetBreachMaxMs: number;
  longTaskCount: number;
  role: string;
  /** V2-aware export additions */
  v2ManagedSourceCount: number;
  legacyWindowOpusMetricsMeaningful: boolean;
  avgPcmRingBufferedMs: number;
  avgPcmRingOldestFrameAgeMs: number;
  maxPcmRingOldestFrameAgeMs: number;
  stalePcmDrops: number;
  avgTargetBufferMs: number;
}

// ---------------------------------------------------------------------------
// Provisional pass bars (from 2-way jitter verification hint)
// ---------------------------------------------------------------------------

export interface ProvisionalPassBarResult {
  readonly metric: string;
  readonly observed: number;
  readonly threshold: number;
  readonly operator: string;
  readonly passed: boolean;
  readonly description: string;
}

const PROVISIONAL_BARS: Array<{
  metric: keyof PeerExportMetrics;
  operator: '<' | '<=' | '>=' | '===';
  threshold: number;
  description: string;
}> = [
  {
    metric: 'packetsDroppedPendingDecryptRatePerSec',
    operator: '<',
    threshold: 1.0,
    description: 'Decrypt drop rate < 1.0/s (decrypt pass bar)',
  },
  {
    metric: 'playoutUnderTargetFraction',
    operator: '<=',
    threshold: 0.35,
    description: 'Under-target fraction ≤ 0.35 (provisional jitter pass)',
  },
  {
    metric: 'playoutOutsideTargetFraction',
    operator: '<=',
    threshold: 0.5,
    description: 'Outside-target fraction ≤ 0.5',
  },
];

// ---------------------------------------------------------------------------
// Thresholds for classification
// ---------------------------------------------------------------------------

const STALL_DOMINATED_BREACH_P95_MS = 10;
const STALL_DOMINATED_BREACH_COUNT = 5;
const DECRYPT_DOMINATED_DROP_RATE = 2.0;
const TRANSPORT_DOMINATED_BRIDGE_HW = 16;
const TRANSPORT_DOMINATED_BINARY_HW = 10;
const POLICY_BAD_UNDER_TARGET = 0.5;
const POLICY_BAD_PCM_MS = 30;
const STALE_TIMESTAMP_NOTE_DROP_COUNT = 32;
const STALE_TIMESTAMP_NOTE_DROP_RATE = 0.5;

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

export interface PeerClassification {
  readonly addr: string;
  readonly role: string;
  readonly primaryClass: FailureClass;
  readonly secondaryClass?: FailureClass;
  readonly provisionalBars: ProvisionalPassBarResult[];
  readonly passedAllBars: boolean;
  readonly severity: 'healthy' | 'mild' | 'moderate' | 'severe';
  readonly diagnosticNotes: string[];
}

export interface PairedAnalysisResult {
  readonly peerA: PeerClassification;
  readonly peerB: PeerClassification;
  /**
   * True when BOTH peers pass all provisional bars.
   * Per phase5PairedVerificationHint: a fix is not successful if one peer
   * passes and the other fails.
   */
  readonly bothPassed: boolean;
  /** The worse of the two peers. */
  readonly worseAddr: string;
  /** Overall call quality score 0–10. */
  readonly qualityScore: number;
  readonly callSummary: string;
}

export function scorePeerQuality(m: PeerExportMetrics): number {
  let score = 10;
  const concealmentFraction =
    m.durationMs > 0
      ? (m.concealmentTicks * 20) / m.durationMs
      : 0;
  const transportImpactingPlayout =
    m.playoutUnderTargetFraction > 0.05 ||
    m.playoutOutsideTargetFraction > 0.08 ||
    m.avgPcmBufferedMs < 100 ||
    concealmentFraction > 0.02;
  const stallImpactingPlayout =
    m.playoutUnderTargetFraction > 0.05 ||
    m.playoutOutsideTargetFraction > 0.08 ||
    m.avgPcmBufferedMs < 100;
  const staleTimestampImpactingPlayout =
    m.playoutUnderTargetFraction > 0.25 ||
    m.avgPcmBufferedMs < 95 ||
    concealmentFraction > 0.03;
  const mildTransportQueuePressure =
    m.playoutUnderTargetFraction <= 0.1 &&
    m.playoutOutsideTargetFraction <= 0.08 &&
    m.avgPcmBufferedMs >= 140 &&
    concealmentFraction <= 0.01;
  score -= m.playoutUnderTargetFraction * 4;
  if (m.avgPcmBufferedMs < 80) score -= (80 - m.avgPcmBufferedMs) / 20;
  if (m.avgPcmRingOldestFrameAgeMs > Math.max(m.avgTargetBufferMs * 1.5, 180)) {
    score -= Math.min(
      2.5,
      (m.avgPcmRingOldestFrameAgeMs - Math.max(m.avgTargetBufferMs * 1.5, 180)) / 80
    );
  }
  if (m.maxPcmRingOldestFrameAgeMs > Math.max(m.avgTargetBufferMs * 2, 260)) {
    score -= Math.min(
      1.5,
      (m.maxPcmRingOldestFrameAgeMs - Math.max(m.avgTargetBufferMs * 2, 260)) / 120
    );
  }
  if (m.packetsDroppedPendingDecryptRatePerSec > 0.5) score -= 2;
  if (m.packetsDroppedStaleTimestampRatePerSec > 0.5) {
    score -= staleTimestampImpactingPlayout ? 2 : 0.5;
  } else if (m.packetsDroppedStaleTimestamp > 32) {
    score -= staleTimestampImpactingPlayout ? 1 : 0.25;
  }
  if (m.reticulumAudioBridgeQueuedFramesHighWater > 16) {
    score -= mildTransportQueuePressure ? 0.25 : transportImpactingPlayout ? 1 : 0.25;
  }
  if (m.tickBudgetBreachP95Ms > 15) {
    score -= stallImpactingPlayout ? 2 : 0.5;
  }
  if (
    m.v2ManagedSourceCount > 0 &&
    m.avgPcmRingBufferedMs > Math.max(m.avgTargetBufferMs * 2, 250)
  ) {
    score -= 1;
  }
  return Math.max(0, Math.min(10, score));
}

// ---------------------------------------------------------------------------
// PairedExportAnalyzer
// ---------------------------------------------------------------------------

export class PairedExportAnalyzer {
  analyze(
    peerAAddr: string,
    peerAMetrics: PeerExportMetrics,
    peerBAddr: string,
    peerBMetrics: PeerExportMetrics
  ): PairedAnalysisResult {
    const classA = this._classifyPeer(peerAAddr, peerAMetrics);
    const classB = this._classifyPeer(peerBAddr, peerBMetrics);

    const bothPassed = classA.passedAllBars && classB.passedAllBars;

    // Severity score: compute a 0–10 quality score per peer, take the minimum.
    const scoreA = this._qualityScore(peerAMetrics);
    const scoreB = this._qualityScore(peerBMetrics);
    const qualityScore = Math.min(scoreA, scoreB);

    const worseAddr = scoreA <= scoreB ? peerAAddr : peerBAddr;

    const callSummary = this._buildSummary(classA, classB, bothPassed, qualityScore);

    return {
      peerA: classA,
      peerB: classB,
      bothPassed,
      worseAddr,
      qualityScore,
      callSummary,
    };
  }

  private _classifyPeer(addr: string, m: PeerExportMetrics): PeerClassification {
    const notes: string[] = [];
    const candidates: FailureClass[] = [];

    if (!m.legacyWindowOpusMetricsMeaningful && m.v2ManagedSourceCount > 0) {
      notes.push(
        `V2-managed sources: ${m.v2ManagedSourceCount}; using v2 jitter summary instead of legacy Opus window fields`
      );
    }
    if (
      m.v2ManagedSourceCount > 0 &&
      m.avgPcmRingBufferedMs >
        Math.max(m.avgTargetBufferMs * 2, 250)
    ) {
      notes.push(
        `Hidden decoded reserve: ring=${m.avgPcmRingBufferedMs.toFixed(1)}ms, target=${m.avgTargetBufferMs.toFixed(1)}ms`
      );
    }
    if (
      m.v2ManagedSourceCount > 0 &&
      m.avgPcmRingOldestFrameAgeMs >
        Math.max(m.avgTargetBufferMs * 1.5, 180)
    ) {
      notes.push(
        `Stale decoded PCM age: avg=${m.avgPcmRingOldestFrameAgeMs.toFixed(1)}ms, max=${m.maxPcmRingOldestFrameAgeMs.toFixed(1)}ms`
      );
    }
    if (m.stalePcmDrops > 0) {
      notes.push(`Freshness controller dropped ${m.stalePcmDrops} stale PCM frames`);
    }
    if (
      m.packetsDroppedStaleTimestamp >= STALE_TIMESTAMP_NOTE_DROP_COUNT ||
      m.packetsDroppedStaleTimestampRatePerSec >= STALE_TIMESTAMP_NOTE_DROP_RATE
    ) {
      notes.push(
        `Stale timestamp drops: ${m.packetsDroppedStaleTimestamp} ` +
          `(${m.packetsDroppedStaleTimestampRatePerSec.toFixed(2)}/s); ` +
          `inspect sourceTimestampLateness gating before playout policy tuning`
      );
    }

    // Stall-dominated check.
    const isStallDominated =
      m.tickBudgetBreachCount >= STALL_DOMINATED_BREACH_COUNT ||
      m.tickBudgetBreachP95Ms >= STALL_DOMINATED_BREACH_P95_MS ||
      m.longTaskCount >= 3;
    if (isStallDominated) {
      candidates.push('stall-dominated');
      notes.push(
        `Tick budget: ${m.tickBudgetBreachCount} breaches, P95=${m.tickBudgetBreachP95Ms.toFixed(1)}ms`
      );
    }

    // Decrypt-dominated check (only if triad is calm).
    const triadCalm =
      m.reticulumAudioBridgeQueuedFramesHighWater < TRANSPORT_DOMINATED_BRIDGE_HW &&
      m.reticulumAudioBinaryOutQueueDepthHighWater < TRANSPORT_DOMINATED_BINARY_HW &&
      !m.reticulumAudioBridgeWaitingForDrain;

    if (m.packetsDroppedPendingDecryptRatePerSec >= DECRYPT_DOMINATED_DROP_RATE && triadCalm) {
      candidates.push('decrypt-dominated');
      notes.push(
        `Decrypt drops: ${m.packetsDroppedPendingDecryptRatePerSec.toFixed(2)}/s (triad calm)`
      );
    }

    // Transport-dominated check.
    const triadHot =
      m.reticulumAudioBridgeQueuedFramesHighWater >= TRANSPORT_DOMINATED_BRIDGE_HW ||
      m.reticulumAudioBinaryOutQueueDepthHighWater >= TRANSPORT_DOMINATED_BINARY_HW ||
      m.reticulumAudioBridgeWaitingForDrain;
    if (triadHot) {
      candidates.push('transport-dominated');
      notes.push(
        `Transport triad: bridgeHW=${m.reticulumAudioBridgeQueuedFramesHighWater}, ` +
        `binaryHW=${m.reticulumAudioBinaryOutQueueDepthHighWater}`
      );
    }

    // Policy-dominated check: bad playout metrics with calm everything else.
    const policyBad =
      m.playoutUnderTargetFraction > POLICY_BAD_UNDER_TARGET ||
      m.avgPcmBufferedMs < POLICY_BAD_PCM_MS;
    if (policyBad && !isStallDominated && triadCalm && m.packetsDroppedPendingDecryptRatePerSec < 1) {
      candidates.push('policy-dominated');
      notes.push(
        `Policy: avgPcm=${m.avgPcmBufferedMs.toFixed(1)}ms, ` +
        `underTarget=${(m.playoutUnderTargetFraction * 100).toFixed(0)}%, ` +
        `mode=${m.adaptiveNetworkMode}`
      );
    }

    const primaryClass: FailureClass =
      candidates.length === 0 ? 'policy-dominated' : candidates[0];
    const secondaryClass: FailureClass | undefined =
      candidates.length >= 2 ? (candidates.length === 2 ? candidates[1] : 'mixed') : undefined;

    // Provisional pass bars.
    const provisionalBars: ProvisionalPassBarResult[] = PROVISIONAL_BARS.map((bar) => {
      const observed = m[bar.metric] as number;
      let passed: boolean;
      switch (bar.operator) {
        case '<': passed = observed < bar.threshold; break;
        case '<=': passed = observed <= bar.threshold; break;
        case '>=': passed = observed >= bar.threshold; break;
        case '===': passed = observed === bar.threshold; break;
        default: passed = false;
      }
      return {
        metric: bar.metric,
        observed,
        threshold: bar.threshold,
        operator: bar.operator,
        passed,
        description: bar.description,
      };
    });

    const passedAllBars = provisionalBars.every((b) => b.passed);

    // Stage 5 boost note.
    if (m.gcallAudioStage5BoostCumulativeMs > 5_000) {
      notes.push(`Stage5 boost: ${(m.gcallAudioStage5BoostCumulativeMs / 1000).toFixed(1)}s`);
    }

    // Severity.
    const score = this._qualityScore(m);
    const severity: PeerClassification['severity'] =
      score >= 7 ? 'healthy' : score >= 5 ? 'mild' : score >= 3 ? 'moderate' : 'severe';

    return {
      addr,
      role: m.role,
      primaryClass: candidates.length >= 2 ? 'mixed' : primaryClass,
      secondaryClass,
      provisionalBars,
      passedAllBars,
      severity,
      diagnosticNotes: notes,
    };
  }

  private _qualityScore(m: PeerExportMetrics): number {
    return scorePeerQuality(m);
  }

  private _buildSummary(
    a: PeerClassification,
    b: PeerClassification,
    bothPassed: boolean,
    qualityScore: number
  ): string {
    const grade = qualityScore >= 8 ? 'Good' : qualityScore >= 5 ? 'Acceptable' : qualityScore >= 3 ? 'Poor' : 'Broken';
    const peerSummary = [a, b]
      .map((p) => `${p.addr} (${p.role}): ${p.primaryClass}, severity=${p.severity}`)
      .join('; ');
    const passStatus = bothPassed ? 'BOTH PEERS PASS' : 'ONE OR BOTH PEERS FAIL';
    return `[${grade} ${qualityScore.toFixed(1)}/10] ${passStatus} — ${peerSummary}`;
  }
}

// ---------------------------------------------------------------------------
// Convenience: analyze a paired JSON export (v1 schema)
// ---------------------------------------------------------------------------

/**
 * Parse a v1 diagnostic export JSON and extract the metrics needed for analysis.
 */
export function extractMetricsFromV1Export(json: Record<string, unknown>): PeerExportMetrics {
  const live = (json.liveMetricsSnapshot ?? {}) as Record<string, unknown>;
  const win = (json.exportWindowMetrics ?? {}) as Record<string, unknown>;
  const v2 = (json.v2Diagnostics ?? {}) as Record<string, unknown>;
  const perf = ((json.gcallPerfSnapshot as Record<string, unknown> | undefined)?.meta ?? {}) as Record<string, unknown>;
  const lt = ((json.gcallPerfSnapshot as Record<string, unknown> | undefined)?.longTasks ?? {}) as Record<string, unknown>;

  const num = (obj: Record<string, unknown>, key: string): number =>
    typeof obj[key] === 'number' ? (obj[key] as number) : 0;
  const bool = (obj: Record<string, unknown>, key: string): boolean =>
    obj[key] === true;
  const str = (obj: Record<string, unknown>, key: string): string =>
    typeof obj[key] === 'string' ? (obj[key] as string) : '';
  const preferLiveWhenLegacyWindowMissing = (key: string): number => {
    const winValue = num(win, key);
    const liveValue = num(live, key);
    return !legacyWindowOpusMetricsMeaningful && winValue === 0 && liveValue > 0
      ? liveValue
      : winValue;
  };
  const maxWindowOrLive = (key: string): number =>
    Math.max(num(win, key), num(live, key));
  const legacyWindowOpusMetricsMeaningful =
    v2.legacyWindowOpusMetricsMeaningful !== false;
  const avgOpusBufferedMsRaw = num(win, 'avgOpusBufferedMs');
  const adaptiveTargetMedianMsRaw = num(win, 'adaptiveTargetMedianMs');
  const avgOpusBufferedMs =
    !legacyWindowOpusMetricsMeaningful && avgOpusBufferedMsRaw === 0
      ? num(v2, 'avgJitterBufferedMs')
      : avgOpusBufferedMsRaw;
  const adaptiveTargetMedianMs =
    !legacyWindowOpusMetricsMeaningful && adaptiveTargetMedianMsRaw === 0
      ? num(v2, 'avgTargetBufferMs')
      : adaptiveTargetMedianMsRaw;
  const v2ManagedSourceCount = Array.isArray(v2.v2ManagedSourceAddrs)
    ? v2.v2ManagedSourceAddrs.length
    : 0;
  const avgPcmRingBufferedMs = num(v2, 'avgPcmRingBufferedMs');
  const avgPcmRingOldestFrameAgeMs = num(v2, 'avgPcmRingOldestFrameAgeMs');
  const maxPcmRingOldestFrameAgeMs = num(v2, 'maxPcmRingOldestFrameAgeMs');
  const stalePcmDrops = num(v2, 'stalePcmDrops');
  const avgTargetBufferMs = num(v2, 'avgTargetBufferMs');
  const durationMs = num(win, 'durationMs');
  const staleTimestampDropsWindow = num(win, 'packetsDroppedStaleTimestamp');
  const staleTimestampDropsLive = num(live, 'packetsDroppedStaleTimestamp');
  const packetsDroppedStaleTimestamp = Math.max(
    staleTimestampDropsWindow,
    staleTimestampDropsLive
  );
  const packetsDroppedStaleTimestampRatePerSec =
    durationMs > 0
      ? packetsDroppedStaleTimestamp / (durationMs / 1000)
      : 0;

  return {
    avgPcmBufferedMs: preferLiveWhenLegacyWindowMissing('avgPcmBufferedMs'),
    avgPlayoutDeltaMs: preferLiveWhenLegacyWindowMissing('avgPlayoutDeltaMs'),
    playoutUnderTargetFraction: preferLiveWhenLegacyWindowMissing('playoutUnderTargetFraction'),
    playoutOutsideTargetFraction: preferLiveWhenLegacyWindowMissing('playoutOutsideTargetFraction'),
    playoutRateFractionBelow1: preferLiveWhenLegacyWindowMissing('playoutRateFractionBelow1'),
    jitterUnderruns: maxWindowOrLive('jitterUnderruns'),
    missingFrames: maxWindowOrLive('missingFrames'),
    concealmentTicks: maxWindowOrLive('concealmentTicks'),
    packetsDroppedStaleTimestamp,
    packetsDroppedStaleTimestampRatePerSec,
    packetsDroppedPendingDecrypt: maxWindowOrLive('packetsDroppedPendingDecrypt'),
    packetsDroppedPendingDecryptRatePerSec: maxWindowOrLive('packetsDroppedPendingDecryptRatePerSec'),
    pendingDecryptDepthHighWater: maxWindowOrLive('pendingDecryptDepthHighWater'),
    reticulumAudioBridgeQueuedFramesHighWater: maxWindowOrLive('reticulumAudioBridgeQueuedFramesHighWater'),
    reticulumAudioBinaryOutQueueDepthHighWater: maxWindowOrLive('reticulumAudioBinaryOutQueueDepthHighWater'),
    reticulumAudioBridgeWaitingForDrain: bool(live, 'reticulumAudioBridgeWaitingForDrain'),
    reticulumAudioQueuePressureDrops: maxWindowOrLive('reticulumAudioQueuePressureDrops'),
    reticulumAudioStaleDrops: maxWindowOrLive('reticulumAudioStaleDrops'),
    avgOpusBufferedMs,
    maxOpusBufferedMs: num(win, 'maxOpusBufferedMs'),
    adaptiveTargetMedianMs,
    wasmFecDeferredPcmTicks: num(win, 'wasmFecDeferredPcmTicks'),
    durationMs,
    adaptiveNetworkMode: str(live, 'adaptiveNetworkMode'),
    playoutStarvationWorstSeverity: str(live, 'playoutStarvationWorstSeverity'),
    gcallAudioStage5BoostCumulativeMs: num(live, 'gcallAudioStage5BoostCumulativeMs'),
    tickBudgetBreachCount: num(perf as Record<string, unknown>, 'tickBudgetBreachCount'),
    tickBudgetBreachP95Ms: num(perf as Record<string, unknown>, 'tickBudgetBreachP95Ms'),
    tickBudgetBreachMaxMs: num(perf as Record<string, unknown>, 'tickBudgetBreachMaxMs'),
    longTaskCount: num(lt as Record<string, unknown>, 'count'),
    role: str(live, 'role'),
    v2ManagedSourceCount,
    legacyWindowOpusMetricsMeaningful,
    avgPcmRingBufferedMs,
    avgPcmRingOldestFrameAgeMs,
    maxPcmRingOldestFrameAgeMs,
    stalePcmDrops,
    avgTargetBufferMs,
  };
}
