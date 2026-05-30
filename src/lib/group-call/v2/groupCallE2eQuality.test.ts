import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeGroupCallE2eArtifactBundle } from './groupCallE2eArtifactIO';
import {
  runGroupCallE2eScenario,
  selectGroupCallE2eScenarios,
} from './groupCallE2eQuality';

const artifactRoot = process.env.GCALL_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.GCALL_E2E_ARTIFACT_DIR, 'deterministic')
  : null;
const selectedScenarios = selectGroupCallE2eScenarios(
  process.env.GCALL_E2E_SCENARIO ?? ''
);
const selectedModes = (process.env.GCALL_E2E_MODE ?? 'deterministic,audio-surface-sim')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean) as Array<'deterministic' | 'audio-surface-sim'>;

describe('group call E2E quality lab', () => {
  for (const mode of selectedModes) {
    for (const scenario of selectedScenarios) {
      test(
        `scenario: ${scenario.id} [${mode}]`,
        async () => {
          const bundle = await runGroupCallE2eScenario(scenario, mode);
          if (artifactRoot) {
            await writeGroupCallE2eArtifactBundle(path.join(artifactRoot, mode), bundle);
          }
          expect(bundle.report.schemaVersion).toBe(1);
          expect(bundle.report.mode).toBe(mode);
          expect(bundle.report.peerA.timeline).not.toBeNull();
          expect(bundle.report.peerB.timeline).not.toBeNull();
          expect(bundle.summaryMarkdown).toContain('Likely Fix Surfaces');
          expect(bundle.promptContextMarkdown).toContain('Cursor Prompt Context');
          expect(bundle.report.likelyFixSurfaces.length).toBeGreaterThan(0);
          if (scenario.id === 'good-vs-stale-timestamp') {
            expect(bundle.report.peerA.classification.diagnosticNotes.join('\n')).toContain(
              'Stale timestamp drops:'
            );
            expect(bundle.summaryMarkdown).toContain('staleTsDrops=');
          }
          if (mode === 'audio-surface-sim' && scenario.id === 'steady-clean-symmetric') {
            expect(bundle.report.pairedAnalysis.qualityScore).toBeGreaterThanOrEqual(8);
            expect(bundle.report.peerA.metrics.v2ManagedSourceCount).toBe(1);
            expect(bundle.report.peerB.metrics.v2ManagedSourceCount).toBe(1);
          }
        },
        scenario.durationMs > 60_000 ? 180_000 : 90_000
      );
    }
  }
});
