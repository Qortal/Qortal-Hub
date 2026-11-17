/**
 * Group Call V2 — DecodeService
 *
 * A unified Opus decode abstraction that supports WebCodecs, WASM libopus, and
 * any future native decoder — all behind a single interface.
 *
 * Replaces the fragmented decode paths currently in `useGroupVoiceCall.ts`:
 *  - WebCodecs `AudioDecoder` path (primary)
 *  - WASM FEC path (`gcall-opus-fec.worker.ts`)
 *  - Inline tweetnacl decode (main-thread sync fallback)
 *
 * Design decisions:
 *  1. One interface (`IDecodeService`) — implementations are swappable.
 *  2. Per-stream decoder instance managed by the service. When a stream is
 *     reset (epoch advance), `reset(streamId)` rebuilds the decoder state
 *     cleanly without leaving stale PLC history.
 *  3. `conceal()` produces a PLC frame using the decoder's internal state
 *     without consuming from the jitter buffer.
 *  4. `dispose()` terminates the decoder for a stream (on stream close).
 *  5. The implementation is async-capable so the WebCodecs path can use its
 *     natural Promise-based API without blocking the worklet tick.
 */

import type { StreamIdentity } from './spec';
import { streamKey } from './spec';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IDecodeService {
  /**
   * Decode one Opus frame for the given stream. Returns PCM samples (Float32)
   * or null if the decode failed fatally (e.g. decoder not ready).
   */
  decode(
    streamId: StreamIdentity,
    seq: number,
    opusFrame: Uint8Array
  ): Promise<Float32Array | null>;

  /**
   * Produce a PLC (packet loss concealment) frame using the decoder's
   * internal state. Returns null if the decoder has no state yet.
   */
  conceal(streamId: StreamIdentity): Promise<Float32Array | null>;

  /**
   * Reset decoder state for the given stream. Called when a stream epoch
   * advances or the encoder resets. Clears PLC history and any buffered state.
   */
  reset(streamId: StreamIdentity): void;

  /**
   * Dispose the decoder for the given stream (on stream close).
   */
  dispose(streamId: StreamIdentity): void;

  /**
   * Dispose all decoders and free resources.
   */
  disposeAll(): void;
}

// ---------------------------------------------------------------------------
// WebCodecs implementation
// ---------------------------------------------------------------------------

/**
 * Per-stream decoder state for the WebCodecs implementation.
 */
interface WebCodecsDecoderState {
  decoder: AudioDecoder | null;
  outputQueue: Float32Array[];
  error: string | null;
  configured: boolean;
  lastSeq: number;
  /** Last successfully decoded PCM frame, used for packet-loss concealment. */
  lastDecodedPcm: Float32Array | null;
  /** Number of consecutive conceal() calls since the last successful decode. */
  concealmentDepth: number;
}

export interface WebCodecsDecodeServiceOptions {
  sampleRateHz?: number;
  channels?: number;
  bitrateKbps?: number;
}

/**
 * WebCodecs-backed decode service. This is the primary implementation for
 * browser environments. Each stream gets its own `AudioDecoder` instance
 * so resets are clean and PLC state is stream-scoped.
 */
export class WebCodecsDecodeService implements IDecodeService {
  private readonly _streams = new Map<string, WebCodecsDecoderState>();
  private readonly _sampleRateHz: number;
  private readonly _channels: number;

  constructor(opts: WebCodecsDecodeServiceOptions = {}) {
    this._sampleRateHz = opts.sampleRateHz ?? 48_000;
    this._channels = opts.channels ?? 1;
  }

  async decode(
    streamId: StreamIdentity,
    seq: number,
    opusFrame: Uint8Array
  ): Promise<Float32Array | null> {
    const state = this._getOrCreate(streamId);
    if (!state.decoder || state.error) return null;

    // 1. Always submit the incoming chunk to WebCodecs first — never skip it.
    //
    //    The previous implementation drained outputQueue before submitting,
    //    causing the incoming opusFrame to be silently dropped whenever WebCodecs
    //    fired its output callback asynchronously (i.e. after the microtask
    //    boundary). That left the ring one frame short on every async decode
    //    event, which is the root cause of the intermittent PCM ring starvation
    //    observed in diagnostics.
    //
    //    Correct pipeline: submit current → drain previous (or current if sync).
    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: seq * 20_000,   // microseconds
      duration: 20_000,
      data: opusFrame.buffer.slice(
        opusFrame.byteOffset,
        opusFrame.byteOffset + opusFrame.byteLength
      ),
    });

    try {
      state.decoder.decode(chunk);
      state.lastSeq = seq;
    } catch (e) {
      state.error = String(e);
      return null;
    }

    // 2. Drain any output that is already available.
    //    For a synchronous decoder the output callback fires during decode()
    //    above, so the current frame's PCM is in the queue right now.
    //    For an async decoder the previous tick's PCM arrived between calls
    //    and is waiting here.  Either way, no frame is lost.
    const pending = state.outputQueue.shift();
    if (pending) {
      state.lastDecodedPcm = pending.slice();
      state.concealmentDepth = 0;
      return pending;
    }

    // 3. Give the decoder one microtask to flush output (synchronous fallback).
    return new Promise<Float32Array | null>((resolve) => {
      queueMicrotask(() => {
        const frame = state.outputQueue.shift();
        if (frame) {
          state.lastDecodedPcm = frame.slice();
          state.concealmentDepth = 0;
        }
        resolve(frame ?? null);
      });
    });
  }

  async conceal(streamId: StreamIdentity): Promise<Float32Array | null> {
    const state = this._streams.get(streamKey(streamId));
    const samplesPerFrame =
      Math.round((this._sampleRateHz * 20) / 1000) * this._channels;

    if (!state?.lastDecodedPcm) {
      // No decoded frame yet — return silence (decoder not warmed up).
      return new Float32Array(samplesPerFrame);
    }

    // Progressive attenuation: each consecutive PLC frame is quieter to
    // avoid looping artefacts during extended loss, fading to silence.
    const GAIN_SCHEDULE = [0.9, 0.75, 0.55, 0.35, 0.15, 0.0];
    state.concealmentDepth++;
    const gain =
      GAIN_SCHEDULE[Math.min(state.concealmentDepth - 1, GAIN_SCHEDULE.length - 1)];

    if (gain === 0) {
      return new Float32Array(samplesPerFrame);
    }

    const src = state.lastDecodedPcm;
    const out = new Float32Array(Math.min(samplesPerFrame, src.length));
    for (let i = 0; i < out.length; i++) {
      out[i] = src[i] * gain;
    }
    return out;
  }

  reset(streamId: StreamIdentity): void {
    const key = streamKey(streamId);
    const state = this._streams.get(key);
    if (state?.decoder) {
      try { state.decoder.close(); } catch { /* ignore */ }
    }
    this._streams.delete(key);
    // Re-create a fresh decoder on next decode call.
  }

  dispose(streamId: StreamIdentity): void {
    this.reset(streamId);
  }

  disposeAll(): void {
    for (const key of this._streams.keys()) {
      const state = this._streams.get(key)!;
      if (state.decoder) {
        try { state.decoder.close(); } catch { /* ignore */ }
      }
    }
    this._streams.clear();
  }

  private _getOrCreate(streamId: StreamIdentity): WebCodecsDecoderState {
    const key = streamKey(streamId);
    const existing = this._streams.get(key);
    if (existing) return existing;

    const state: WebCodecsDecoderState = {
      decoder: null,
      outputQueue: [],
      error: null,
      configured: false,
      lastSeq: -1,
      lastDecodedPcm: null,
      concealmentDepth: 0,
    };

    try {
      const decoder = new AudioDecoder({
        output: (audioData) => {
          // Copy AudioData to Float32Array and push to output queue.
          const nSamples = audioData.numberOfFrames * audioData.numberOfChannels;
          const pcm = new Float32Array(nSamples);
          audioData.copyTo(pcm, { planeIndex: 0 });
          audioData.close();
          state.outputQueue.push(pcm);
        },
        error: (e) => {
          state.error = String(e);
        },
      });

      decoder.configure({
        codec: 'opus',
        sampleRate: this._sampleRateHz,
        numberOfChannels: this._channels,
      });

      state.decoder = decoder;
      state.configured = true;
    } catch (e) {
      state.error = String(e);
    }

    this._streams.set(key, state);
    return state;
  }
}

// ---------------------------------------------------------------------------
// Fallback: inline tweetnacl / WASM implementation
// ---------------------------------------------------------------------------

/**
 * A no-op decode service for use when WebCodecs is unavailable (e.g. in
 * Node.js tests) or as a stub during development. Returns silence for every
 * frame. The real implementation will call into the WASM Opus decoder.
 */
export class NullDecodeService implements IDecodeService {
  private readonly _sampleRateHz: number;
  private readonly _channels: number;

  constructor(opts: { sampleRateHz?: number; channels?: number } = {}) {
    this._sampleRateHz = opts.sampleRateHz ?? 48_000;
    this._channels = opts.channels ?? 1;
  }

  async decode(_streamId: StreamIdentity, _seq: number, _opusFrame: Uint8Array): Promise<Float32Array | null> {
    const samplesPerFrame = Math.round((this._sampleRateHz * 20) / 1000) * this._channels;
    return new Float32Array(samplesPerFrame);
  }

  async conceal(_streamId: StreamIdentity): Promise<Float32Array | null> {
    const samplesPerFrame = Math.round((this._sampleRateHz * 20) / 1000) * this._channels;
    return new Float32Array(samplesPerFrame);
  }

  reset(_streamId: StreamIdentity): void {}
  dispose(_streamId: StreamIdentity): void {}
  disposeAll(): void {}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the best available decode service for the current environment.
 * Falls back gracefully if WebCodecs is not available.
 */
export function createDecodeService(
  opts: WebCodecsDecodeServiceOptions = {}
): IDecodeService {
  if (
    typeof AudioDecoder !== 'undefined' &&
    typeof EncodedAudioChunk !== 'undefined'
  ) {
    return new WebCodecsDecodeService(opts);
  }
  return new NullDecodeService(opts);
}

/**
 * A factory function type for creating per-stream decode services.
 * The ReceiveEngineRegistry uses this to give each engine its own service.
 */
export type DecodeServiceFactory = (streamId: StreamIdentity) => IDecodeService;

export function createDecodeServiceFactory(
  opts: WebCodecsDecodeServiceOptions = {}
): DecodeServiceFactory {
  return (_streamId: StreamIdentity) => createDecodeService(opts);
}
