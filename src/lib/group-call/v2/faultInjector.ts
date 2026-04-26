/**
 * Group Call V2 — FaultInjector
 *
 * Injects controlled faults into the group call pipeline for testing and
 * regression. Supports the following fault types:
 *
 *  - Packet loss (random or burst)
 *  - Transport latency spikes
 *  - Bridge queue pressure simulation
 *  - Path resolution timeouts
 *  - Seq wrap at an arbitrary point
 *  - Tick budget breaches (simulated stalls)
 *
 * The injector is designed for use with the ReplayHarness and with live
 * integration tests. It wraps the ReticulumSessionController to inject
 * transport evidence at the right times.
 */

import type { TransportEvidence, StreamIdentity } from './spec';
import type { ReticulumSessionController } from './reticulumSessionController';

// ---------------------------------------------------------------------------
// Fault definitions
// ---------------------------------------------------------------------------

export type FaultKind =
  | 'packet-loss-burst'
  | 'latency-spike'
  | 'bridge-pressure'
  | 'path-timeout'
  | 'seq-wrap'
  | 'tick-stall';

export interface FaultSpec {
  readonly kind: FaultKind;
  /** When to activate this fault (simulated ms from call start). */
  readonly atMs: number;
  /** How long the fault persists (ms). 0 = one-shot. */
  readonly durationMs?: number;
  /** Fault-specific parameters. */
  readonly params?: Record<string, number | string | boolean>;
}

// ---------------------------------------------------------------------------
// FaultInjector
// ---------------------------------------------------------------------------

export class FaultInjector {
  private readonly _faults: FaultSpec[];
  private readonly _sessionController: ReticulumSessionController;
  private _activeFaults = new Set<FaultSpec>();

  constructor(
    sessionController: ReticulumSessionController,
    faults: FaultSpec[]
  ) {
    this._sessionController = sessionController;
    this._faults = [...faults].sort((a, b) => a.atMs - b.atMs);
  }

  /**
   * Tick the injector at the given simulated time. Activates and deactivates
   * faults as needed, injecting transport evidence into the session controller.
   */
  tick(nowMs: number, sourceAddr: string): void {
    for (const fault of this._faults) {
      if (fault.atMs <= nowMs && !this._activeFaults.has(fault)) {
        this._activeFaults.add(fault);
        this._activate(fault, sourceAddr, nowMs);
      }
      if (
        fault.durationMs &&
        fault.durationMs > 0 &&
        nowMs > fault.atMs + fault.durationMs &&
        this._activeFaults.has(fault)
      ) {
        this._activeFaults.delete(fault);
        this._deactivate(fault, sourceAddr, nowMs);
      }
    }
  }

  /**
   * Check if a packet should be dropped at the given simulation time.
   * Used by the replay harness to filter synthetic packets.
   */
  shouldDropPacket(nowMs: number, rng: () => number): boolean {
    for (const fault of this._activeFaults) {
      if (fault.kind === 'packet-loss-burst') {
        const rate = (fault.params?.rate as number | undefined) ?? 0.3;
        if (rng() < rate) return true;
      }
    }
    return false;
  }

  /**
   * Get additional latency to add to packet arrival (simulates latency spike).
   */
  getLatencyAddMs(nowMs: number): number {
    let extra = 0;
    for (const fault of this._activeFaults) {
      if (fault.kind === 'latency-spike') {
        extra += (fault.params?.addMs as number | undefined) ?? 0;
      }
    }
    return extra;
  }

  /**
   * Get additional tick stall time (simulates tick budget breach).
   */
  getTickStallMs(nowMs: number): number {
    let stall = 0;
    for (const fault of this._activeFaults) {
      if (fault.kind === 'tick-stall') {
        stall += (fault.params?.stallMs as number | undefined) ?? 0;
      }
    }
    return stall;
  }

  private _activate(fault: FaultSpec, sourceAddr: string, nowMs: number): void {
    const ttl = (fault.durationMs ?? 0) + 100;
    switch (fault.kind) {
      case 'bridge-pressure': {
        const depth = (fault.params?.depth as number | undefined) ?? 20;
        const evidence: TransportEvidence = {
          kind: 'bridge-pressure',
          sourceAddr,
          observedAtMs: nowMs,
          expiresAtMs: nowMs + ttl,
          magnitude: depth,
        };
        this._sessionController.ingestTransportEvidence(evidence);
        break;
      }
      case 'path-timeout': {
        this._sessionController.ingestTopologyEvent({
          kind: 'path-resolution-timeout',
          sourceAddr,
        });
        break;
      }
      case 'latency-spike':
      case 'packet-loss-burst':
      case 'tick-stall':
        // Handled via shouldDropPacket / getLatencyAddMs / getTickStallMs.
        break;
      case 'seq-wrap':
        // Handled by the replay harness's packet generator — the harness will
        // set seq to 65535 at fault.atMs and then wrap to 0 on the next packet.
        break;
    }
  }

  private _deactivate(fault: FaultSpec, sourceAddr: string, _nowMs: number): void {
    switch (fault.kind) {
      case 'bridge-pressure':
        this._sessionController.ingestTopologyEvent({
          kind: 'bridge-pressure-clear',
          sourceAddr,
        });
        break;
      case 'path-timeout':
        this._sessionController.ingestTopologyEvent({
          kind: 'path-resolution-ok',
          sourceAddr,
        });
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Preset fault sequences for regression fixtures
// ---------------------------------------------------------------------------

/**
 * Fault sequence that replicates the call-63 failure pattern:
 *  - Recovery path latch (via global-recovery-started topology event)
 *  - High bridge queue pressure from the start
 *  - Latency spike as Kenny joins (~3s in)
 *  - Tick stalls matching Phil's 28 budget breaches
 */
export const FAULT_CALL63_PATTERN: FaultSpec[] = [
  { kind: 'bridge-pressure', atMs: 0, durationMs: 60_000, params: { depth: 20 } },
  { kind: 'latency-spike', atMs: 3_000, durationMs: 5_000, params: { addMs: 60 } },
  { kind: 'tick-stall', atMs: 3_000, durationMs: 20_000, params: { stallMs: 17 } },
];

/**
 * Fault sequence for the call-60 transport flap pattern:
 *  - 4 link/packet flaps spread over 75s
 *  - Bursty arrivals after each flap
 */
export const FAULT_CALL60_PATTERN: FaultSpec[] = [
  { kind: 'latency-spike', atMs: 15_000, durationMs: 3_000, params: { addMs: 80 } },
  { kind: 'latency-spike', atMs: 30_000, durationMs: 3_000, params: { addMs: 80 } },
  { kind: 'latency-spike', atMs: 50_000, durationMs: 3_000, params: { addMs: 80 } },
  { kind: 'latency-spike', atMs: 68_000, durationMs: 3_000, params: { addMs: 80 } },
];
