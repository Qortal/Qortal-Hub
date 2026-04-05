import { describe, expect, it, beforeEach } from 'vitest';
import {
  gcallDiagnosticsClear,
  gcallDiagnosticsGetEvents,
  gcallDiagnosticsPush,
  gcallDiagnosticsPushMetricsThrottled,
  truncateGcallDiagAddress,
  buildGcallDiagnosticsExportJson,
  extractTransportTriadFromLiveMetrics,
  GCALL_TRANSPORT_TRIAD_INTERPRETATION,
  GCALL_TWO_WAY_DECRYPT_VERIFICATION_HINT,
  GCALL_TWO_WAY_JITTER_BASELINE_HINT,
} from './gcall-diagnostics';

describe('gcall-diagnostics', () => {
  beforeEach(() => {
    gcallDiagnosticsClear();
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
