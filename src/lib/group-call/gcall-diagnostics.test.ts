import { describe, expect, it, beforeEach } from 'vitest';
import {
  gcallDiagnosticsClear,
  gcallDiagnosticsGetEvents,
  gcallDiagnosticsPush,
  gcallDiagnosticsPushMetricsThrottled,
  truncateGcallDiagAddress,
  buildGcallDiagnosticsExportJson,
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
    });
    const parsed = JSON.parse(json) as {
      schemaVersion: number;
      events: { payload: { sourceAddr: string } }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.events[0].payload.sourceAddr).toBe('QcrJnv…Prc3');
  });
});
