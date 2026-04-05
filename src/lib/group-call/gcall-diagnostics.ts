/**
 * In-memory ring buffer for group-call diagnostics + redacted JSON export.
 * Used by useGroupVoiceCall (ingest) and export UI / window.__qortalGCallExportDiagnostics.
 */

export type GcallDiagLevel = 'log' | 'warn' | 'info';

export interface GcallDiagEvent {
  t: number;
  level: GcallDiagLevel;
  tag: string;
  payload: unknown;
}

export interface GcallDiagExportContext {
  buildMode: string;
  appVersionLabel: string;
  userAgent: string;
  platform?: string;
  roomId: string | null;
  chatId: string | null;
  roomState: string | null;
  /** Truncated local address (PII-friendly). */
  myAddressTruncated: string | null;
}

export interface GcallDiagExportPayload {
  schemaVersion: 1;
  exportedAtMs: number;
  context: GcallDiagExportContext;
  /** Latest metrics snapshot at export (session totals + transport hints). */
  liveMetricsSnapshot: unknown;
  /** Last closed window from manual capture during export (may be empty if none). */
  exportWindowMetrics: unknown;
  /**
   * Renderer GcallPerfCollector snapshot (tick durations, counters, long tasks, tick-budget breach stats).
   * Present when group-call perf is enabled (default on).
   */
  gcallPerfSnapshot?: unknown;
  events: GcallDiagEvent[];
  webrtcStats?: Record<string, unknown>;
}

const MAX_EVENTS = 900;
const METRICS_THROTTLE_MS = 8000;

const events: GcallDiagEvent[] = [];
let lastMetricsPushAt = 0;

/** Qortal-style base58 addresses are typically 30+ chars. */
const BASE58_LIKE = /^[1-9A-HJ-NP-Za-km-z]{28,80}$/;

export function truncateGcallDiagAddress(addr: string): string {
  if (!addr || addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 24) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (BASE58_LIKE.test(value)) return truncateGcallDiagAddress(value);
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const cap = value.length > 400 ? 400 : value.length;
    const out: unknown[] = [];
    for (let i = 0; i < cap; i++) out.push(redactDeep(value[i], depth + 1));
    if (value.length > cap) out.push(`[truncated ${value.length - cap} items]`);
    return out;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(o);
    const keyCap = keys.length > 200 ? 200 : keys.length;
    for (let i = 0; i < keyCap; i++) {
      const k = keys[i]!;
      out[k] = redactDeep(o[k], depth + 1);
    }
    if (keys.length > keyCap) {
      out._truncatedKeys = keys.length - keyCap;
    }
    return out;
  }
  return String(value);
}

function safeClonePayload(payload: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(payload, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      )
    );
  } catch {
    try {
      return redactDeep(payload);
    } catch {
      return { _unserializable: String(payload) };
    }
  }
}

export function gcallDiagnosticsPush(
  level: GcallDiagLevel,
  tag: string,
  payload: unknown
): void {
  events.push({
    t: Date.now(),
    level,
    tag,
    payload: safeClonePayload(payload),
  });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

/**
 * Throttled ingest for high-frequency `[GCall] metrics` snapshots.
 */
export function gcallDiagnosticsPushMetricsThrottled(payload: unknown): void {
  const now = Date.now();
  if (now - lastMetricsPushAt < METRICS_THROTTLE_MS) return;
  lastMetricsPushAt = now;
  gcallDiagnosticsPush('log', '[GCall] metrics', payload);
}

export function gcallDiagnosticsClear(): void {
  events.length = 0;
  lastMetricsPushAt = 0;
}

export function gcallDiagnosticsGetEvents(): readonly GcallDiagEvent[] {
  return events;
}

export function gcallDiagnosticsIngestConsoleArgs(
  level: GcallDiagLevel,
  args: unknown[]
): void {
  const head = args[0];
  if (typeof head !== 'string' || !head.startsWith('[GCall]')) return;

  if (head === '[GCall] metrics' || head.startsWith('[GCall] metrics')) {
    const payload = args.length >= 2 ? args[1] : {};
    gcallDiagnosticsPushMetricsThrottled(payload);
    return;
  }

  const tag = head;
  let payload: unknown;
  if (args.length === 1) payload = {};
  else if (args.length === 2) payload = args[1];
  else payload = { parts: args.slice(1) };

  gcallDiagnosticsPush(level, tag, payload);
}

export async function gcallDiagnosticsCollectRtcStats(
  peerEntries: Iterable<readonly [string, { pc: RTCPeerConnection }]>
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [addr, entry] of peerEntries) {
    const key = truncateGcallDiagAddress(addr);
    try {
      const report = await entry.pc.getStats();
      const rows: unknown[] = [];
      report.forEach((r) => {
        try {
          rows.push(JSON.parse(JSON.stringify(r)));
        } catch {
          rows.push({ type: (r as { type?: string }).type, id: (r as { id?: string }).id });
        }
      });
      out[key] = rows;
    } catch (e) {
      out[key] = { error: String(e) };
    }
  }
  return out;
}

export function buildGcallDiagnosticsExportJson(params: {
  context: GcallDiagExportContext;
  liveMetricsSnapshot: unknown;
  exportWindowMetrics: unknown;
  gcallPerfSnapshot?: unknown;
  webrtcStats?: Record<string, unknown>;
}): string {
  const payload: GcallDiagExportPayload = {
    schemaVersion: 1,
    exportedAtMs: Date.now(),
    context: { ...params.context },
    liveMetricsSnapshot: redactDeep(params.liveMetricsSnapshot),
    exportWindowMetrics: redactDeep(params.exportWindowMetrics),
    gcallPerfSnapshot:
      params.gcallPerfSnapshot !== undefined
        ? redactDeep(params.gcallPerfSnapshot)
        : undefined,
    events: events.map((e) => ({
      ...e,
      payload: redactDeep(e.payload),
    })),
    webrtcStats: params.webrtcStats
      ? (redactDeep(params.webrtcStats) as Record<string, unknown>)
      : undefined,
  };
  return JSON.stringify(payload, null, 2);
}

type GcallElectronFile = {
  startStreamSave: (options: {
    filename: string;
    mimeType?: string;
  }) => Promise<{ canceled?: boolean; filePath?: string }>;
  writeChunk: (
    filePath: string,
    chunk: Uint8Array,
    append: boolean
  ) => Promise<void>;
};

function getGcallElectronFileApi(): GcallElectronFile | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as typeof window & { electron?: GcallElectronFile };
  return w.electron?.startStreamSave ? w.electron : undefined;
}

/**
 * Save diagnostics JSON via Electron native save dialog when available; otherwise
 * File System Access `showSaveFilePicker`, then anchor download fallback.
 */
export async function downloadGcallDiagnosticsJson(
  json: string,
  filename = `qortal-gcall-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
): Promise<void> {
  const electron = getGcallElectronFileApi();
  if (electron) {
    const saveResult = await electron.startStreamSave({
      filename,
      mimeType: 'application/json',
    });
    if (saveResult?.canceled || !saveResult?.filePath) return;
    const encoder = new TextEncoder();
    await electron.writeChunk(saveResult.filePath, encoder.encode(json), false);
    return;
  }

  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (
        window as unknown as {
          showSaveFilePicker: (opts: {
            suggestedName: string;
            types: {
              description: string;
              accept: Record<string, string[]>;
            }[];
          }) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'JSON',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err: unknown) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as Error).name) : '';
      if (name === 'AbortError') return;
    }
  }

  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyGcallDiagnosticsToClipboard(json: string): Promise<void> {
  await navigator.clipboard.writeText(json);
}
