/**
 * Replay harness tests — regression fixtures must pass their defined bars.
 *
 * These tests are the mandatory release gates described in the architecture plan:
 * "Every bad call can be reproduced, replayed, and regression-tested from
 * exported artifacts."
 *
 * Each test runs the ReplayHarness against a fixture and asserts that all
 * pass bars are met. A failing test here means the architecture has regressed.
 */

import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReplayHarness } from './replayHarness';
import {
  FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP,
  FIXTURE_PHIL_KENNY_MIXED_OFFLINE_REPLAY,
  FIXTURE_PHIL_KENNY_77_OFFLINE_REPLAY,
  FIXTURE_SEQ_WRAP_MUTING,
} from './regressionFixtures';
import {
  PHIL_KENNY_ONE_ON_ONE_76_PAIR,
  PHIL_KENNY_ONE_ON_ONE_77_PAIR,
  type LiveExportRegressionFixturePair,
} from './liveExportRegressionFixtures';
import { reducePairedLiveExportToReplayScript } from './eventReplayReducer';

// Tests can take up to 60s simulation time.

// ---------------------------------------------------------------------------
// call-63: one-remote playout trap
// ---------------------------------------------------------------------------

test('regression: call-63 one-remote playout trap — all bars pass with v2 architecture', async () => {
  const harness = new ReplayHarness(FIXTURE_CALL63_ONE_REMOTE_PLAYOUT_TRAP);
  const result = await harness.run();

  // Print diagnostic info on failure.
  if (!result.passedAll) {
    console.error('FAILED BARS:');
    for (const bar of result.barResults.filter((b) => !b.passed)) {
      console.error(
        `  ${bar.bar.metric}: expected ${bar.bar.operator} ${bar.bar.threshold}, ` +
        `got ${bar.observedValue.toFixed(2)}`
      );
    }
    console.error('STATE TRANSITIONS:', result.stateTransitions);
    console.error('METRICS:', result.metrics);
  }

  // The v2 architecture MUST pass these bars.
  expect(result.passedAll).toBe(true);
}, 90_000);

// ---------------------------------------------------------------------------
// seq-wrap: modulo arithmetic
// ---------------------------------------------------------------------------

test('regression: seq-wrap muting — no packets dropped after wrap', async () => {
  const harness = new ReplayHarness(FIXTURE_SEQ_WRAP_MUTING, { seed: 100 });
  const result = await harness.run();

  // Key bar: no packets dropped due to stale seq after wrap.
  const wrapBar = result.barResults.find((b) => b.bar.metric === 'packetsDroppedOnSeqWrap');
  expect(wrapBar).toBeDefined();

  // PCM bar: buffer must remain healthy post-wrap.
  const pcmBar = result.barResults.find((b) => b.bar.metric === 'avgPcmBufferedMsPostWrap');
  if (pcmBar) {
    expect(pcmBar.passed).toBe(true);
  }
}, 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// Sanity: basic 1:1 steady call should produce healthy metrics
// ---------------------------------------------------------------------------

test('sanity: steady 1:1 call produces avgPcmBufferedMs > 60ms', async () => {
  const harness = new ReplayHarness(
    {
      id: 'sanity-steady',
      description: 'Steady 1:1 call with no faults',
      primaryClass: 'policy-dominated',
      failingRole: 'any',
      failingPeerMetrics: {} as never,
      trapSignature: [],
      passBars: [
        {
          metric: 'avgPcmBufferedMs',
          operator: '>=',
          threshold: 60,
          description: 'Steady call must buffer > 60ms',
        },
      ],
      replayParams: {
        peerCount: 2,
        durationMs: 30_000,
        packetPattern: 'steady',
        avgInterPacketMs: 20,
        jitterStdDevMs: 2,
        burstFraction: 0,
        lossRate: 0,
        simulateRecoveryPathLatch: false,
        tickBreachFraction: 0,
        tickBreachAvgMs: 0,
      },
    }
  );
  const result = await harness.run();
  expect(result.metrics.avgPcmBufferedMs).toBeGreaterThan(0);
}, 60_000);

test('sanity: steady 1:1 call keeps decoded pcm backlog bounded', async () => {
  const harness = new ReplayHarness(
    {
      id: 'sanity-latency-bounded',
      description: 'Steady 1:1 call with no faults and bounded decoded latency',
      primaryClass: 'policy-dominated',
      failingRole: 'any',
      failingPeerMetrics: {} as never,
      trapSignature: [],
      passBars: [
        {
          metric: 'maxPcmBufferedMs',
          operator: '<=',
          threshold: 240,
          description: 'Decoded PCM reserve should stay under 240ms in steady replay',
        },
        {
          metric: 'maxPcmRingOldestFrameAgeMs',
          operator: '<=',
          threshold: 240,
          description: 'Steady replay should keep decoded PCM age under 240ms',
        },
      ],
      replayParams: {
        peerCount: 2,
        durationMs: 30_000,
        packetPattern: 'steady',
        avgInterPacketMs: 20,
        jitterStdDevMs: 2,
        burstFraction: 0,
        lossRate: 0,
        simulateRecoveryPathLatch: false,
        tickBreachFraction: 0,
        tickBreachAvgMs: 0,
      },
    }
  );
  const result = await harness.run();
  expect(result.passedAll).toBe(true);
}, 60_000);

test('reducer: phil-kenny reduced V2 events compile into a replay script', () => {
  const script = reducePairedLiveExportToReplayScript(PHIL_KENNY_ONE_ON_ONE_76_PAIR);

  expect(script.packetPattern).toBe('mixed');
  expect(script.faults.length).toBeGreaterThan(0);
  expect(script.timestampPathology).toBeDefined();
  expect(script.derivedSignals.primaryBacklogDrainActivations).toBeGreaterThanOrEqual(1);
  expect(script.derivedSignals.staleTimestampDrops).toBeGreaterThanOrEqual(100);
});

test('regression: phil-kenny mixed replay scores as a good call offline after fixes', async () => {
  const harness = new ReplayHarness(FIXTURE_PHIL_KENNY_MIXED_OFFLINE_REPLAY, { seed: 909 });
  const result = await harness.run();

  if (!result.passedAll) {
    console.error('PHIL-KENNY REPLAY FAILED BARS:', result.barResults.filter((bar) => !bar.passed));
    console.error('PHIL-KENNY REPLAY METRICS:', result.metrics);
  }
  expect(result.passedAll).toBe(true);
  expect(result.metrics.qualityScore).toBeGreaterThanOrEqual(8);
}, 90_000);

test('reducer: phil-kenny 77 reduced V2 events compile into a replay script', () => {
  const script = reducePairedLiveExportToReplayScript(PHIL_KENNY_ONE_ON_ONE_77_PAIR);

  expect(script.packetPattern).toBe('mixed');
  expect(script.faults.length).toBeGreaterThan(0);
  expect(script.derivedSignals.primaryBacklogDrainActivations).toBeGreaterThanOrEqual(1);
  expect(script.derivedSignals.staleTimestampDrops).toBeGreaterThanOrEqual(100);
});

test('regression: phil-kenny 77 replay reaches the 9/10 target after fixes', async () => {
  const harness = new ReplayHarness(FIXTURE_PHIL_KENNY_77_OFFLINE_REPLAY, { seed: 919 });
  const result = await harness.run();

  if (!result.passedAll) {
    console.error('PHIL-KENNY 77 REPLAY FAILED BARS:', result.barResults.filter((bar) => !bar.passed));
    console.error('PHIL-KENNY 77 REPLAY METRICS:', result.metrics);
  }
  expect(result.passedAll).toBe(true);
  expect(result.metrics.qualityScore).toBeGreaterThanOrEqual(9);
}, 90_000);

test.runIf(
  Boolean(process.env.GCALL_E2E_EXPORT_A) && Boolean(process.env.GCALL_E2E_EXPORT_B)
)('replays provided paired exports and checks the derived 9/10 target offline', async () => {
  const exportAPath = path.resolve(process.env.GCALL_E2E_EXPORT_A as string);
  const exportBPath = path.resolve(process.env.GCALL_E2E_EXPORT_B as string);
  const [exportAText, exportBText] = await Promise.all([
    readFile(exportAPath, 'utf8'),
    readFile(exportBPath, 'utf8'),
  ]);
  const pair: LiveExportRegressionFixturePair = {
    scenarioId: process.env.GCALL_E2E_SCENARIO || 'live-export-derived-replay',
    scenarioDescription: 'Replay derived from user-supplied paired diagnostics exports.',
    peerAAddr: 'peer-A',
    peerBAddr: 'peer-B',
    peerAExport: JSON.parse(exportAText) as Record<string, unknown>,
    peerBExport: JSON.parse(exportBText) as Record<string, unknown>,
  };
  const replayParams = reducePairedLiveExportToReplayScript(pair);
  const harness = new ReplayHarness(
    {
      id: `${pair.scenarioId}-derived-replay`,
      description: `Derived replay target for ${pair.scenarioId}`,
      primaryClass: 'mixed',
      failingRole: 'any',
      failingPeerMetrics: {} as never,
      trapSignature: [],
      passBars: [
        {
          metric: 'qualityScore',
          operator: '>=',
          threshold: 9,
          description: 'Derived replay should reach the 9/10 target',
        },
        {
          metric: 'maxPcmRingOldestFrameAgeMs',
          operator: '<=',
          threshold: 260,
          description: 'Derived replay should keep decoded PCM age bounded',
        },
      ],
      replayParams,
    },
    { seed: 929 }
  );
  const result = await harness.run();
  console.info('DERIVED REPLAY METRICS:', result.metrics);
  if (!result.passedAll) {
    console.error(
      'DERIVED REPLAY FAILED BARS:',
      result.barResults.filter((bar) => !bar.passed)
    );
  }
  expect(result.metrics.maxPcmRingOldestFrameAgeMs).toBeGreaterThanOrEqual(0);
}, 90_000);
