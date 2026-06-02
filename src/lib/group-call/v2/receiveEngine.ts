/**
 * Group Call V2 — ReceiveEngine
 *
 * The single authority for one audio stream's receive lifecycle:
 *  - Stream identity (epoch-safe, modulo-safe seq math)
 *  - Reorder/jitter buffer
 *  - Gap / FEC accounting
 *  - Decode scheduling (calls DecodeService)
 *  - PCM ring fill
 *  - Per-stream diagnostics
 *
 * The engine is driven externally by:
 *  1. `pushEncryptedFrame()` — called from the transport layer when a new
 *     encrypted packet arrives (after decrypt, or synchronously for the
 *     main-thread sync path).
 *  2. `tick()` — called by the audio worklet scheduler at the 20ms audio clock.
 *     The policy engine provides a `ReceivePolicyOutput` each tick.
 *
 * There is ONE ReceiveEngine per stream (keyed by StreamIdentity). When the
 * session controller advances the stream epoch, the old engine is disposed and
 * a new one is created. This guarantees all watermarks, jitter state, and PCM
 * state are fully reset.
 *
 * Replaces the per-source logic currently embedded in `useGroupVoiceCall.ts`'s
 * `handleIncomingAudioPacket` / `runJitterDrainTick` and the per-source
 * management in the hook's `jitterMapRef`.
 */

import type {
  StreamIdentity,
  EncryptedIngressFrame,
  DecodedFrame,
  IDiagnosticsRecorder,
  ReceivePolicyOutput,
} from './spec';
import { streamKey } from './spec';
import type { IDecodeService } from './decodeService';
import { PerSourcePcmRing } from './perSourcePcmRing';
import { NullDiagnosticsRecorder } from './diagnosticsContract';
import { OPUS_FRAME_DURATION_MS } from '../gcallVoiceAudioConstants';
import {
  DEFAULT_POLICY_CONFIG,
  computeDecodedPcmLatencyCeilingMs,
  computeDecodedPcmLatencyResumeMs,
} from './receivePolicyEngine';

// ---------------------------------------------------------------------------
// Jitter buffer (stream-scoped, reset-safe)
// ---------------------------------------------------------------------------

interface JitterEntry {
  readonly seq: number;
  readonly opusFrame: Uint8Array;
  readonly receivedAtMs: number;
}

/**
 * Modulo-safe seq comparison. Returns true if `seq` is strictly after
 * `reference` in the 16-bit sequence number space (handles wrap-around).
 */
function seqIsAfter(seq: number, reference: number): boolean {
  if (reference < 0) return true; // no reference yet
  const diff = (seq - reference + 65536) & 0xffff;
  return diff > 0 && diff < 32768;
}

class StreamJitterBuffer {
  private _entries: JitterEntry[] = [];
  private _lastPoppedSeq = -1;
  private _primed = false;
  private _emptySinceMs: number | null = null;
  private _lastPushMs = -1;
  private _lastPacketReceivedAtMs = -1;
  private _recentArrivalGapMs = 0;
  private _recentArrivalGapObservedAtMs = -1;

  constructor(
    private _capacity: number,
    private _startThreshold: number,
    private readonly _clockMs: () => number
  ) {}

  reconfigure(capacity: number, startThreshold: number): void {
    this._capacity = capacity;
    this._startThreshold = startThreshold;
  }

  push(
    seq: number,
    opusFrame: Uint8Array,
    receivedAtMs = this._clockMs()
  ): 'accepted' | 'stale' | 'duplicate' {
    // Modulo-safe stale check.
    if (this._lastPoppedSeq >= 0 && !seqIsAfter(seq, this._lastPoppedSeq)) {
      return 'stale';
    }
    // Duplicate check.
    if (this._entries.some((e) => e.seq === seq)) return 'duplicate';

    // Sorted insert by seq (modulo-safe).
    let idx = this._entries.length;
    while (idx > 0 && seqIsAfter(this._entries[idx - 1].seq, seq)) {
      idx--;
    }
    this._entries.splice(idx, 0, {
      seq,
      opusFrame,
      receivedAtMs,
    });
    if (this._lastPacketReceivedAtMs >= 0) {
      const arrivalGapMs = Math.max(0, receivedAtMs - this._lastPacketReceivedAtMs);
      this._recentArrivalGapMs = arrivalGapMs;
      this._recentArrivalGapObservedAtMs = receivedAtMs;
    }
    this._lastPacketReceivedAtMs = receivedAtMs;
    this._lastPushMs = this._clockMs();
    this._emptySinceMs = null;

    // Trim to capacity * 2 (oldest-first, not newest-first).
    const maxEntries = this._capacity * 2;
    if (this._entries.length > maxEntries) {
      this._entries.splice(0, this._entries.length - maxEntries);
    }

    return 'accepted';
  }

  /**
   * Pop the next frame if the buffer meets the readiness threshold.
   * Returns null if not ready (priming) or empty.
   */
  pop(): JitterEntry | null {
    const threshold = this._primed ? 1 : this._startThreshold;
    if (this._entries.length < threshold) return null;
    const entry = this._entries.shift()!;
    this._primed = true;
    this._lastPoppedSeq = entry.seq;
    if (this._entries.length === 0) {
      this._emptySinceMs = this._clockMs();
    }
    return entry;
  }

  hasReadyFrame(): boolean {
    const threshold = this._primed ? 1 : this._startThreshold;
    return this._entries.length >= threshold;
  }

  depth(): number {
    return this._entries.length;
  }

  bufferedMs(): number {
    return this._entries.length * OPUS_FRAME_DURATION_MS;
  }

  lastPushAgeMs(): number {
    if (this._lastPushMs < 0) return Infinity;
    return this._clockMs() - this._lastPushMs;
  }

  recentArrivalGapMs(windowMs = 4_000): number {
    if (this._recentArrivalGapObservedAtMs < 0) return 0;
    if (this._clockMs() - this._recentArrivalGapObservedAtMs > windowMs) return 0;
    return this._recentArrivalGapMs;
  }

  lastPoppedSeq(): number {
    return this._lastPoppedSeq;
  }

  /** Force-prime the buffer (used when policy says release early). */
  forcePrime(): void {
    if (this._entries.length > 0) this._primed = true;
  }

  /** Gap count between last popped seq and the given seq (modulo-safe). */
  gapTo(seq: number): number {
    if (this._lastPoppedSeq < 0) return 0;
    const expected = (this._lastPoppedSeq + 1) & 0xffff;
    const gap = (seq - expected + 65536) & 0xffff;
    return gap < 32768 ? gap : 0;
  }

  reset(): void {
    this._entries = [];
    this._lastPoppedSeq = -1;
    this._primed = false;
    this._emptySinceMs = null;
    this._lastPushMs = -1;
    this._lastPacketReceivedAtMs = -1;
    this._recentArrivalGapMs = 0;
    this._recentArrivalGapObservedAtMs = -1;
  }
}

// ---------------------------------------------------------------------------
// ReceiveEngine
// ---------------------------------------------------------------------------

export interface ReceiveEngineOptions {
  readonly streamId: StreamIdentity;
  readonly decodeService: IDecodeService;
  readonly pcmRing?: PerSourcePcmRing;
  readonly diagnostics?: IDiagnosticsRecorder;
  readonly clockMs?: () => number;
  /** Initial jitter buffer capacity in frames. */
  readonly jitterCapacity?: number;
  /** Frames needed before first pop (priming threshold). */
  readonly jitterStartThreshold?: number;
  readonly sampleRateHz?: number;
}

export interface TickInput {
  readonly policy: ReceivePolicyOutput;
  readonly nowMs: number;
}

export interface TickOutput {
  readonly framesDecoded: number;
  readonly pcmBufferedMs: number;
  readonly opusBufferedMs: number;
  readonly tickDurationMs: number;
  readonly state: ReceivePolicyOutput['state'];
}

export class ReceiveEngine {
  readonly streamId: StreamIdentity;
  readonly key: string;

  private readonly _jitter: StreamJitterBuffer;
  private readonly _pcmRing: PerSourcePcmRing;
  private readonly _decode: IDecodeService;
  private readonly _diag: IDiagnosticsRecorder;
  private readonly _clockMs: () => number;

  private _disposed = false;
  private _totalPacketsReceived = 0;
  private _totalPacketsDropped = 0;
  private _concealmentFrames = 0;
  private _lastTickMs = -1;
  /** Gap frames detected during the most recent tick (exposed to policy engine). */
  private _lastGapFrames = 0;
  /** Hysteresis latch: suppress decode while decoded PCM latency is already high. */
  private _decodedPcmLatencyClampActive = false;

  constructor(opts: ReceiveEngineOptions) {
    this.streamId = opts.streamId;
    this.key = streamKey(opts.streamId);
    this._clockMs = opts.clockMs ?? (() => performance.now());
    this._decode = opts.decodeService;
    this._pcmRing = opts.pcmRing ?? new PerSourcePcmRing({ sampleRateHz: opts.sampleRateHz });
    this._diag = opts.diagnostics ?? new NullDiagnosticsRecorder();
    this._jitter = new StreamJitterBuffer(
      opts.jitterCapacity ?? 8,
      opts.jitterStartThreshold ?? 4,
      this._clockMs
    );
  }

  // -------------------------------------------------------------------------
  // Ingress
  // -------------------------------------------------------------------------

  /**
   * Push a decoded (but not yet Opus-decoded) packet into the jitter buffer.
   * Called by the decrypt layer after decryption succeeds.
   *
   * Uses modulo-safe seq math — no packet is ever dropped as "stale" due to
   * seq wrap-around.
   */
  pushDecodedPacket(packet: {
    seq: number;
    opusFrame: Uint8Array;
    vad: boolean;
    timestampMs: number;
    sourceAddr: string;
    receivedAtMs?: number;
  }): 'accepted' | 'stale' | 'duplicate' | 'wrong-stream' {
    if (this._disposed) return 'stale';
    if (packet.sourceAddr !== this.streamId.sourceAddr) return 'wrong-stream';

    const result = this._jitter.push(
      packet.seq,
      packet.opusFrame,
      packet.receivedAtMs
    );
    if (result === 'accepted') {
      this._totalPacketsReceived++;
    } else {
      this._totalPacketsDropped++;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Drain tick (called by audio worklet scheduler at ~20ms)
  // -------------------------------------------------------------------------

  /**
   * Execute one drain tick. Pops up to `policy.maxDecodePerTick` frames from
   * the jitter buffer, decodes them via DecodeService, and writes PCM into the
   * ring. Applies gap concealment when frames are missing.
   *
   * This is the ONLY code path that advances the playout position. The policy
   * engine controls rate; this engine controls correctness.
   */
  async tick(input: TickInput): Promise<TickOutput> {
    if (this._disposed) {
      return {
        framesDecoded: 0,
        pcmBufferedMs: 0,
        opusBufferedMs: 0,
        tickDurationMs: 0,
        state: input.policy.state,
      };
    }

    const t0 = this._clockMs();
    const { policy } = input;
    const stalePcmAgeBudgetMs = computeDecodedPcmLatencyCeilingMs(
      policy.targetBufferMs,
      DEFAULT_POLICY_CONFIG.decodedPcmLatencyCeilingRatio
    );
    const finish = (framesDecoded: number): TickOutput => {
      const tickDurationMs = this._clockMs() - t0;
      this._pcmRing.dropFramesOlderThan(stalePcmAgeBudgetMs, input.nowMs);
      const oldestFrameAgeMs = this._pcmRing.oldestFrameAgeMs(input.nowMs);

      this._diag.recordJitterStats({
        streamKey: this.key,
        depth: this._jitter.depth(),
        bufferedMs: this._jitter.bufferedMs(),
        lastPushAgeMs: this._jitter.lastPushAgeMs(),
        atMs: input.nowMs,
        state: input.policy.state,
      });

      this._diag.recordPcmRingStats({
        streamKey: this.key,
        bufferedMs: this._pcmRing.bufferedMs(),
        oldestFrameAgeMs,
        staleDrops: this._pcmRing.staleDrops,
        underruns: this._pcmRing.underruns,
        atMs: input.nowMs,
        state: input.policy.state,
      });

      this._lastTickMs = input.nowMs;

      return {
        framesDecoded,
        pcmBufferedMs: this._pcmRing.bufferedMs(),
        opusBufferedMs: this._jitter.bufferedMs(),
        tickDurationMs,
        state: policy.state,
      };
    };

    // In holdPlayout states, do nothing.
    if (policy.holdPlayout) {
      return finish(0);
    }

    this._pcmRing.dropFramesOlderThan(stalePcmAgeBudgetMs, input.nowMs);
    const pcmBufferedMsAtTickStart = this._pcmRing.bufferedMs();
    const decodedLatencySoftCapMs = stalePcmAgeBudgetMs;
    const decodedLatencyResumeMs = computeDecodedPcmLatencyResumeMs(
      policy.targetBufferMs,
      DEFAULT_POLICY_CONFIG.decodedPcmLatencyResumeRatio
    );
    if (this._decodedPcmLatencyClampActive) {
      if (pcmBufferedMsAtTickStart <= decodedLatencyResumeMs) {
        this._decodedPcmLatencyClampActive = false;
      } else {
        return finish(0);
      }
    }
    if (pcmBufferedMsAtTickStart >= decodedLatencySoftCapMs) {
      this._decodedPcmLatencyClampActive = true;
      return finish(0);
    }

    // backlogDrain: allow higher decode rate to flush Opus backlog.
    const maxDecode = policy.aggressiveDrain
      ? Math.max(policy.maxDecodePerTick, 8)
      : policy.maxDecodePerTick;

    let decoded = 0;
    // Reset gap counter for this tick; accumulated as frames are popped.
    this._lastGapFrames = 0;

    for (let i = 0; i < maxDecode; i++) {
      const entry = this._jitter.pop();

      if (entry === null) {
        // Jitter buffer empty or below threshold.
        if (policy.enableConcealment && this._jitter.lastPushAgeMs() < 2000) {
          // Apply PLC only if source was recently active.
          const plcPcm = await this._decode.conceal(this.streamId);
          if (plcPcm) {
            this._pcmRing.write(plcPcm, { ingressAtMs: null });
            this._concealmentFrames++;
          }
        }
        break;
      }

      // Gap detection (modulo-safe).
      const gap = this._jitter.gapTo(entry.seq);
      if (gap > 0 && gap <= 48) {
        this._lastGapFrames += gap;
        if (policy.enableConcealment) {
          // Apply concealment frames for the gap.
          for (let g = 0; g < Math.min(gap, 4); g++) {
            const plcPcm = await this._decode.conceal(this.streamId);
            if (plcPcm) {
              this._pcmRing.write(plcPcm, { ingressAtMs: null });
              this._concealmentFrames++;
            }
          }
        }
      }

      // Opus decode.
      const pcm = await this._decode.decode(this.streamId, entry.seq, entry.opusFrame);
      if (pcm) {
        this._pcmRing.write(pcm, { ingressAtMs: entry.receivedAtMs });
        decoded++;
        this._diag.recordDecodeResult({
          streamKey: this.key,
          seq: entry.seq,
          durationMs: OPUS_FRAME_DURATION_MS,
          decodeLatencyMs: this._clockMs() - entry.receivedAtMs,
          usedFec: false,
          usedPlc: false,
          decodedAtMs: this._clockMs(),
        });
      }

      // If we've reached the target buffer depth, stop decoding.
      if (!policy.aggressiveDrain && this._pcmRing.bufferedMs() >= policy.targetBufferMs) {
        break;
      }
    }

    return finish(decoded);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getPcmRing(): PerSourcePcmRing {
    return this._pcmRing;
  }

  getJitterDepth(): number {
    return this._jitter.depth();
  }

  getJitterBufferedMs(): number {
    return this._jitter.bufferedMs();
  }

  getPcmBufferedMs(): number {
    return this._pcmRing.bufferedMs();
  }

  getLastPoppedSeq(): number {
    return this._jitter.lastPoppedSeq();
  }

  getLastPushAgeMs(): number {
    return this._jitter.lastPushAgeMs();
  }

  getRecentArrivalGapMs(windowMs?: number): number {
    return this._jitter.recentArrivalGapMs(windowMs);
  }

  getConcealmentFrames(): number {
    return this._concealmentFrames;
  }

  getTotalPacketsReceived(): number {
    return this._totalPacketsReceived;
  }

  /** Gap frames detected during the most recent tick. Fed to ReceivePolicyEngine
   *  so the `lossRecovery` FSM state can trigger on actual sequence gaps. */
  getLastGapFrames(): number {
    return this._lastGapFrames;
  }

  reconfigureJitter(capacity: number, startThreshold: number): void {
    this._jitter.reconfigure(capacity, startThreshold);
  }

  forcePrime(): void {
    this._jitter.forcePrime();
  }

  // -------------------------------------------------------------------------
  // Reset / disposal
  // -------------------------------------------------------------------------

  /**
   * Clear all buffered state. Called when the stream epoch advances or the
   * source resets its encoder. Watermarks are fully cleared so the new epoch
   * starts fresh with correct modulo-safe arithmetic.
   */
  reset(): void {
    this._jitter.reset();
    this._pcmRing.reset();
    this._totalPacketsReceived = 0;
    this._totalPacketsDropped = 0;
    this._concealmentFrames = 0;
    this._lastTickMs = -1;
    this._lastGapFrames = 0;
    this._decodedPcmLatencyClampActive = false;
    this._decode.reset(this.streamId);
  }

  dispose(): void {
    this._disposed = true;
    this.reset();
    this._decode.dispose(this.streamId);
  }
}

// ---------------------------------------------------------------------------
// ReceiveEngineRegistry — manages all active engines
// ---------------------------------------------------------------------------

export interface ReceiveEngineRegistryOptions {
  readonly diagnostics?: IDiagnosticsRecorder;
  readonly clockMs?: () => number;
  readonly decodeServiceFactory: (streamId: StreamIdentity) => IDecodeService;
  readonly sampleRateHz?: number;
}

/**
 * Manages the lifecycle of ReceiveEngine instances, keyed by StreamIdentity.
 * When the session controller advances a stream epoch, the old engine is disposed
 * and a new one is created with a clean slate.
 */
export class ReceiveEngineRegistry {
  private readonly _engines = new Map<string, ReceiveEngine>();
  private readonly _opts: ReceiveEngineRegistryOptions;

  constructor(opts: ReceiveEngineRegistryOptions) {
    this._opts = opts;
  }

  /**
   * Get or create the engine for the given stream identity.
   * If an engine exists for the same sourceAddr but a different epoch, the old
   * engine is disposed first — guaranteeing a clean-slate reset.
   */
  getOrCreate(streamId: StreamIdentity): ReceiveEngine {
    const key = streamKey(streamId);
    const existing = this._engines.get(key);
    if (existing) return existing;

    // Dispose any older epoch for the same source.
    for (const [k, engine] of this._engines) {
      if (engine.streamId.sourceAddr === streamId.sourceAddr) {
        engine.dispose();
        this._engines.delete(k);
      }
    }

    const engine = new ReceiveEngine({
      streamId,
      decodeService: this._opts.decodeServiceFactory(streamId),
      diagnostics: this._opts.diagnostics,
      clockMs: this._opts.clockMs,
      sampleRateHz: this._opts.sampleRateHz,
    });
    this._engines.set(key, engine);
    return engine;
  }

  get(key: string): ReceiveEngine | undefined {
    return this._engines.get(key);
  }

  getBySourceAddr(sourceAddr: string): ReceiveEngine | undefined {
    for (const engine of this._engines.values()) {
      if (engine.streamId.sourceAddr === sourceAddr) return engine;
    }
    return undefined;
  }

  allEngines(): ReceiveEngine[] {
    return [...this._engines.values()];
  }

  disposeStream(sourceAddr: string): void {
    for (const [k, engine] of this._engines) {
      if (engine.streamId.sourceAddr === sourceAddr) {
        engine.dispose();
        this._engines.delete(k);
      }
    }
  }

  disposeAll(): void {
    for (const engine of this._engines.values()) {
      engine.dispose();
    }
    this._engines.clear();
  }
}
