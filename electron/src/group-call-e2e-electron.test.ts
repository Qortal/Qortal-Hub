import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeGroupCallE2eArtifactBundle } from '../../src/lib/group-call/v2/groupCallE2eArtifactIO';
import {
  getGroupCallE2eScenario,
  runGroupCallE2eScenario,
} from '../../src/lib/group-call/v2/groupCallE2eQuality';

const artifactRoot = process.env.GCALL_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.GCALL_E2E_ARTIFACT_DIR, 'electron')
  : null;

describe('group call E2E electron validation', () => {
  for (const scenarioId of ['steady-clean-symmetric', 'good-vs-high-jitter']) {
    test(
      `electron-tier contract: ${scenarioId}`,
      async () => {
        const scenario = getGroupCallE2eScenario(scenarioId);
        const deterministic = await runGroupCallE2eScenario(scenario, 'deterministic');
        const electron = await runGroupCallE2eScenario(scenario, 'electron');
        if (artifactRoot) {
          await writeGroupCallE2eArtifactBundle(artifactRoot, electron);
        }
        expect(Math.abs(
          deterministic.report.pairedAnalysis.qualityScore -
            electron.report.pairedAnalysis.qualityScore
        )).toBeLessThanOrEqual(0.01);
        expect(electron.report.mode).toBe('electron');
        expect(electron.promptContextMarkdown).toContain('Cursor Prompt Context');
      },
      120_000
    );
  }
});
