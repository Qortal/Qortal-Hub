/**
 * Group Call V2 — GcallV2Session
 *
 * Top-level session object that wires together all v2 components for one
 * active group call. This is the "Phase 7 cutover" integration class.
 *
 * It is designed to be instantiated by `useGroupVoiceCall` (or its v2
 * replacement) and to accept the same IPC events that currently feed the
 * legacy hook — so the cutover can be incremental:
 *
 *   Stage 1: Instantiate GcallV2Session alongside the legacy hook.
 *            Feed it the same `gcall:audio` events and observe via diagnostics.
 *
 *   Stage 2 (current): Route playout through v2 PCM rings while the legacy
 *                      hook still owns the outer scheduler/worklet wiring.
 *
 *   Stage 3: Remove the remaining legacy playout scaffolding so
 *            GcallV2Session is the only receive path.
 *
 * Topology events arrive via `ingestTopologyEvent()` (called from the IPC
 * event that currently fires `peerMediaRecoveryRequested` etc. in legacy).
 *
 * Audio packets arrive via `ingestAudioPacket()` after decryption.
 */

import type { StreamIdentity, ReceivePolicyOutput } from './spec';
import { streamKey } from './spec';
import { ReticulumSessionController, type TopologyEvent } from './reticulumSessionController';
import { ReceiveEngineRegistry } from './receiveEngine';
import { ReceivePolicyEngine, DEFAULT_POLICY_CONFIG, type ReceivePolicyConfig } from './receivePolicyEngine';
import { SendPressureController } from './sendPressureController';
import { createDecodeServiceFactory } from './decodeService';
import { BufferingDiagnosticsRecorder, NullDiagnosticsRecorder } from './diagnosticsContract';
import type { IDiagnosticsRecorder } from './spec';
import { OPUS_FRAME_DURATION_MS } from '../gcallVoiceAudioConstants';

// ---------------------------------------------------------------------------
// Session options
// ---------------------------------------------------------------------------

export interface GcallV2SessionOptions {
  readonly roomId: string;
  readonly myAddr: string;
  readonly sampleRateHz?: number;
  readonly diagnostics?: IDiagnosticsRecorder | 'buffering' | 'none';
  readonly policyConfig?: Partial<ReceivePolicyConfig>;
}

// ---------------------------------------------------------------------------
// GcallV2Session
// ---------------------------------------------------------------------------

export class GcallV2Session {
  readonly roomId: string;
  readonly myAddr: string;

  private readonly _sessionController: ReticulumSessionController;
  private readonly _engineRegistry: ReceiveEngineRegistry;
  private readonly _policyEngines = new Map<string, ReceivePolicyEngine>();
  private readonly _sendPressure: SendPressureController;
  private readonly _diag: IDiagnosticsRecorder;
  private readonly _bufferingDiag: BufferingDiagnosticsRecorder | null;
  private readonly _policyConfig: Partial<ReceivePolicyConfig>;
  private _disposed = false;

  constructor(opts: GcallV2SessionOptions) {
    this.roomId = opts.roomId;
    this.myAddr = opts.myAddr;
    this._policyConfig = opts.policyConfig ?? {};

    // Diagnostics setup.
    if (opts.diagnostics === 'buffering' || opts.diagnostics === undefined) {
      const buf = new BufferingDiagnosticsRecorder();
      this._bufferingDiag = buf;
      this._diag = buf;
    } else if (opts.diagnostics === 'none') {
      this._bufferingDiag = null;
      this._diag = new NullDiagnosticsRecorder();
    } else {
      this._bufferingDiag = null;
      this._diag = opts.diagnostics;
    }

    this._sessionController = new ReticulumSessionController({
      diagnostics: this._diag,
    });

    this._engineRegistry = new ReceiveEngineRegistry({
      diagnostics: this._diag,
      decodeServiceFactory: createDecodeServiceFactory({
        sampleRateHz: opts.sampleRateHz ?? 48_000,
      }),
      sampleRateHz: opts.sampleRateHz,
    });

    this._sendPressure = new SendPressureController(
      this._sessionController,
      {},
      this._diag
    );

    // When the session controller advances a stream epoch, dispose the old
    // engine and recreate clean state.
    this._sessionController.onParticipantLifecycle((event) => {
      if (event.kind === 'epoch-advanced' || event.kind === 'rejoined') {
        this._engineRegistry.disposeStream(event.sourceAddr);
        this._policyEngines.delete(event.sourceAddr);
      }
      if (event.kind === 'left') {
        this._engineRegistry.disposeStream(event.sourceAddr);
        this._policyEngines.delete(event.sourceAddr);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Topology events (fed from group-call.ts IPC → renderer)
  // -------------------------------------------------------------------------

  ingestTopologyEvent(event: TopologyEvent): void {
    this._sessionController.ingestTopologyEvent(event);
  }

  // -------------------------------------------------------------------------
  // Audio packet ingress (after decrypt)
  // -------------------------------------------------------------------------

  /**
   * Push a decrypted audio packet into the appropriate ReceiveEngine.
   * The stream identity is resolved from the session controller using the
   * source address from the decoded packet.
   */
  ingestDecodedPacket(packet: {
    sourceAddr: string;
    seq: number;
    opusFrame: Uint8Array;
    vad: boolean;
    timestampMs: number;
    receivedAtMs?: number;
  }): void {
    if (this._disposed) return;

    const streamId = this._sessionController.getStreamIdentity(packet.sourceAddr);
    if (!streamId) {
      // Peer not yet in topology — drop.
      return;
    }

    const engine = this._engineRegistry.getOrCreate(streamId);
    engine.pushDecodedPacket(packet);

    // Notify session controller that packets are arriving (expires degradation evidence).
    this._sessionController.onStreamPacketReceived(streamId, packet.seq);
  }

  // -------------------------------------------------------------------------
  // Audio worklet drain tick (called at ~20ms audio clock)
  // -------------------------------------------------------------------------

  /**
   * Execute a drain tick for all active streams. Called by the audio worklet
   * scheduler. Returns a map of sourceAddr → TickOutput for the playout layer.
   */
  async tick(nowMs: number): Promise<Map<string, { pcmBufferedMs: number; framesDecoded: number; state: string; targetBufferMs: number }>> {
    const results = new Map<string, { pcmBufferedMs: number; framesDecoded: number; state: string; targetBufferMs: number }>();

    for (const engine of this._engineRegistry.allEngines()) {
      const sourceAddr = engine.streamId.sourceAddr;
      const policy = this._getOrCreatePolicy(engine.streamId);
      const peerHealth = this._sessionController.getPeerHealth(sourceAddr);

      const policyOutput: ReceivePolicyOutput = policy.tick({
        nowMs,
        streamId: engine.streamId,
        jitterDepth: engine.getJitterDepth(),
        opusBufferedMs: engine.getJitterBufferedMs(),
        pcmBufferedMs: engine.getPcmBufferedMs(),
        lastPushAgeMs: engine.getLastPushAgeMs(),
        lastGapFrames: engine.getLastGapFrames(),
        peerHealth,
      });

      const tickResult = await engine.tick({ policy: policyOutput, nowMs });
      results.set(sourceAddr, {
        pcmBufferedMs: tickResult.pcmBufferedMs,
        framesDecoded: tickResult.framesDecoded,
        state: tickResult.state,
        targetBufferMs: policyOutput.targetBufferMs,
      });
    }

    // Send pressure periodic tick.
    this._sendPressure.tick(nowMs);

    return results;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getPcmRing(sourceAddr: string) {
    return this._engineRegistry.getBySourceAddr(sourceAddr)?.getPcmRing() ?? null;
  }

  getActiveSources(): string[] {
    return this._engineRegistry.allEngines().map((e) => e.streamId.sourceAddr);
  }

  /** Returns true if the session controller has a stream identity for this peer.
   *  Used by the hook to decide whether to route packets through V2 or legacy. */
  isKnownPeer(sourceAddr: string): boolean {
    return this._sessionController.getStreamIdentity(sourceAddr) !== null;
  }

  getDiagnosticEvents() {
    return this._bufferingDiag?.events ?? [];
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._engineRegistry.disposeAll();
    this._sessionController.dispose();
    this._policyEngines.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _getOrCreatePolicy(streamId: StreamIdentity): ReceivePolicyEngine {
    const key = streamKey(streamId);
    const existing = this._policyEngines.get(key);
    if (existing) return existing;
    const engine = new ReceivePolicyEngine(streamId, this._policyConfig, this._diag);
    this._policyEngines.set(key, engine);
    return engine;
  }
}
