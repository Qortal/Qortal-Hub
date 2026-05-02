import { describe, expect, it, beforeEach } from 'vitest';
import {
  gcallDiagnosticsClear,
  gcallDiagnosticsGetEvents,
  gcallDiagnosticsPush,
  gcallDiagnosticsPushMetricsThrottled,
  truncateGcallDiagAddress,
  buildGcallDiagnosticsExportJson,
  extractTransportTriadFromLiveMetrics,
  isGcallDebugEnabled,
  readGcallDiagnosticsRingEnabled,
  GCALL_TRANSPORT_TRIAD_INTERPRETATION,
  GCALL_TWO_WAY_DECRYPT_VERIFICATION_HINT,
  GCALL_TWO_WAY_JITTER_BASELINE_HINT,
  GCALL_PHASE0_CLASSIFICATION_HINT,
  GCALL_PHASE2_PENDING_DECRYPT_WINDOW_HINT,
  GCALL_PHASE5_PAIRED_VERIFICATION_HINT,
} from './gcall-diagnostics';

describe('gcall-diagnostics', () => {
  beforeEach(() => {
    gcallDiagnosticsClear();
    localStorage.removeItem('qortal:gcall-debug');
    localStorage.removeItem('qortal:gcall-diagnostics');
    localStorage.removeItem('qortal:gcall-mic-debug');
  });

  it('isGcallDebugEnabled is false without qortal:gcall-debug', () => {
    expect(isGcallDebugEnabled()).toBe(false);
  });

  it('isGcallDebugEnabled is true when qortal:gcall-debug is 1', () => {
    localStorage.setItem('qortal:gcall-debug', '1');
    expect(isGcallDebugEnabled()).toBe(true);
  });

  it('readGcallDiagnosticsRingEnabled honors the in-memory override', () => {
    localStorage.setItem('qortal:gcall-diagnostics', '0');
    expect(readGcallDiagnosticsRingEnabled()).toBe(true);
    gcallDiagnosticsPush('log', '[GCall] kept', { n: 1 });
    expect(gcallDiagnosticsGetEvents().length).toBe(1);
  });

  it('truncates long base58-like addresses', () => {
    const a = 'QcrJnvVB2Tr47QyD7FNm9PDJDWqWy7Prc3';
    expect(truncateGcallDiagAddress(a)).toBe('QcrJnv…Prc3');
  });

  it('ring buffer drops oldest over max', () => {
    for (let i = 0; i < 950; i++) {
      gcallDiagnosticsPush('log', `[GCall] test-${i}`, { i });
    }
    expect(gcallDiagnosticsGetEvents().length).toBeLessThanOrEqual(900);
    expect(gcallDiagnosticsGetEvents()[0]?.payload).toMatchObject({ i: 50 });
  });

  it('keeps critical startup media events when noisy buffer logs overflow the ring', () => {
    gcallDiagnosticsPush('info', '[GCall] localJoinReannounce', {
      reason: 'inbound-media-missing',
    });
    for (let i = 0; i < 950; i++) {
      gcallDiagnosticsPush('info', '[GCall] bufferEnforceActive', { i });
    }
    const events = gcallDiagnosticsGetEvents();
    expect(events.length).toBeLessThanOrEqual(900);
    expect(
      events.some((event) => event.tag === '[GCall] localJoinReannounce')
    ).toBe(true);
    expect(
      events.filter((event) => event.tag === '[GCall] bufferEnforceActive')
        .length
    ).toBe(899);
  });

  it('throttles metrics pushes', () => {
    gcallDiagnosticsPushMetricsThrottled({ a: 1 });
    gcallDiagnosticsPushMetricsThrottled({ a: 2 });
    const tags = gcallDiagnosticsGetEvents().map((e) => e.tag);
    expect(tags.filter((t) => t === '[GCall] metrics').length).toBe(1);
  });

  it('export JSON includes schema and redacts addresses in events', () => {
    gcallDiagnosticsPush('warn', '[GCall] forwarder gate suppressed source', {
      sourceAddr: 'QcrJnvVB2Tr47QyD7FNm9PDJDWqWy7Prc3',
      anyVad: false,
    });
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: 'room-x',
        chatId: 'chat-y',
        roomState: 'connected',
        myAddressTruncated: 'QcrJnv…Prc3',
      },
      liveMetricsSnapshot: { packetsReceived: 1 },
      exportWindowMetrics: { durationMs: 1000 },
      gcallPerfSnapshot: { series: { tickTotalMs: { count: 1 } } },
    });
    const parsed = JSON.parse(json) as {
      schemaVersion: number;
      gcallPerfSnapshot?: { series: { tickTotalMs: { count: number } } };
      events: { payload: { sourceAddr: string } }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.gcallPerfSnapshot?.series?.tickTotalMs?.count).toBe(1);
    expect(parsed.events[0].payload.sourceAddr).toBe('QcrJnv…Prc3');
  });

  it('export JSON includes audio-surface runtime diagnostics when provided', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: 'room-x',
        chatId: 'chat-y',
        roomState: 'connected',
        myAddressTruncated: 'QcrJnv…Prc3',
      },
      liveMetricsSnapshot: { packetsReceived: 1 },
      exportWindowMetrics: { durationMs: 1000 },
      audioSurfaceRuntimeDiagnostics: {
        pipelineMode: {
          crossOriginIsolated: true,
          sharedArrayBufferDefined: true,
        },
        recentEvents: [
          {
            t: 1,
            tag: 'room-key-applied',
            payload: {
              fromAddress: 'QcrJnvVB2Tr47QyD7FNm9PDJDWqWy7Prc3',
            },
          },
        ],
      },
    });
    const parsed = JSON.parse(json) as {
      audioSurfaceRuntimeDiagnostics?: {
        pipelineMode: { crossOriginIsolated: boolean; sharedArrayBufferDefined: boolean };
        recentEvents: Array<{ payload: { fromAddress: string } }>;
      };
    };
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.pipelineMode.crossOriginIsolated
    ).toBe(true);
    expect(
      parsed.audioSurfaceRuntimeDiagnostics?.recentEvents[0]?.payload?.fromAddress
    ).toBe('QcrJnv…Prc3');
  });

  it('export JSON includes recent window trends when provided', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: 'room-x',
        chatId: 'chat-y',
        roomState: 'connected',
        myAddressTruncated: 'QcrJnv…Prc3',
      },
      liveMetricsSnapshot: { packetsReceived: 1 },
      exportWindowMetrics: { durationMs: 1000 },
      recentWindowTrends: [
        {
          atMs: 123,
          adaptiveNetworkMode: 'recovery',
          pathQualityScoreV1: 0.72,
          packetsDroppedDecodeFailure: 2,
        },
      ],
    });
    const parsed = JSON.parse(json) as {
      recentWindowTrends?: Array<{
        atMs: number;
        adaptiveNetworkMode: string;
        pathQualityScoreV1: number;
        packetsDroppedDecodeFailure: number;
      }>;
    };
    expect(parsed.recentWindowTrends).toEqual([
      {
        atMs: 123,
        adaptiveNetworkMode: 'recovery',
        pathQualityScoreV1: 0.72,
        packetsDroppedDecodeFailure: 2,
      },
    ]);
  });

  it('export JSON includes transport triad interpretation and snapshot when live metrics have fields', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: null,
        chatId: null,
        roomState: null,
        myAddressTruncated: null,
      },
      liveMetricsSnapshot: { packetsReceived: 1 },
      exportWindowMetrics: {},
    });
    const parsed = JSON.parse(json) as {
      transportTriadInterpretation: string;
      transportTriadSnapshot: unknown;
    };
    expect(parsed.transportTriadInterpretation).toBe(
      GCALL_TRANSPORT_TRIAD_INTERPRETATION
    );
    expect(parsed.transportTriadSnapshot).toBeNull();

    const json2 = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: null,
        chatId: null,
        roomState: null,
        myAddressTruncated: null,
      },
      liveMetricsSnapshot: {
        reticulumAudioBridgeWaitingForDrain: false,
        reticulumAudioBridgeQueuedFramesHighWater: 3,
        reticulumAudioBinaryOutQueueDepthHighWater: 2,
      },
      exportWindowMetrics: {},
    });
    const parsed2 = JSON.parse(json2) as {
      transportTriadSnapshot: {
        reticulumAudioBridgeWaitingForDrain: boolean;
        reticulumAudioBridgeQueuedFramesHighWater: number;
        reticulumAudioBinaryOutQueueDepthHighWater: number;
      };
    };
    expect(parsed2.transportTriadSnapshot).toEqual({
      reticulumAudioBridgeWaitingForDrain: false,
      reticulumAudioBridgeQueuedFramesHighWater: 3,
      reticulumAudioBinaryOutQueueDepthHighWater: 2,
    });
  });

  it('export JSON includes 2-way decrypt verification hint', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: null,
        chatId: null,
        roomState: null,
        myAddressTruncated: null,
      },
      liveMetricsSnapshot: {},
      exportWindowMetrics: {},
    });
    const parsed = JSON.parse(json) as { twoWayDecryptVerificationHint: string };
    expect(parsed.twoWayDecryptVerificationHint).toBe(
      GCALL_TWO_WAY_DECRYPT_VERIFICATION_HINT
    );
  });

  it('export JSON includes 2-way jitter baseline hint', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: null,
        chatId: null,
        roomState: null,
        myAddressTruncated: null,
      },
      liveMetricsSnapshot: {},
      exportWindowMetrics: {},
    });
    const parsed = JSON.parse(json) as { twoWayJitterVerificationHint: string };
    expect(parsed.twoWayJitterVerificationHint).toBe(
      GCALL_TWO_WAY_JITTER_BASELINE_HINT
    );
  });

  it('export JSON includes remediation protocol hints (phases 0, 2, 5)', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: null,
        chatId: null,
        roomState: null,
        myAddressTruncated: null,
      },
      liveMetricsSnapshot: {},
      exportWindowMetrics: {},
    });
    const parsed = JSON.parse(json) as {
      phase0ClassificationHint: string;
      phase2PendingDecryptWindowHint: string;
      phase5PairedVerificationHint: string;
    };
    expect(parsed.phase0ClassificationHint).toBe(GCALL_PHASE0_CLASSIFICATION_HINT);
    expect(parsed.phase2PendingDecryptWindowHint).toBe(
      GCALL_PHASE2_PENDING_DECRYPT_WINDOW_HINT
    );
    expect(parsed.phase5PairedVerificationHint).toBe(
      GCALL_PHASE5_PAIRED_VERIFICATION_HINT
    );
  });

  it('export JSON includes v2 diagnostics summary for v2-managed peers', () => {
    const json = buildGcallDiagnosticsExportJson({
      context: {
        buildMode: 'test',
        appVersionLabel: '0.0.0',
        userAgent: 'vitest',
        roomId: null,
        chatId: null,
        roomState: null,
        myAddressTruncated: null,
      },
      liveMetricsSnapshot: {},
      exportWindowMetrics: {},
      v2ManagedSourceAddrs: ['QcrJnvVB2Tr47QyD7FNm9PDJDWqWy7Prc3'],
      v2DiagnosticEvents: [
        {
          schemaVersion: 2,
          kind: 'state-transition',
          wallClockMs: 1,
          payload: {
            fromState: 'coldStart',
            toState: 'steady',
            reason: 'test',
            atMs: 1,
            streamKey: 'peer-A:0:1',
            policyOutput: { maxDecodePerTick: 3, targetBufferMs: 120 },
          },
        },
        {
          schemaVersion: 2,
          kind: 'jitter-stats',
          wallClockMs: 2,
          payload: {
            streamKey: 'peer-A:0:1',
            depth: 5,
            bufferedMs: 140,
            lastPushAgeMs: 20,
            state: 'steady',
          },
        },
      ],
    });
    const parsed = JSON.parse(json) as {
      v2Diagnostics?: {
        legacyWindowOpusMetricsMeaningful: boolean;
        avgJitterBufferedMs: number;
        stateTransitionCounts: Record<string, number>;
        v2ManagedSourceAddrs: string[];
      };
    };
    expect(parsed.v2Diagnostics?.legacyWindowOpusMetricsMeaningful).toBe(false);
    expect(parsed.v2Diagnostics?.avgJitterBufferedMs).toBe(140);
    expect(parsed.v2Diagnostics?.stateTransitionCounts.steady).toBe(1);
    expect(parsed.v2Diagnostics?.v2ManagedSourceAddrs[0]).toBe('QcrJnv…Prc3');
  });

  it('extractTransportTriadFromLiveMetrics pulls bridge triad fields', () => {
    expect(
      extractTransportTriadFromLiveMetrics({
        reticulumAudioBridgeWaitingForDrain: true,
        reticulumAudioBridgeQueuedFramesHighWater: 12,
        reticulumAudioBinaryOutQueueDepthHighWater: 7,
      })
    ).toEqual({
      reticulumAudioBridgeWaitingForDrain: true,
      reticulumAudioBridgeQueuedFramesHighWater: 12,
      reticulumAudioBinaryOutQueueDepthHighWater: 7,
    });
  });
});
