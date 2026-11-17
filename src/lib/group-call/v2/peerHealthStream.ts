/**
 * Group Call V2 — PeerHealthStream
 *
 * Maintains a TTL-scoped evidence set for each peer and emits health snapshots
 * when any evidence expires or new evidence arrives.
 *
 * Core design principle: evidence is ALWAYS time-bounded. When the TTL passes
 * without renewal, the system defaults to "healthy". There is NO sticky latch.
 *
 * This replaces:
 *  - `acceptOnlyRecoveryPath: true` (never expires in legacy)
 *  - `adaptiveNetworkMode = "recovery"` held by 12s `recoveryCooldownMs`
 *  - `n1SeverePlayoutPathWarm` + `peerMediaRecoveryRequested` holding open
 *
 * The stream is consumed exclusively by ReceivePolicyEngine. The renderer
 * NEVER reads bridge queue state or transport internals directly.
 */

import type {
  TransportEvidence,
  PeerHealthSnapshot,
  PeerHealthLevel,
  PeerHealthChangeListener,
  StreamIdentity,
} from './spec';

// ---------------------------------------------------------------------------
// Evidence TTLs
// ---------------------------------------------------------------------------

/** Path timeouts: short-lived — a single timeout is transient noise. */
export const EVIDENCE_TTL_PATH_TIMEOUT_MS = 4_000;

/** Bridge pressure: medium — need a few seconds to drain. */
export const EVIDENCE_TTL_BRIDGE_PRESSURE_MS = 6_000;

/** Active path warming: expires once the path is warm. */
export const EVIDENCE_TTL_PATH_WARMING_MS = 3_000;

/** Packet loss: measured over a short window. */
export const EVIDENCE_TTL_PACKET_LOSS_MS = 5_000;

/**
 * Once fresh local media is confirmed (packets arriving despite any earlier
 * transport issue), all degraded evidence is retired immediately. This is the
 * key difference from legacy: arriving packets CONTRADICT transport degradation.
 */
export const FRESH_MEDIA_EVIDENCE_OVERRIDE_MS = 200;

/**
 * Minimum interval before re-emitting "degraded" to prevent listener thrash
 * when evidence is renewed repeatedly.
 */
export const HEALTH_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Internal evidence entry
// ---------------------------------------------------------------------------

interface EvidenceEntry {
  readonly evidence: TransportEvidence;
  expiresAtMs: number;
  renewedAtMs: number;
}

// ---------------------------------------------------------------------------
// PeerHealthStream
// ---------------------------------------------------------------------------

export class PeerHealthStream {
  private readonly _evidenceByPeer = new Map<
    string,
    Map<TransportEvidence['kind'], EvidenceEntry>
  >();
  private readonly _lastEmittedHealth = new Map<string, PeerHealthLevel>();
  private readonly _lastFreshConfirmed = new Map<string, number>();
  private readonly _listeners = new Set<PeerHealthChangeListener>();
  private _gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly clockMs: () => number = () => performance.now()) {
    this._gcTimer = setInterval(() => this._pruneExpired(), 2_000);
  }

  // -------------------------------------------------------------------------
  // Public: subscribe
  // -------------------------------------------------------------------------

  onPeerHealthChange(listener: PeerHealthChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Public: ingest evidence
  // -------------------------------------------------------------------------

  /**
   * Record a new transport evidence item. If the evidence type was already
   * present for this peer, it is renewed (TTL extended). If it is new,
   * a health change event is emitted if the level changes.
   */
  ingestEvidence(evidence: TransportEvidence): void {
    const nowMs = this.clockMs();

    if (!this._evidenceByPeer.has(evidence.sourceAddr)) {
      this._evidenceByPeer.set(evidence.sourceAddr, new Map());
    }
    const map = this._evidenceByPeer.get(evidence.sourceAddr)!;

    // Use the evidence's expiresAtMs directly. The evidence object is the
    // authoritative source of TTL; the evidenceTtl() function is used by
    // callers that don't pre-compute the expiry.
    const entry: EvidenceEntry = {
      evidence,
      expiresAtMs: evidence.expiresAtMs,
      renewedAtMs: nowMs,
    };
    map.set(evidence.kind, entry);

    this._maybeEmit(evidence.sourceAddr, nowMs);
  }

  /**
   * Notify the stream that packets from a given stream are actively arriving.
   *
   * Per the architecture contract: fresh local media CONTRADICTS transport
   * degradation. All non-"path-warming" evidence for this peer is immediately
   * retired, and the peer transitions to "healthy".
   */
  onStreamPacketReceived(id: StreamIdentity, _seqNumber: number): void {
    const nowMs = this.clockMs();
    this._lastFreshConfirmed.set(id.sourceAddr, nowMs);

    const map = this._evidenceByPeer.get(id.sourceAddr);
    if (map) {
      // Retire all degradation evidence when packets are actively arriving.
      for (const [kind, entry] of map) {
        if (
          kind !== 'transport-healthy' &&
          kind !== 'path-warming'
        ) {
          // Expire it immediately so the next snapshot sees "healthy".
          entry.expiresAtMs = nowMs - 1;
        }
      }
    }

    this._maybeEmit(id.sourceAddr, nowMs);
  }

  /**
   * Forcibly record a "transport-healthy" evidence item for a peer.
   * Used by the session controller when it positively confirms health (e.g.
   * after a successful path resolution or when bridge queues drain).
   */
  markHealthy(sourceAddr: string, reason: string): void {
    const nowMs = this.clockMs();
    this.ingestEvidence({
      kind: 'transport-healthy',
      sourceAddr,
      observedAtMs: nowMs,
      expiresAtMs: nowMs + 30_000,
    });
    this._maybeEmit(sourceAddr, nowMs);
  }

  // -------------------------------------------------------------------------
  // Public: query
  // -------------------------------------------------------------------------

  getPeerHealth(sourceAddr: string): PeerHealthSnapshot | null {
    const nowMs = this.clockMs();
    const map = this._evidenceByPeer.get(sourceAddr);
    if (!map) return null;
    return this._buildSnapshot(sourceAddr, map, nowMs);
  }

  getAllPeerHealth(): Map<string, PeerHealthSnapshot> {
    const nowMs = this.clockMs();
    const result = new Map<string, PeerHealthSnapshot>();
    for (const [addr, map] of this._evidenceByPeer) {
      result.set(addr, this._buildSnapshot(addr, map, nowMs));
    }
    return result;
  }

  getActiveEvidenceCount(sourceAddr: string): number {
    const nowMs = this.clockMs();
    const map = this._evidenceByPeer.get(sourceAddr);
    if (!map) return 0;
    let count = 0;
    for (const entry of map.values()) {
      if (entry.expiresAtMs > nowMs) count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this._gcTimer !== null) {
      clearInterval(this._gcTimer);
      this._gcTimer = null;
    }
    this._listeners.clear();
    this._evidenceByPeer.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _buildSnapshot(
    sourceAddr: string,
    map: Map<TransportEvidence['kind'], EvidenceEntry>,
    nowMs: number
  ): PeerHealthSnapshot {
    const active = [...map.values()].filter((e) => e.expiresAtMs > nowMs);
    const level = computeHealthLevel(active.map((e) => e.evidence));
    const latestExpiry =
      active.length > 0
        ? Math.max(...active.map((e) => e.expiresAtMs))
        : nowMs;

    const lastFresh = this._lastFreshConfirmed.get(sourceAddr) ?? 0;
    const freshLocalMediaConfirmed =
      nowMs - lastFresh <= FRESH_MEDIA_EVIDENCE_OVERRIDE_MS * 5 ||
      active.length === 0;

    return {
      sourceAddr,
      level,
      evidenceExpiresAtMs: latestExpiry,
      observedAtMs: nowMs,
      freshLocalMediaConfirmed,
    };
  }

  private _maybeEmit(sourceAddr: string, nowMs: number): void {
    const map = this._evidenceByPeer.get(sourceAddr);
    if (!map) return;

    const snapshot = this._buildSnapshot(sourceAddr, map, nowMs);
    const prev = this._lastEmittedHealth.get(sourceAddr);

    if (prev !== snapshot.level) {
      this._lastEmittedHealth.set(sourceAddr, snapshot.level);
      for (const listener of this._listeners) {
        listener(snapshot);
      }
    }
  }

  private _pruneExpired(): void {
    const nowMs = this.clockMs();
    for (const [addr, map] of this._evidenceByPeer) {
      for (const [kind, entry] of map) {
        if (entry.expiresAtMs <= nowMs) {
          map.delete(kind);
        }
      }
      // If evidence has fully expired, check if health changed (back to healthy).
      if (map.size === 0) {
        this._maybeEmit(addr, nowMs);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function evidenceTtl(kind: TransportEvidence['kind']): number {
  switch (kind) {
    case 'path-timeout':
      return EVIDENCE_TTL_PATH_TIMEOUT_MS;
    case 'bridge-pressure':
      return EVIDENCE_TTL_BRIDGE_PRESSURE_MS;
    case 'path-warming':
      return EVIDENCE_TTL_PATH_WARMING_MS;
    case 'packet-loss':
      return EVIDENCE_TTL_PACKET_LOSS_MS;
    case 'path-recovered':
    case 'transport-healthy':
      return 30_000;
    default:
      return 5_000;
  }
}

function computeHealthLevel(active: TransportEvidence[]): PeerHealthLevel {
  if (active.length === 0) return 'healthy';

  const hasPositive = active.some(
    (e) => e.kind === 'transport-healthy' || e.kind === 'path-recovered'
  );

  const degraded = active.filter(
    (e) => e.kind === 'path-timeout' || e.kind === 'bridge-pressure' || e.kind === 'packet-loss'
  );

  if (hasPositive && degraded.length === 0) return 'healthy';
  if (active.some((e) => e.kind === 'path-warming')) return 'recovering';
  if (degraded.length > 0) {
    // Multiple degradation signals = more severe
    if (degraded.length >= 2) return 'degraded';
    return 'recovering';
  }

  return 'unknown';
}
