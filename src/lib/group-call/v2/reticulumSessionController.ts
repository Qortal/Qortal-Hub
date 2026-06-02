/**
 * Group Call V2 — ReticulumSessionController
 *
 * The single authority for topology, path health, fallback, warmup, and
 * recovery decisions. Exposes a narrow, expiring peer-health stream to the
 * renderer; the renderer NEVER reads bridge queue state, routeKey, or any
 * other transport internal directly.
 *
 * Replaces the fragmented logic currently spread across:
 *  - `group-call.ts` (path warm, topology signals, recovery requests)
 *  - `reticulum-bridge.ts` (queue depth monitoring)
 *  - `reticulum-audio-link-fallback-policy.ts` (fallback decisions)
 *  - `useGroupVoiceCall.ts` (transport hints → playout heuristics)
 *
 * Key invariants:
 *  1. All transport evidence is TTL-scoped. No sticky latches.
 *  2. Stream packet arrivals ALWAYS contradict degradation evidence.
 *  3. Topology events advance StreamIdentity epochs; old state is cleared.
 *  4. Send pressure is routed here but NEVER feeds back into local playout.
 */

import type {
  IReticulumSessionController,
  PeerHealthChangeListener,
  PeerHealthSnapshot,
  SendPressureRequest,
  StreamIdentity,
  ParticipantLifecycleEvent,
  ParticipantLifecycleListener,
  TransportEvidence,
} from './spec';
import {
  PeerHealthStream,
  EVIDENCE_TTL_BRIDGE_PRESSURE_MS,
  EVIDENCE_TTL_PATH_TIMEOUT_MS,
  EVIDENCE_TTL_PATH_WARMING_MS,
} from './peerHealthStream';
import type { IDiagnosticsRecorder } from './spec';
import { NullDiagnosticsRecorder } from './diagnosticsContract';

// ---------------------------------------------------------------------------
// Topology event types (mirror what group-call.ts emits today)
// ---------------------------------------------------------------------------

export interface TopologyEvent {
  readonly kind:
    | 'peer-joined'
    | 'peer-left'
    | 'peer-rejoined'
    | 'topology-root-change'
    | 'global-recovery-started'
    | 'path-resolution-timeout'
    | 'path-resolution-ok'
    | 'bridge-pressure-spike'
    | 'bridge-pressure-clear';
  readonly sourceAddr?: string;
  readonly joinGeneration?: number;
  readonly detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ReticulumSessionController
// ---------------------------------------------------------------------------

export class ReticulumSessionController implements IReticulumSessionController {
  private readonly _healthStream: PeerHealthStream;
  private readonly _streamEpochs = new Map<string, number>();
  private readonly _joinGenerations = new Map<string, number>();
  private readonly _lifecycleListeners = new Set<ParticipantLifecycleListener>();
  private readonly _diag: IDiagnosticsRecorder;
  private readonly _clockMs: () => number;

  constructor(
    opts: {
      diagnostics?: IDiagnosticsRecorder;
      clockMs?: () => number;
    } = {}
  ) {
    this._diag = opts.diagnostics ?? new NullDiagnosticsRecorder();
    this._clockMs = opts.clockMs ?? (() => performance.now());
    this._healthStream = new PeerHealthStream(this._clockMs);
    this._healthStream.onPeerHealthChange((snapshot) => {
      this._diag.recordPeerHealth(
        snapshot,
        this._healthStream.getActiveEvidenceCount(snapshot.sourceAddr)
      );
    });
  }

  // -------------------------------------------------------------------------
  // IReticulumSessionController
  // -------------------------------------------------------------------------

  onPeerHealthChange(listener: PeerHealthChangeListener): () => void {
    return this._healthStream.onPeerHealthChange(listener);
  }

  getPeerHealth(sourceAddr: string): PeerHealthSnapshot | null {
    return this._healthStream.getPeerHealth(sourceAddr);
  }

  getAllPeerHealth(): Map<string, PeerHealthSnapshot> {
    return this._healthStream.getAllPeerHealth();
  }

  requestSendPressure(params: SendPressureRequest): void {
    this._diag.recordSendPressure(params);
    // TODO: route to transport layer (IPC to main process → Reticulum)
    // In the cutover, this will call into the reticulum-audio-ipc module
    // with a send-pressure command, completely decoupled from playout state.
  }

  onStreamPacketReceived(id: StreamIdentity, seqNumber: number): void {
    // Packets arriving = transport is working. Expire degradation evidence.
    this._healthStream.onStreamPacketReceived(id, seqNumber);
  }

  dispose(): void {
    this._healthStream.dispose();
    this._lifecycleListeners.clear();
  }

  // -------------------------------------------------------------------------
  // Participant lifecycle (called by the transport/topology layer)
  // -------------------------------------------------------------------------

  /**
   * Ingest a topology event from the main process (e.g. forwarded via IPC from
   * group-call.ts). This is the sole entry point for topology-driven state changes.
   */
  ingestTopologyEvent(event: TopologyEvent): void {
    const nowMs = this._clockMs();

    switch (event.kind) {
      case 'peer-joined':
      case 'peer-rejoined': {
        const addr = event.sourceAddr;
        if (!addr) break;

        const prevEpoch = this._streamEpochs.get(addr) ?? 0;
        const prevGen = this._joinGenerations.get(addr) ?? 0;
        const newGen = event.joinGeneration ?? prevGen;
        const newEpoch =
          event.kind === 'peer-rejoined' || newGen !== prevGen
            ? prevEpoch + 1
            : prevEpoch;

        this._streamEpochs.set(addr, newEpoch);
        this._joinGenerations.set(addr, newGen);

        const streamId: StreamIdentity = {
          sourceAddr: addr,
          streamEpoch: newEpoch,
          joinGeneration: newGen,
        };

        // A fresh join gets path-warming evidence (short-lived).
        this._healthStream.ingestEvidence({
          kind: 'path-warming',
          sourceAddr: addr,
          observedAtMs: nowMs,
          expiresAtMs: nowMs + EVIDENCE_TTL_PATH_WARMING_MS,
        });

        const lifecycleEvent: ParticipantLifecycleEvent = {
          kind: event.kind === 'peer-rejoined' ? 'rejoined' : 'joined',
          sourceAddr: addr,
          streamId,
          atMs: nowMs,
          reason: event.kind,
        };
        this._emitLifecycle(lifecycleEvent);
        break;
      }

      case 'peer-left': {
        const addr = event.sourceAddr;
        if (!addr) break;
        const epoch = this._streamEpochs.get(addr) ?? 0;
        const gen = this._joinGenerations.get(addr) ?? 0;
        this._emitLifecycle({
          kind: 'left',
          sourceAddr: addr,
          streamId: { sourceAddr: addr, streamEpoch: epoch, joinGeneration: gen },
          atMs: nowMs,
        });
        break;
      }

      case 'path-resolution-timeout': {
        const addr = event.sourceAddr ?? '';
        if (!addr) break;
        this._healthStream.ingestEvidence({
          kind: 'path-timeout',
          sourceAddr: addr,
          observedAtMs: nowMs,
          expiresAtMs: nowMs + EVIDENCE_TTL_PATH_TIMEOUT_MS,
          magnitude: 1,
        });
        break;
      }

      case 'path-resolution-ok': {
        const addr = event.sourceAddr ?? '';
        if (addr) {
          this._healthStream.markHealthy(addr, 'path-resolution-ok');
        }
        break;
      }

      case 'bridge-pressure-spike': {
        const addr = event.sourceAddr ?? '';
        const depth = (event.detail?.depth as number | undefined) ?? 0;
        if (addr) {
          this._healthStream.ingestEvidence({
            kind: 'bridge-pressure',
            sourceAddr: addr,
            observedAtMs: nowMs,
            expiresAtMs: nowMs + EVIDENCE_TTL_BRIDGE_PRESSURE_MS,
            magnitude: depth,
          });
        }
        break;
      }

      case 'bridge-pressure-clear': {
        const addr = event.sourceAddr ?? '';
        if (addr) {
          this._healthStream.markHealthy(addr, 'bridge-pressure-clear');
        }
        break;
      }

      case 'global-recovery-started': {
        // Legacy: a global recovery event was fired. In v2 we issue short-TTL
        // evidence for all known peers rather than a blanket recovery flag.
        for (const [addr] of this._streamEpochs) {
          this._healthStream.ingestEvidence({
            kind: 'path-warming',
            sourceAddr: addr,
            observedAtMs: nowMs,
            expiresAtMs: nowMs + EVIDENCE_TTL_PATH_WARMING_MS,
          });
        }
        break;
      }
    }

    this._diag.recordTransportEvidence({
      kind: 'path-warming',
      sourceAddr: event.sourceAddr ?? '',
      observedAtMs: nowMs,
      expiresAtMs: nowMs + 1,
    });
  }

  /**
   * Ingest a raw transport evidence item from the main process. Called directly
   * by the bridge monitoring layer when it detects queue pressure or loss.
   */
  ingestTransportEvidence(evidence: TransportEvidence): void {
    this._healthStream.ingestEvidence(evidence);
    this._diag.recordTransportEvidence(evidence);
  }

  // -------------------------------------------------------------------------
  // Stream identity queries
  // -------------------------------------------------------------------------

  /**
   * Get the current StreamIdentity for a peer. Returns null if the peer has
   * not joined yet. The ReceiveEngine calls this to resolve ingress packets.
   */
  getStreamIdentity(sourceAddr: string): StreamIdentity | null {
    const epoch = this._streamEpochs.get(sourceAddr);
    if (epoch === undefined) return null;
    const gen = this._joinGenerations.get(sourceAddr) ?? 0;
    return { sourceAddr, streamEpoch: epoch, joinGeneration: gen };
  }

  /**
   * Advance the stream epoch for a peer (e.g. on key rotation or encoder reset).
   * The ReceiveEngine will discard all buffered state for the old epoch.
   */
  advanceStreamEpoch(sourceAddr: string, reason: string): StreamIdentity {
    const prevEpoch = this._streamEpochs.get(sourceAddr) ?? 0;
    const gen = this._joinGenerations.get(sourceAddr) ?? 0;
    const newEpoch = prevEpoch + 1;
    this._streamEpochs.set(sourceAddr, newEpoch);
    const streamId: StreamIdentity = {
      sourceAddr,
      streamEpoch: newEpoch,
      joinGeneration: gen,
    };
    this._emitLifecycle({
      kind: 'epoch-advanced',
      sourceAddr,
      streamId,
      atMs: this._clockMs(),
      reason,
    });
    return streamId;
  }

  // -------------------------------------------------------------------------
  // Lifecycle subscription
  // -------------------------------------------------------------------------

  onParticipantLifecycle(listener: ParticipantLifecycleListener): () => void {
    this._lifecycleListeners.add(listener);
    return () => this._lifecycleListeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _emitLifecycle(event: ParticipantLifecycleEvent): void {
    for (const listener of this._lifecycleListeners) {
      listener(event);
    }
  }
}
