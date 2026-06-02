import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeGroupCallE2eArtifactBundle } from './groupCallE2eArtifactIO';
import { buildLiveExportArtifactBundle } from './groupCallE2eQuality';
import {
  PHIL_KENNY_ONE_ON_ONE_76_PAIR,
  PHIL_KENNY_ONE_ON_ONE_77_PAIR,
} from './liveExportRegressionFixtures';

const liveArtifactRoot = process.env.GCALL_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.GCALL_E2E_ARTIFACT_DIR, 'live-export')
  : null;

function createSyntheticExport(role: string, overrides: {
  avgPcmBufferedMs?: number;
  playoutUnderTargetFraction?: number;
  playoutOutsideTargetFraction?: number;
  tickBudgetBreachCount?: number;
  packetsDroppedStaleTimestamp?: number;
} = {}): Record<string, unknown> {
  return {
    liveMetricsSnapshot: {
      role,
      adaptiveNetworkMode: overrides.playoutUnderTargetFraction && overrides.playoutUnderTargetFraction > 0.4 ? 'recovery' : 'steady',
      playoutStarvationWorstSeverity: overrides.playoutUnderTargetFraction && overrides.playoutUnderTargetFraction > 0.6 ? 'strong' : 'mild',
      gcallAudioStage5BoostCumulativeMs: 0,
      reticulumAudioBridgeWaitingForDrain: false,
    },
    exportWindowMetrics: {
      avgPcmBufferedMs: overrides.avgPcmBufferedMs ?? 96,
      avgPlayoutDeltaMs: (overrides.avgPcmBufferedMs ?? 96) - 120,
      playoutUnderTargetFraction: overrides.playoutUnderTargetFraction ?? 0.12,
      playoutOutsideTargetFraction: overrides.playoutOutsideTargetFraction ?? 0.16,
      playoutRateFractionBelow1: 0,
      jitterUnderruns: 1,
      missingFrames: 0,
      concealmentTicks: 0,
      packetsDroppedStaleTimestamp: overrides.packetsDroppedStaleTimestamp ?? 0,
      packetsDroppedPendingDecrypt: 0,
      packetsDroppedPendingDecryptRatePerSec: 0,
      pendingDecryptDepthHighWater: 0,
      reticulumAudioBridgeQueuedFramesHighWater: 0,
      reticulumAudioBinaryOutQueueDepthHighWater: 0,
      reticulumAudioQueuePressureDrops: 0,
      reticulumAudioStaleDrops: 0,
      avgOpusBufferedMs: 88,
      maxOpusBufferedMs: 140,
      adaptiveTargetMedianMs: 120,
      wasmFecDeferredPcmTicks: 0,
      durationMs: 24_000,
    },
    gcallPerfSnapshot: {
      meta: {
        tickBudgetBreachCount: overrides.tickBudgetBreachCount ?? 0,
        tickBudgetBreachP95Ms: overrides.tickBudgetBreachCount ? 22 : 0,
        tickBudgetBreachMaxMs: overrides.tickBudgetBreachCount ? 33 : 0,
      },
      longTasks: {
        count: overrides.tickBudgetBreachCount ? 2 : 0,
      },
    },
    v2Diagnostics: {
      v2ManagedSourceAddrs: ['peer'],
      legacyWindowOpusMetricsMeaningful: false,
      avgJitterBufferedMs: 88,
      avgPcmRingBufferedMs: overrides.avgPcmBufferedMs ?? 96,
      avgTargetBufferMs: 120,
    },
  };
}

describe('group call E2E live export workflow', () => {
  test('builds a prompt-ready artifact bundle from paired export JSON', async () => {
    const bundle = buildLiveExportArtifactBundle({
      scenarioId: 'synthetic-live-export',
      scenarioDescription: 'Synthetic paired export used to validate live export workflow.',
      peerAAddr: 'peer-A',
      peerBAddr: 'peer-B',
      peerAExport: createSyntheticExport('root-forwarder', {
        avgPcmBufferedMs: 42,
        playoutUnderTargetFraction: 0.63,
        playoutOutsideTargetFraction: 0.71,
        packetsDroppedStaleTimestamp: 120,
      }),
      peerBExport: createSyntheticExport('standby-forwarder'),
    });
    if (liveArtifactRoot) {
      await writeGroupCallE2eArtifactBundle(liveArtifactRoot, bundle);
    }
    expect(bundle.report.mode).toBe('live-export');
    expect(bundle.report.pairedAnalysis.qualityScore).toBeGreaterThanOrEqual(0);
    expect(bundle.promptContextMarkdown).toContain('Cursor Prompt Context');
    expect(bundle.report.peerA.classification.diagnosticNotes.join('\n')).toContain(
      'Stale timestamp drops:'
    );
  });

  test('classifies the phil-kenny captured pair as an offline regression', async () => {
    const bundle = buildLiveExportArtifactBundle(PHIL_KENNY_ONE_ON_ONE_76_PAIR);
    if (liveArtifactRoot) {
      await writeGroupCallE2eArtifactBundle(liveArtifactRoot, bundle);
    }
    expect(bundle.report.mode).toBe('live-export');
    expect(bundle.report.pairedAnalysis.bothPassed).toBe(false);
    expect(bundle.report.pairedAnalysis.qualityScore).toBeLessThan(8);
    expect(bundle.report.peerA.classification.primaryClass).toBe('mixed');
    expect(bundle.report.peerA.classification.diagnosticNotes.join('\n')).toContain(
      'Tick budget:'
    );
    expect(bundle.report.peerA.classification.diagnosticNotes.join('\n')).toContain(
      'Transport triad:'
    );
    expect(bundle.report.peerB.classification.diagnosticNotes.join('\n')).toContain(
      'Stale timestamp drops:'
    );
    expect(bundle.summaryMarkdown).toContain('needs-work');
  });

  test('classifies the improved phil-kenny captured pair as better but still below the 9/10 target', async () => {
    const bundle = buildLiveExportArtifactBundle(PHIL_KENNY_ONE_ON_ONE_77_PAIR);
    if (liveArtifactRoot) {
      await writeGroupCallE2eArtifactBundle(liveArtifactRoot, bundle);
    }
    expect(bundle.report.mode).toBe('live-export');
    expect(bundle.report.pairedAnalysis.qualityScore).toBeGreaterThanOrEqual(7);
    expect(bundle.report.pairedAnalysis.qualityScore).toBeLessThan(9);
    expect(bundle.report.peerA.classification.primaryClass).toBe('stall-dominated');
    expect(bundle.report.peerB.classification.diagnosticNotes.join('\n')).toContain(
      'Stale timestamp drops:'
    );
  });

  test.runIf(
    Boolean(process.env.GCALL_E2E_EXPORT_A) && Boolean(process.env.GCALL_E2E_EXPORT_B)
  )('loads provided paired exports and writes the shared bundle format', async () => {
    const exportAPath = path.resolve(process.env.GCALL_E2E_EXPORT_A as string);
    const exportBPath = path.resolve(process.env.GCALL_E2E_EXPORT_B as string);
    const [exportAText, exportBText] = await Promise.all([
      readFile(exportAPath, 'utf8'),
      readFile(exportBPath, 'utf8'),
    ]);
    const bundle = buildLiveExportArtifactBundle({
      scenarioId: process.env.GCALL_E2E_SCENARIO || 'live-export-pair',
      scenarioDescription: 'User-supplied paired diagnostics exports.',
      peerAAddr: 'peer-A',
      peerBAddr: 'peer-B',
      peerAExport: JSON.parse(exportAText) as Record<string, unknown>,
      peerBExport: JSON.parse(exportBText) as Record<string, unknown>,
    });
    console.info('LIVE EXPORT SUMMARY:', {
      qualityScore: bundle.report.pairedAnalysis.qualityScore,
      bothPassed: bundle.report.pairedAnalysis.bothPassed,
      worseAddr: bundle.report.pairedAnalysis.worseAddr,
      peerAClass: bundle.report.peerA.classification.primaryClass,
      peerBClass: bundle.report.peerB.classification.primaryClass,
    });
    if (liveArtifactRoot) {
      await writeGroupCallE2eArtifactBundle(liveArtifactRoot, bundle, {
        'peer-a-export.json': exportAText,
        'peer-b-export.json': exportBText,
      });
    }
    expect(bundle.report.peerA.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(bundle.report.peerB.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });
});
