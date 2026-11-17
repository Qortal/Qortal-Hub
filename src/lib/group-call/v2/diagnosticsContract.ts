/**
 * Group Call V2 — Diagnostics Contract
 *
 * Defines the unified diagnostics schema for the new architecture. Every
 * component — control plane, data plane, and policy plane — records events
 * against this schema, ensuring a single causal timeline across the full pipeline.
 *
 * Unlike the legacy schema which scattered metrics across multiple ad-hoc
 * event shapes, this contract:
 *  - Versions every event so schema evolution is explicit.
 *  - Tags every event with both wall clock and stream identity.
 *  - Distinguishes transport evidence (control plane), stream state (policy plane),
 *    and media metrics (data plane) as separate first-class event kinds.
 *  - Is designed for deterministic replay: every event carries enough context
 *    to reconstruct the system state at that point in time.
 */

import type {
  StreamIdentity,
  ReceiveState,
  ReceiveStateTransition,
  TransportEvidence,
  PeerHealthSnapshot,
  SendPressureRequest,
} from './spec';

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

export const GCALL_V2_DIAG_SCHEMA_VERSION = 2;

export type GcallV2EventKind =
  | 'stream-opened'
  | 'stream-closed'
  | 'stream-epoch-advanced'
  | 'state-transition'
  | 'transport-evidence'
  | 'peer-health'
  | 'send-pressure'
  | 'decode-result'
  | 'jitter-stats'
  | 'pcm-ring-stats'
  | 'ingress-packet'
  | 'concealment'
  | 'playout-tick'
  | 'control-plane-event';

export interface GcallV2DiagEvent<K extends GcallV2EventKind, P> {
  readonly schemaVersion: typeof GCALL_V2_DIAG_SCHEMA_VERSION;
  readonly kind: K;
  readonly wallClockMs: number;
  readonly payload: P;
}

// ---------------------------------------------------------------------------
// Stream lifecycle events
// ---------------------------------------------------------------------------

export type StreamOpenedEvent = GcallV2DiagEvent<
  'stream-opened',
  { streamId: StreamIdentity; reason: string }
>;

export type StreamClosedEvent = GcallV2DiagEvent<
  'stream-closed',
  { streamId: StreamIdentity; reason: string; lifetimeMs: number }
>;

export type StreamEpochAdvancedEvent = GcallV2DiagEvent<
  'stream-epoch-advanced',
  {
    sourceAddr: string;
    prevEpoch: number;
    newEpoch: number;
    joinGeneration: number;
    reason: string;
  }
>;

// ---------------------------------------------------------------------------
// Policy plane events
// ---------------------------------------------------------------------------

export type StateTransitionEvent = GcallV2DiagEvent<
  'state-transition',
  ReceiveStateTransition & { policyOutput: { maxDecodePerTick: number; targetBufferMs: number } }
>;

// ---------------------------------------------------------------------------
// Control plane events
// ---------------------------------------------------------------------------

export type TransportEvidenceEvent = GcallV2DiagEvent<
  'transport-evidence',
  TransportEvidence
>;

export type PeerHealthEvent = GcallV2DiagEvent<
  'peer-health',
  PeerHealthSnapshot & { activeEvidenceCount: number }
>;

export type SendPressureEvent = GcallV2DiagEvent<
  'send-pressure',
  SendPressureRequest
>;

export type ControlPlaneEvent = GcallV2DiagEvent<
  'control-plane-event',
  { tag: string; detail: Record<string, unknown> }
>;

// ---------------------------------------------------------------------------
// Data plane events
// ---------------------------------------------------------------------------

export type IngressPacketEvent = GcallV2DiagEvent<
  'ingress-packet',
  {
    streamKey: string;
    seq: number;
    transport: 'packet' | 'link';
    receivedAtMs: number;
    encryptedBytes: number;
  }
>;

export type DecodeResultEvent = GcallV2DiagEvent<
  'decode-result',
  {
    streamKey: string;
    seq: number;
    durationMs: number;
    decodeLatencyMs: number;
    usedFec: boolean;
    usedPlc: boolean;
  }
>;

export type ConcealmentEvent = GcallV2DiagEvent<
  'concealment',
  { streamKey: string; gapFrames: number; atMs: number }
>;

export type JitterStatsEvent = GcallV2DiagEvent<
  'jitter-stats',
  {
    streamKey: string;
    depth: number;
    bufferedMs: number;
    lastPushAgeMs: number;
    state: ReceiveState;
  }
>;

export type PcmRingStatsEvent = GcallV2DiagEvent<
  'pcm-ring-stats',
  {
    streamKey: string;
    bufferedMs: number;
    oldestFrameAgeMs: number;
    staleDrops: number;
    underruns: number;
    overruns: number;
    state: ReceiveState;
  }
>;

export type PlayoutTickEvent = GcallV2DiagEvent<
  'playout-tick',
  {
    streamKey: string;
    framesDecoded: number;
    pcmBufferedMs: number;
    opusBufferedMs: number;
    tickDurationMs: number;
  }
>;

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type AnyGcallV2Event =
  | StreamOpenedEvent
  | StreamClosedEvent
  | StreamEpochAdvancedEvent
  | StateTransitionEvent
  | TransportEvidenceEvent
  | PeerHealthEvent
  | SendPressureEvent
  | ControlPlaneEvent
  | IngressPacketEvent
  | DecodeResultEvent
  | ConcealmentEvent
  | JitterStatsEvent
  | PcmRingStatsEvent
  | PlayoutTickEvent;

// ---------------------------------------------------------------------------
// Full export bundle (what gets serialized to disk / sent to the paired peer)
// ---------------------------------------------------------------------------

export interface GcallV2DiagnosticBundle {
  readonly schemaVersion: typeof GCALL_V2_DIAG_SCHEMA_VERSION;
  readonly exportedAtMs: number;
  readonly context: {
    readonly roomId: string;
    readonly myAddr: string;
    readonly role: string;
    readonly appVersion: string;
    readonly platform: string;
  };
  readonly liveMetrics: Record<string, number | string | boolean>;
  readonly events: AnyGcallV2Event[];
  /**
   * Paired peer's bundle, if available (attached by QA tooling for analysis).
   * The pairedExportAnalyzer reads both bundles to classify the call.
   */
  readonly pairedPeerBundle?: GcallV2DiagnosticBundle;
}

// ---------------------------------------------------------------------------
// Null recorder (used in tests and during replay injection)
// ---------------------------------------------------------------------------

import type { IDiagnosticsRecorder, DecodeResultInfo, JitterStats, PcmRingStats } from './spec';

export class NullDiagnosticsRecorder implements IDiagnosticsRecorder {
  recordStateTransition(
    _t: ReceiveStateTransition,
    _policyOutput?: { maxDecodePerTick: number; targetBufferMs: number }
  ): void {}
  recordTransportEvidence(_e: TransportEvidence): void {}
  recordPeerHealth(_s: PeerHealthSnapshot, _activeEvidenceCount?: number): void {}
  recordSendPressure(_r: SendPressureRequest): void {}
  recordDecodeResult(_i: DecodeResultInfo): void {}
  recordJitterStats(_s: JitterStats): void {}
  recordPcmRingStats(_s: PcmRingStats): void {}
}

// ---------------------------------------------------------------------------
// Buffering recorder (captures events for export / replay)
// ---------------------------------------------------------------------------

export class BufferingDiagnosticsRecorder implements IDiagnosticsRecorder {
  private readonly _events: AnyGcallV2Event[] = [];

  get events(): readonly AnyGcallV2Event[] {
    return this._events;
  }

  private push<K extends GcallV2EventKind, P>(
    kind: K,
    payload: P
  ): GcallV2DiagEvent<K, P> {
    const event = {
      schemaVersion: GCALL_V2_DIAG_SCHEMA_VERSION as typeof GCALL_V2_DIAG_SCHEMA_VERSION,
      kind,
      wallClockMs: performance.now(),
      payload,
    } as GcallV2DiagEvent<K, P>;
    (this._events as AnyGcallV2Event[]).push(event as unknown as AnyGcallV2Event);
    return event;
  }

  recordStateTransition(
    t: ReceiveStateTransition,
    policyOutput?: { maxDecodePerTick: number; targetBufferMs: number }
  ): void {
    this.push('state-transition', {
      ...t,
      policyOutput: {
        maxDecodePerTick: policyOutput?.maxDecodePerTick ?? 0,
        targetBufferMs: policyOutput?.targetBufferMs ?? 0,
      },
    });
  }

  recordTransportEvidence(e: TransportEvidence): void {
    this.push('transport-evidence', e);
  }

  recordPeerHealth(
    s: PeerHealthSnapshot,
    activeEvidenceCount = 0
  ): void {
    this.push('peer-health', { ...s, activeEvidenceCount });
  }

  recordSendPressure(r: SendPressureRequest): void {
    this.push('send-pressure', r);
  }

  recordDecodeResult(i: DecodeResultInfo): void {
    this.push('decode-result', {
      streamKey: i.streamKey,
      seq: i.seq,
      durationMs: i.durationMs,
      decodeLatencyMs: i.decodeLatencyMs,
      usedFec: i.usedFec,
      usedPlc: i.usedPlc,
    });
  }

  recordJitterStats(s: JitterStats): void {
    this.push('jitter-stats', {
      streamKey: s.streamKey,
      depth: s.depth,
      bufferedMs: s.bufferedMs,
      lastPushAgeMs: s.lastPushAgeMs,
      state: s.state,
    });
  }

  recordPcmRingStats(s: PcmRingStats): void {
    this.push('pcm-ring-stats', {
      streamKey: s.streamKey,
      bufferedMs: s.bufferedMs,
      oldestFrameAgeMs: s.oldestFrameAgeMs,
      staleDrops: s.staleDrops,
      underruns: s.underruns,
      overruns: 0,
      state: s.state,
    });
  }

  reset(): void {
    this._events.length = 0;
  }
}
