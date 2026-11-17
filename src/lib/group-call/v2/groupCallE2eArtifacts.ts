import type { FailureClass } from './regressionFixtures';
import {
  PairedExportAnalyzer,
  type PairedAnalysisResult,
  type PeerClassification,
  type PeerExportMetrics,
} from './pairedExportAnalyzer';

export type GroupCallE2eMode =
  | 'deterministic'
  | 'audio-surface-sim'
  | 'electron'
  | 'live-export';

export type GroupCallE2eStage =
  | 'arrival'
  | 'jitter'
  | 'decode'
  | 'pcm-ring'
  | 'playout';

export interface GroupCallE2eStageSummary {
  readonly firstIssueAtMs: number | null;
}

export interface GroupCallE2ePeerTimelineSummary {
  readonly firstIssueAtMs: number | null;
  readonly firstIssueStage: GroupCallE2eStage | null;
  readonly arrival: GroupCallE2eStageSummary & {
    readonly totalPackets: number;
    readonly deliveredPackets: number;
    readonly droppedPackets: number;
    readonly dropRate: number;
    readonly staleTimestampDrops: number;
    readonly maxExcessLatenessMs: number;
    readonly maxTimestampRegressionMs: number;
  };
  readonly jitter: GroupCallE2eStageSummary & {
    readonly avgBufferedMs: number;
    readonly maxBufferedMs: number;
    readonly maxDepthFrames: number;
  };
  readonly decode: GroupCallE2eStageSummary & {
    readonly framesDecoded: number;
    readonly concealmentFrames: number;
    readonly concealmentTicks: number;
  };
  readonly pcmRing: GroupCallE2eStageSummary & {
    readonly avgBufferedMs: number;
    readonly minBufferedMs: number;
    readonly maxBufferedMs: number;
    readonly underruns: number;
    readonly overruns: number;
  };
  readonly playout: GroupCallE2eStageSummary & {
    readonly avgDeltaMs: number;
    readonly underTargetFraction: number;
    readonly outsideTargetFraction: number;
    readonly targetBufferMs: number;
  };
  readonly perf: {
    readonly tickBudgetBreachCount: number;
    readonly tickBudgetBreachP95Ms: number;
    readonly tickBudgetBreachMaxMs: number;
    readonly longTaskCount: number;
  };
}

export interface GroupCallE2ePeerStartupSummary {
  readonly windowMs: number;
  readonly tickCount: number;
  readonly avgPcmBufferedMs: number;
  readonly underTargetFraction: number;
  readonly outsideTargetFraction: number;
  readonly concealmentTicks: number;
  readonly decodeDrops: number;
}

export interface GroupCallE2ePeerArtifact {
  readonly addr: string;
  readonly role: string;
  readonly senderProfileId: string;
  readonly senderProfileLabel: string;
  readonly impairmentSummary: string;
  readonly metrics: PeerExportMetrics;
  readonly classification: PeerClassification;
  readonly timeline: GroupCallE2ePeerTimelineSummary | null;
  readonly startup: GroupCallE2ePeerStartupSummary | null;
  readonly stateTransitions: ReadonlyArray<{
    readonly state: string;
    readonly count: number;
  }>;
}

export interface GroupCallE2eReport {
  readonly schemaVersion: 1;
  readonly mode: GroupCallE2eMode;
  readonly scenarioId: string;
  readonly scenarioDescription: string;
  readonly fixtureId: string | null;
  readonly generatedAt: string;
  readonly seed: number | null;
  readonly pairedAnalysis: PairedAnalysisResult;
  readonly firstDegradedPeer: string | null;
  readonly firstDegradedStage: GroupCallE2eStage | null;
  readonly likelyFixSurfaces: FailureClass[];
  readonly peerA: GroupCallE2ePeerArtifact;
  readonly peerB: GroupCallE2ePeerArtifact;
}

export interface GroupCallE2eArtifactBundle {
  readonly report: GroupCallE2eReport;
  readonly summaryMarkdown: string;
  readonly promptContextMarkdown: string;
}

export interface BuildGroupCallE2eArtifactBundleInput {
  readonly mode: GroupCallE2eMode;
  readonly scenarioId: string;
  readonly scenarioDescription: string;
  readonly fixtureId?: string | null;
  readonly seed?: number | null;
  readonly peerA: Omit<GroupCallE2ePeerArtifact, 'classification'>;
  readonly peerB: Omit<GroupCallE2ePeerArtifact, 'classification'>;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

function uniqueFixSurfaces(result: PairedAnalysisResult): FailureClass[] {
  const classes: FailureClass[] = [];
  for (const candidate of [
    result.peerA.primaryClass,
    result.peerA.secondaryClass,
    result.peerB.primaryClass,
    result.peerB.secondaryClass,
  ]) {
    if (!candidate) continue;
    if (!classes.includes(candidate)) classes.push(candidate);
  }
  return classes;
}

function firstDegraded(
  peerA: GroupCallE2ePeerArtifact,
  peerB: GroupCallE2ePeerArtifact,
  fallbackAddr: string
): {
  firstDegradedPeer: string | null;
  firstDegradedStage: GroupCallE2eStage | null;
} {
  const candidates = [peerA, peerB]
    .map((peer) => ({
      addr: peer.addr,
      firstIssueAtMs: peer.timeline?.firstIssueAtMs ?? Number.POSITIVE_INFINITY,
      firstIssueStage: peer.timeline?.firstIssueStage ?? null,
    }))
    .filter((peer) => Number.isFinite(peer.firstIssueAtMs));
  if (candidates.length === 0) {
    return {
      firstDegradedPeer: fallbackAddr,
      firstDegradedStage: null,
    };
  }
  candidates.sort((a, b) => a.firstIssueAtMs - b.firstIssueAtMs || a.addr.localeCompare(b.addr));
  return {
    firstDegradedPeer: candidates[0]?.addr ?? fallbackAddr,
    firstDegradedStage: candidates[0]?.firstIssueStage ?? null,
  };
}

function fixSurfaceHint(failureClass: FailureClass): string {
  switch (failureClass) {
    case 'transport-dominated':
      return 'Inspect bridge pressure, packet delivery delay, and transport recovery behavior.';
    case 'decrypt-dominated':
      return 'Inspect decrypt backlog limits, worker throughput, and pending-decrypt drops.';
    case 'stall-dominated':
      return 'Inspect tick budget breaches, long tasks, and main-thread scheduling stalls.';
    case 'mixed':
      return 'Inspect the worst peer first, then split follow-up work by the paired secondary class.';
    case 'policy-dominated':
    default:
      return 'Inspect target buffer policy, backlogDrain transitions, and playout stabilization.';
  }
}

function arrivalNote(peer: GroupCallE2ePeerArtifact): string {
  const staleDrops = peer.timeline?.arrival.staleTimestampDrops ?? 0;
  if (staleDrops <= 0) return '';
  const staleRate = peer.metrics.packetsDroppedStaleTimestampRatePerSec;
  return `, staleTsDrops=${staleDrops} (${formatMetric(staleRate)}/s)`;
}

export function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

export function buildGroupCallE2eArtifactBundle(
  input: BuildGroupCallE2eArtifactBundleInput
): GroupCallE2eArtifactBundle {
  const analyzer = new PairedExportAnalyzer();
  const pairedAnalysis = analyzer.analyze(
    input.peerA.addr,
    input.peerA.metrics,
    input.peerB.addr,
    input.peerB.metrics
  );
  const peerA: GroupCallE2ePeerArtifact = {
    ...input.peerA,
    classification: pairedAnalysis.peerA,
  };
  const peerB: GroupCallE2ePeerArtifact = {
    ...input.peerB,
    classification: pairedAnalysis.peerB,
  };
  const first = firstDegraded(peerA, peerB, pairedAnalysis.worseAddr);
  const likelyFixSurfaces = uniqueFixSurfaces(pairedAnalysis);
  const report: GroupCallE2eReport = {
    schemaVersion: 1,
    mode: input.mode,
    scenarioId: input.scenarioId,
    scenarioDescription: input.scenarioDescription,
    fixtureId: input.fixtureId ?? null,
    generatedAt: new Date().toISOString(),
    seed: input.seed ?? null,
    pairedAnalysis,
    firstDegradedPeer: first.firstDegradedPeer,
    firstDegradedStage: first.firstDegradedStage,
    likelyFixSurfaces,
    peerA,
    peerB,
  };

  const summaryMarkdown = [
    `# Group Call E2E Summary`,
    ``,
    `Scenario: \`${report.scenarioId}\``,
    `Mode: \`${report.mode}\``,
    `Quality: \`${formatMetric(report.pairedAnalysis.qualityScore)}/10\``,
    `Paired status: \`${report.pairedAnalysis.bothPassed ? 'both-pass' : 'needs-work'}\``,
    `Worse peer: \`${report.pairedAnalysis.worseAddr}\``,
    `First degraded peer: \`${report.firstDegradedPeer ?? 'unknown'}\``,
    `First degraded stage: \`${report.firstDegradedStage ?? 'unknown'}\``,
    ``,
    `## Likely Fix Surfaces`,
    ...report.likelyFixSurfaces.map((surface) => `- \`${surface}\`: ${fixSurfaceHint(surface)}`),
    ``,
    `## Peer Notes`,
    ...[report.peerA, report.peerB].flatMap((peer) => [
      `- \`${peer.addr}\` (${peer.role}) via \`${peer.senderProfileId}\`: ${peer.classification.primaryClass}, severity=${peer.classification.severity}, underTarget=${formatMetric(peer.metrics.playoutUnderTargetFraction)}, avgPcmMs=${formatMetric(peer.metrics.avgPcmBufferedMs)}${arrivalNote(peer)}`,
      ...(peer.startup
        ? [
            `  startup: underTarget=${formatMetric(peer.startup.underTargetFraction)}, avgPcmMs=${formatMetric(peer.startup.avgPcmBufferedMs)}, decodeDrops=${peer.startup.decodeDrops}, concealmentTicks=${peer.startup.concealmentTicks}`,
          ]
        : []),
      ...peer.classification.diagnosticNotes.map((note) => `  ${note}`),
    ]),
  ].join('\n');

  const promptContextMarkdown = [
    `# Cursor Prompt Context`,
    ``,
    `Use this bundle to debug scenario \`${report.scenarioId}\`. Focus on the worse peer first and preserve the same seed/profile pair when validating a fix.`,
    ``,
    `## Scenario`,
    `- Description: ${report.scenarioDescription}`,
    `- Mode: \`${report.mode}\``,
    `- Seed: \`${report.seed ?? 'n/a'}\``,
    `- Fixture: \`${report.fixtureId ?? 'n/a'}\``,
    ``,
    `## Paired Result`,
    `- Call summary: ${report.pairedAnalysis.callSummary}`,
    `- Likely fix surfaces: ${report.likelyFixSurfaces.map((surface) => `\`${surface}\``).join(', ') || 'none'}`,
    `- First degraded peer/stage: \`${report.firstDegradedPeer ?? 'unknown'}\` / \`${report.firstDegradedStage ?? 'unknown'}\``,
    ``,
    `## Peer A`,
    `- Addr/role: \`${report.peerA.addr}\` / \`${report.peerA.role}\``,
    `- Sender profile: \`${report.peerA.senderProfileId}\` (${report.peerA.impairmentSummary})`,
    `- Primary class: \`${report.peerA.classification.primaryClass}\``,
    `- Key metrics: avgPcm=${formatMetric(report.peerA.metrics.avgPcmBufferedMs)}ms, avgOpus=${formatMetric(report.peerA.metrics.avgOpusBufferedMs)}ms, underTarget=${formatMetric(report.peerA.metrics.playoutUnderTargetFraction)}, tickBreachP95=${formatMetric(report.peerA.metrics.tickBudgetBreachP95Ms)}ms, staleTsDrops=${report.peerA.timeline?.arrival.staleTimestampDrops ?? 0}`,
    `- Timeline: firstIssue=${formatMetric(report.peerA.timeline?.firstIssueAtMs ?? 0)}ms, stage=\`${report.peerA.timeline?.firstIssueStage ?? 'unknown'}\``,
    ``,
    `## Peer B`,
    `- Addr/role: \`${report.peerB.addr}\` / \`${report.peerB.role}\``,
    `- Sender profile: \`${report.peerB.senderProfileId}\` (${report.peerB.impairmentSummary})`,
    `- Primary class: \`${report.peerB.classification.primaryClass}\``,
    `- Key metrics: avgPcm=${formatMetric(report.peerB.metrics.avgPcmBufferedMs)}ms, avgOpus=${formatMetric(report.peerB.metrics.avgOpusBufferedMs)}ms, underTarget=${formatMetric(report.peerB.metrics.playoutUnderTargetFraction)}, tickBreachP95=${formatMetric(report.peerB.metrics.tickBudgetBreachP95Ms)}ms, staleTsDrops=${report.peerB.timeline?.arrival.staleTimestampDrops ?? 0}`,
    `- Timeline: firstIssue=${formatMetric(report.peerB.timeline?.firstIssueAtMs ?? 0)}ms, stage=\`${report.peerB.timeline?.firstIssueStage ?? 'unknown'}\``,
    ``,
    `## Suggested Next Step`,
    `- ${fixSurfaceHint(report.likelyFixSurfaces[0] ?? report.peerA.classification.primaryClass)}`,
  ].join('\n');

  return {
    report,
    summaryMarkdown,
    promptContextMarkdown,
  };
}

export function buildMinimalTimelineSummary(metrics: PeerExportMetrics): GroupCallE2ePeerTimelineSummary {
  const firstIssueStage: GroupCallE2eStage | null =
    metrics.tickBudgetBreachCount > 0
      ? 'playout'
      : metrics.packetsDroppedPendingDecryptRatePerSec > 0
        ? 'decode'
        : metrics.playoutUnderTargetFraction > 0.35
          ? 'pcm-ring'
          : null;
  return {
    firstIssueAtMs: null,
    firstIssueStage,
    arrival: {
      firstIssueAtMs: null,
      totalPackets: 0,
      deliveredPackets: 0,
      droppedPackets: 0,
      dropRate: 0,
      staleTimestampDrops: 0,
      maxExcessLatenessMs: 0,
      maxTimestampRegressionMs: 0,
    },
    jitter: {
      firstIssueAtMs: null,
      avgBufferedMs: metrics.avgOpusBufferedMs,
      maxBufferedMs: metrics.maxOpusBufferedMs,
      maxDepthFrames: Math.max(0, Math.round(metrics.maxOpusBufferedMs / 20)),
    },
    decode: {
      firstIssueAtMs: null,
      framesDecoded: 0,
      concealmentFrames: metrics.concealmentTicks,
      concealmentTicks: metrics.concealmentTicks,
    },
    pcmRing: {
      firstIssueAtMs: null,
      avgBufferedMs: metrics.avgPcmRingBufferedMs || metrics.avgPcmBufferedMs,
      minBufferedMs: metrics.avgPcmBufferedMs,
      maxBufferedMs: metrics.avgPcmRingBufferedMs || metrics.avgPcmBufferedMs,
      underruns: metrics.jitterUnderruns,
      overruns: 0,
    },
    playout: {
      firstIssueAtMs: null,
      avgDeltaMs: metrics.avgPlayoutDeltaMs,
      underTargetFraction: metrics.playoutUnderTargetFraction,
      outsideTargetFraction: metrics.playoutOutsideTargetFraction,
      targetBufferMs: metrics.avgTargetBufferMs || metrics.adaptiveTargetMedianMs,
    },
    perf: {
      tickBudgetBreachCount: metrics.tickBudgetBreachCount,
      tickBudgetBreachP95Ms: metrics.tickBudgetBreachP95Ms,
      tickBudgetBreachMaxMs: metrics.tickBudgetBreachMaxMs,
      longTaskCount: metrics.longTaskCount,
    },
  };
}

export function summarizeTickBreaches(values: readonly number[]): {
  readonly count: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly longTaskCount: number;
} {
  return {
    count: values.length,
    p95Ms: percentile(values, 0.95),
    maxMs: values.length > 0 ? Math.max(...values) : 0,
    longTaskCount: values.filter((value) => value >= 50).length,
  };
}

export function summarizeValues(values: readonly number[]): {
  readonly avg: number;
  readonly min: number;
  readonly max: number;
} {
  return {
    avg: average(values),
    min: values.length > 0 ? Math.min(...values) : 0,
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}
