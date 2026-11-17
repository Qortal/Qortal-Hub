/**
 * Group Call V2 Architecture — Core Contracts
 *
 * This file defines the canonical interfaces, stream identity model, and
 * session/controller boundaries for the greenfield group-call replacement.
 *
 * Design goals (from the architecture plan):
 *  - Separate transport/signaling decisions from real-time media execution.
 *  - Replace sticky degraded latches with TTL-expiring transport evidence.
 *  - Route media by logical stream identity, not ingress peer or call-shape heuristics.
 *  - Explicit FSM states for every playout lifecycle phase.
 *  - One canonical production pipeline; no permanent compatibility layer.
 *
 * Breaking-change policy: nothing here is constrained by backward compatibility
 * with v1 wire format, IPC contracts, or existing heuristics.
 */

// ---------------------------------------------------------------------------
// Stream Identity
// ---------------------------------------------------------------------------

/**
 * A fully-qualified audio stream. Every buffer, jitter slot, and PCM ring in
 * the data plane is keyed by this, NOT by ingress peer address.
 *
 * Motivation: In the legacy architecture, stream state (watermarks, jitter
 * buffers, PCM rings) is keyed by `ingressPeerAddress`. When a peer rejoins,
 * changes forwarder, or resets its encoder, the seq numbering restarts but the
 * old state is not cleared, causing silent muting or stale-frame artifacts.
 * A stream identity is explicitly versioned; any state machine transition that
 * resets the encoder MUST advance `streamEpoch`.
 */
export interface StreamIdentity {
  /** Qortal address of the audio source (the peer whose microphone this is). */
  sourceAddr: string;
  /**
   * Monotonically increasing epoch. Incremented on every rejoin, key rotation,
   * encoder restart, or any event that resets the seq number space. The control
   * plane is the sole authority for advancing this.
   */
  streamEpoch: number;
  /**
   * Join generation from the topology layer. Collapses stream state when the
   * same peer rejoins with a new generation (topology restart, app restart).
   */
  joinGeneration: number;
}

export function streamKey(id: StreamIdentity): string {
  return `${id.sourceAddr}:${id.streamEpoch}:${id.joinGeneration}`;
}

export function streamsEqual(a: StreamIdentity, b: StreamIdentity): boolean {
  return (
    a.sourceAddr === b.sourceAddr &&
    a.streamEpoch === b.streamEpoch &&
    a.joinGeneration === b.joinGeneration
  );
}

// ---------------------------------------------------------------------------
// Transport Health Evidence
// ---------------------------------------------------------------------------

/**
 * A single piece of transport health evidence emitted by the control plane.
 * Evidence is TTL-scoped: when `expiresAtMs` passes without renewal, the
 * receiver-side policy engine MUST treat the transport as healthy.
 *
 * This replaces the legacy "sticky degraded latch" (`acceptOnlyRecoveryPath`,
 * `recoveryCooldownMs`, `n1SeverePlayoutPathWarm` holding open indefinitely).
 */
export interface TransportEvidence {
  readonly kind:
    | 'path-timeout'
    | 'bridge-pressure'
    | 'path-warming'
    | 'packet-loss'
    | 'path-recovered'
    | 'transport-healthy';
  /** When this evidence expires unless renewed. */
  readonly expiresAtMs: number;
  readonly sourceAddr: string;
  readonly observedAtMs: number;
  /** Optional magnitude (loss fraction, queue depth, etc.). */
  readonly magnitude?: number;
}

/**
 * Severity level for peer health, derived from the active evidence set.
 * The policy engine consults this rather than individual evidence entries.
 */
export type PeerHealthLevel = 'healthy' | 'degraded' | 'recovering' | 'unknown';

// ---------------------------------------------------------------------------
// Control Plane API (narrow renderer-facing surface)
// ---------------------------------------------------------------------------

/**
 * What the renderer needs from the session controller — a narrow, expiring
 * health stream, not raw transport internals.
 */
export interface PeerHealthSnapshot {
  readonly sourceAddr: string;
  readonly level: PeerHealthLevel;
  readonly evidenceExpiresAtMs: number;
  readonly observedAtMs: number;
  /**
   * True when the control plane has fresh local proof that packets from this
   * source are arriving — i.e. evidence of degradation has expired OR new
   * in-flight packet data contradicts it. When true, the policy engine MUST
   * not stay in `transportDegraded` state.
   */
  readonly freshLocalMediaConfirmed: boolean;
}

export type PeerHealthChangeListener = (snapshot: PeerHealthSnapshot) => void;

/**
 * The narrow renderer-facing API of the ReticulumSessionController.
 *
 * The renderer consumes health updates and emits send-pressure commands; it
 * does NOT read bridge queue state, routeKey, or any other transport internal.
 */
export interface IReticulumSessionController {
  /** Subscribe to peer health changes. Returns an unsubscribe function. */
  onPeerHealthChange(listener: PeerHealthChangeListener): () => void;

  /** Current health snapshot for a peer. Returns null if peer unknown. */
  getPeerHealth(sourceAddr: string): PeerHealthSnapshot | null;

  /** All currently known peers and their health. */
  getAllPeerHealth(): Map<string, PeerHealthSnapshot>;

  /**
   * Called by SendPressureController when local send rate should be capped.
   * The session controller routes this to the appropriate transport layer.
   */
  requestSendPressure(params: SendPressureRequest): void;

  /**
   * Renderer notifies the controller that a stream arrived with a given identity.
   * Used to advance `freshLocalMediaConfirmed` and expire transport-degraded evidence.
   */
  onStreamPacketReceived(id: StreamIdentity, seqNumber: number): void;

  /** Tear down all resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Data Plane Interfaces
// ---------------------------------------------------------------------------

/**
 * An encrypted, undecoded audio frame as it arrives from the transport layer.
 * The ReceiveEngine receives these and hands them to the DecodeService.
 */
export interface EncryptedIngressFrame {
  readonly streamId: StreamIdentity;
  readonly ingressPeerAddr: string;
  readonly encryptedPayload: Uint8Array;
  readonly receivedAtMs: number;
  /** Transport used to deliver this frame (for diagnostics). */
  readonly transport: 'packet' | 'link';
}

/**
 * A fully decoded, ready-to-play audio frame.
 */
export interface DecodedFrame {
  readonly streamId: StreamIdentity;
  readonly seq: number;
  readonly pcmSamples: Float32Array;
  readonly durationMs: number;
  readonly vad: boolean;
  readonly decodedAtMs: number;
}

/**
 * What the ReceiveEngine exposes to the playout worklet.
 */
export interface IPcmRing {
  /** Read up to `maxSamples` into `out`. Returns number of samples written. */
  read(out: Float32Array, maxSamples: number): number;
  /** Buffered duration in milliseconds. */
  bufferedMs(): number;
  /** True when at least one full frame is available. */
  hasData(): boolean;
  /** Clear all buffered PCM and reset watermarks. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Policy Plane — Explicit FSM States
// ---------------------------------------------------------------------------

/**
 * Per-stream receive policy states. Each state has well-defined entry/exit
 * conditions. There is NO implicit "recovery" latch — every degraded state
 * carries its own TTL and reverts to a healthier state when evidence expires.
 *
 * This replaces: `adaptiveNetworkMode`, `N1PlayoutGate` tier logic,
 * `severeForcedReleaseRebuildActive`, and all their associated heuristics.
 */
export type ReceiveState =
  /** Stream just opened; waiting for initial frame burst to fill jitter buffer. */
  | 'coldStart'
  /** Buffer is healthy and at target depth. Normal decode cap in effect. */
  | 'steady'
  /**
   * Transport evidence indicates path degradation. Extra jitter headroom applied.
   * Transitions to `backlogDrain` when freshLocalMediaConfirmed && evidence TTL expired.
   * THIS STATE HAS A TTL — it cannot persist indefinitely.
   */
  | 'transportDegraded'
  /**
   * Jitter buffer has accumulated a backlog (avgOpusBufferedMs > target * 1.0).
   * Drain at increased decode rate to catch up, without waiting for a PCM threshold.
   * Replaces the stuck `severeForcedReleaseRebuildActive` loop.
   */
  | 'backlogDrain'
  /**
   * Packet loss detected (gap in seq numbers). FEC/PLC recovery in progress.
   * Short-lived; exits when gap is filled or PLC is applied.
   */
  | 'lossRecovery'
  /**
   * No packets received for > `missingMediaThresholdMs`. Stream may be paused or gone.
   * Buffer is held to avoid underrun noise on return.
   */
  | 'missingMedia';

export interface ReceiveStateTransition {
  readonly fromState: ReceiveState;
  readonly toState: ReceiveState;
  readonly reason: string;
  readonly atMs: number;
  readonly streamKey: string;
}

/**
 * Per-stream policy output consumed by the ReceiveEngine's drain tick.
 */
export interface ReceivePolicyOutput {
  readonly state: ReceiveState;
  /** Max Opus frames to decode per 20ms tick. */
  readonly maxDecodePerTick: number;
  /**
   * Target PCM buffer depth in ms. The drain tick should try to keep
   * `pcmRing.bufferedMs()` near this value.
   */
  readonly targetBufferMs: number;
  /**
   * When true, do NOT drain the jitter buffer regardless of PCM level.
   * Only valid in `coldStart` or `missingMedia`.
   */
  readonly holdPlayout: boolean;
  /**
   * When true, the drain tick should prefer decoding at maximum rate to fill PCM.
   * Valid in `backlogDrain` and during recovery after `transportDegraded` exit.
   */
  readonly aggressiveDrain: boolean;
  /** Whether concealment/PLC should be applied for missing frames. */
  readonly enableConcealment: boolean;
}

// ---------------------------------------------------------------------------
// Send Pressure API
// ---------------------------------------------------------------------------

export interface SendPressureRequest {
  /** Opus encoding bitrate cap in bps. null = remove cap. */
  bitrateCapBps: number | null;
  /**
   * When true, request the ingress pacing mode on the transport layer.
   * Unrelated to local playout recovery — this is purely about outbound relief.
   */
  ingressPacing: boolean;
  readonly requestedAtMs: number;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/**
 * Diagnostics recorder interface. All components that emit diagnostics accept
 * this interface so the recorder can be swapped for a null implementation in
 * tests and for a replay-capturing recorder in the validation platform.
 */
export interface IDiagnosticsRecorder {
  recordStateTransition(
    transition: ReceiveStateTransition,
    policyOutput?: Pick<ReceivePolicyOutput, 'maxDecodePerTick' | 'targetBufferMs'>
  ): void;
  recordTransportEvidence(evidence: TransportEvidence): void;
  recordPeerHealth(
    snapshot: PeerHealthSnapshot,
    activeEvidenceCount?: number
  ): void;
  recordSendPressure(req: SendPressureRequest): void;
  recordDecodeResult(info: DecodeResultInfo): void;
  recordJitterStats(stats: JitterStats): void;
  recordPcmRingStats(stats: PcmRingStats): void;
}

export interface DecodeResultInfo {
  readonly streamKey: string;
  readonly seq: number;
  readonly durationMs: number;
  readonly decodeLatencyMs: number;
  readonly usedFec: boolean;
  readonly usedPlc: boolean;
  readonly decodedAtMs: number;
}

export interface JitterStats {
  readonly streamKey: string;
  readonly depth: number;
  readonly bufferedMs: number;
  readonly lastPushAgeMs: number;
  readonly atMs: number;
  readonly state: ReceiveState;
}

export interface PcmRingStats {
  readonly streamKey: string;
  readonly bufferedMs: number;
  readonly oldestFrameAgeMs: number;
  readonly staleDrops: number;
  readonly underruns: number;
  readonly atMs: number;
  readonly state: ReceiveState;
}

// ---------------------------------------------------------------------------
// Session Lifecycle
// ---------------------------------------------------------------------------

/**
 * Describes one participant's join/leave/rejoin lifecycle as observed by the
 * session controller. The control plane is the sole authority for constructing
 * StreamIdentity values and advancing streamEpoch.
 */
export interface ParticipantLifecycleEvent {
  readonly kind: 'joined' | 'left' | 'rejoined' | 'epoch-advanced';
  readonly sourceAddr: string;
  readonly streamId: StreamIdentity;
  readonly atMs: number;
  readonly reason?: string;
}

export type ParticipantLifecycleListener = (
  event: ParticipantLifecycleEvent
) => void;
