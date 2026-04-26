/**
 * Group Call V2 — PerSourcePcmRing
 *
 * A bounded FIFO of Float32 PCM samples for one audio stream. The playout
 * worklet reads from this ring; the ReceiveEngine writes into it after Opus
 * decode. The ring is the sole owner of PCM state for its stream — there is
 * no separate "rebuild" flag or external state machine that needs to know
 * about its fill level.
 *
 * Design decisions:
 *  - Fixed capacity in samples (not frames) so the worklet and engine can
 *    use different frame sizes without coordination.
 *  - Thread safety: this ring lives on the main thread. The playout worklet
 *    communicates fill level via shared SharedArrayBuffer (see PlayoutBridge).
 *    The ring itself is not shared; only atomic fill metrics are.
 *  - `underruns` / `overruns` are monotonic counters for diagnostics.
 *  - `reset()` clears all state including the modulo-safe watermark.
 */

import type { IPcmRing } from './spec';
import { OPUS_FRAME_DURATION_MS } from '../gcallVoiceAudioConstants';

const DEFAULT_SAMPLE_RATE = 48_000;
const SHARED_INGRESS_TIMESTAMP_MOD = 0x7fffffff;
const STATE_READ_HEAD = 0;
const STATE_WRITE_HEAD = 1;
const STATE_FILLED_SAMPLES = 2;
const STATE_UNDERRUNS = 3;
const STATE_OVERRUNS = 4;
const STATE_STALE_DROPS = 5;
const STATE_SLOT_COUNT = 6;

/**
 * Default ring capacity: 1 second of stereo @ 48 kHz.
 * This is much larger than the target buffer (≤300ms) so we never clamp
 * writes during normal operation; overrun drops are a last resort.
 */
const DEFAULT_CAPACITY_MS = 1_000;

export interface SharedPcmRingBridgeConfig {
  readonly sampleBuffer: SharedArrayBuffer;
  readonly stateBuffer: SharedArrayBuffer;
  readonly ingressTimestampBuffer: SharedArrayBuffer;
  readonly capacitySamples: number;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly frameSamples: number;
  readonly ingressCapacityFrames: number;
}

export class PerSourcePcmRing implements IPcmRing {
  private readonly _buf: Float32Array;
  private readonly _state: Int32Array;
  private readonly _ingressTimestamps: Int32Array;
  private readonly _sampleBuffer: SharedArrayBuffer;
  private readonly _stateBuffer: SharedArrayBuffer;
  private readonly _ingressTimestampBuffer: SharedArrayBuffer;
  private readonly _capacitySamples: number;
  private readonly _ingressCapacityFrames: number;
  private readonly _sampleRate: number;
  private readonly _channels: number;
  private readonly _frameSamples: number;

  constructor(opts: {
    sampleRateHz?: number;
    channels?: number;
    capacityMs?: number;
  } = {}) {
    this._sampleRate = opts.sampleRateHz ?? DEFAULT_SAMPLE_RATE;
    this._channels = opts.channels ?? 1;
    const capMs = opts.capacityMs ?? DEFAULT_CAPACITY_MS;
    this._capacitySamples = Math.ceil((capMs / 1000) * this._sampleRate) * this._channels;
    this._frameSamples =
      Math.ceil((OPUS_FRAME_DURATION_MS / 1000) * this._sampleRate) * this._channels;
    this._ingressCapacityFrames = Math.max(
      1,
      Math.ceil(this._capacitySamples / this._frameSamples)
    );
    this._sampleBuffer = new SharedArrayBuffer(
      this._capacitySamples * Float32Array.BYTES_PER_ELEMENT
    );
    this._stateBuffer = new SharedArrayBuffer(
      STATE_SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT
    );
    this._ingressTimestampBuffer = new SharedArrayBuffer(
      this._ingressCapacityFrames * Int32Array.BYTES_PER_ELEMENT
    );
    this._buf = new Float32Array(this._sampleBuffer);
    this._state = new Int32Array(this._stateBuffer);
    this._ingressTimestamps = new Int32Array(this._ingressTimestampBuffer);
  }

  get underruns(): number {
    return Atomics.load(this._state, STATE_UNDERRUNS);
  }

  get overruns(): number {
    return Atomics.load(this._state, STATE_OVERRUNS);
  }

  get staleDrops(): number {
    return Atomics.load(this._state, STATE_STALE_DROPS);
  }

  /**
   * Write `samples` into the ring. If writing would exceed capacity, the
   * OLDEST data is overwritten (ring semantics). Overrun is counted.
   */
  write(
    samples: Float32Array,
    opts: {
      ingressAtMs?: number | null;
    } = {}
  ): void {
    const n = samples.length;
    if (n === 0) return;

    let readHead = Atomics.load(this._state, STATE_READ_HEAD);
    let writeHead = Atomics.load(this._state, STATE_WRITE_HEAD);
    let filledSamples = Atomics.load(this._state, STATE_FILLED_SAMPLES);

    // If the write would overflow, discard the oldest data by advancing readHead.
    if (filledSamples + n > this._capacitySamples) {
      const overflow = filledSamples + n - this._capacitySamples;
      readHead = (readHead + overflow) % this._capacitySamples;
      filledSamples -= overflow;
      Atomics.store(this._state, STATE_READ_HEAD, readHead);
      Atomics.store(this._state, STATE_FILLED_SAMPLES, filledSamples);
      Atomics.add(this._state, STATE_OVERRUNS, 1);
    }

    const writeHeadBefore = writeHead;
    const firstChunk = Math.min(n, this._capacitySamples - writeHead);
    this._buf.set(samples.subarray(0, firstChunk), writeHead);
    if (firstChunk < n) {
      this._buf.set(samples.subarray(firstChunk), 0);
    }
    writeHead = (writeHead + n) % this._capacitySamples;
    filledSamples += n;
    Atomics.store(this._state, STATE_WRITE_HEAD, writeHead);
    Atomics.store(this._state, STATE_FILLED_SAMPLES, filledSamples);

    const frameCount = Math.floor(n / this._frameSamples);
    const ingressAtMs =
      typeof opts.ingressAtMs === 'number' && Number.isFinite(opts.ingressAtMs)
        ? Math.max(
            0,
            Math.round(opts.ingressAtMs % SHARED_INGRESS_TIMESTAMP_MOD)
          )
        : 0;
    for (let i = 0; i < frameCount; i++) {
      const sampleOffset = writeHeadBefore + i * this._frameSamples;
      const frameSlot =
        Math.floor((sampleOffset % this._capacitySamples) / this._frameSamples) %
        this._ingressCapacityFrames;
      Atomics.store(this._ingressTimestamps, frameSlot, ingressAtMs);
    }
  }

  /**
   * Read up to `maxSamples` from the ring into `out`. Returns the number of
   * samples actually written. When the ring is empty (underrun), zeros are
   * written and the underrun counter is incremented.
   */
  read(out: Float32Array, maxSamples: number): number {
    return this.readWithFrameMetadata(out, maxSamples).samplesRead;
  }

  readWithFrameMetadata(
    out: Float32Array,
    maxSamples: number
  ): {
    samplesRead: number;
    frameIngressAtMs: Array<number | null>;
  } {
    const want = Math.min(maxSamples, out.length);
    if (want <= 0) {
      return { samplesRead: 0, frameIngressAtMs: [] };
    }

    const filledSamples = Atomics.load(this._state, STATE_FILLED_SAMPLES);
    if (filledSamples === 0) {
      out.fill(0, 0, want);
      Atomics.add(this._state, STATE_UNDERRUNS, 1);
      return { samplesRead: want, frameIngressAtMs: [] };
    }

    let readHead = Atomics.load(this._state, STATE_READ_HEAD);
    const available = Math.min(want, filledSamples);
    const firstChunk = Math.min(available, this._capacitySamples - readHead);
    out.set(this._buf.subarray(readHead, readHead + firstChunk), 0);
    if (firstChunk < available) {
      out.set(this._buf.subarray(0, available - firstChunk), firstChunk);
    }
    // Zero-pad if underrun.
    if (available < want) {
      out.fill(0, available, want);
      Atomics.add(this._state, STATE_UNDERRUNS, 1);
    }
    const frameCount = Math.floor(available / this._frameSamples);
    const frameIngressAtMs: Array<number | null> = [];
    for (let i = 0; i < frameCount; i++) {
      const sampleOffset = readHead + i * this._frameSamples;
      const frameSlot =
        Math.floor((sampleOffset % this._capacitySamples) / this._frameSamples) %
        this._ingressCapacityFrames;
      const ts = Atomics.load(this._ingressTimestamps, frameSlot);
      frameIngressAtMs.push(ts > 0 ? ts : null);
    }
    readHead = (readHead + available) % this._capacitySamples;
    Atomics.store(this._state, STATE_READ_HEAD, readHead);
    Atomics.sub(this._state, STATE_FILLED_SAMPLES, available);
    return { samplesRead: want, frameIngressAtMs };
  }

  bufferedMs(): number {
    const samplesPerMs = (this._sampleRate * this._channels) / 1000;
    return Atomics.load(this._state, STATE_FILLED_SAMPLES) / samplesPerMs;
  }

  hasData(): boolean {
    // Must have at least one full 20ms Opus frame worth of samples.
    const minSamples = Math.ceil((OPUS_FRAME_DURATION_MS / 1000) * this._sampleRate * this._channels);
    return Atomics.load(this._state, STATE_FILLED_SAMPLES) >= minSamples;
  }

  reset(): void {
    this._buf.fill(0);
    this._ingressTimestamps.fill(0);
    Atomics.store(this._state, STATE_READ_HEAD, 0);
    Atomics.store(this._state, STATE_WRITE_HEAD, 0);
    Atomics.store(this._state, STATE_FILLED_SAMPLES, 0);
    Atomics.store(this._state, STATE_UNDERRUNS, 0);
    Atomics.store(this._state, STATE_OVERRUNS, 0);
    Atomics.store(this._state, STATE_STALE_DROPS, 0);
  }

  get capacityMs(): number {
    const samplesPerMs = (this._sampleRate * this._channels) / 1000;
    return this._capacitySamples / samplesPerMs;
  }

  get filledSamples(): number {
    return Atomics.load(this._state, STATE_FILLED_SAMPLES);
  }

  oldestFrameAgeMs(nowMs: number): number {
    const filledSamples = Atomics.load(this._state, STATE_FILLED_SAMPLES);
    if (filledSamples < this._frameSamples) return 0;
    const readHead = Atomics.load(this._state, STATE_READ_HEAD);
    const frameSlot =
      Math.floor((readHead % this._capacitySamples) / this._frameSamples) %
      this._ingressCapacityFrames;
    const ingressAtMs = Atomics.load(this._ingressTimestamps, frameSlot);
    if (ingressAtMs <= 0 || !Number.isFinite(nowMs)) return 0;
    let deltaMs =
      Math.round(nowMs % SHARED_INGRESS_TIMESTAMP_MOD) - ingressAtMs;
    if (deltaMs < 0) {
      deltaMs += SHARED_INGRESS_TIMESTAMP_MOD;
    }
    return Math.max(0, deltaMs);
  }

  dropOldestFrames(frameCount: number): number {
    const framesToDrop = Math.max(0, Math.floor(frameCount));
    if (framesToDrop <= 0) return 0;
    const maxDroppableFrames = Math.floor(
      Atomics.load(this._state, STATE_FILLED_SAMPLES) / this._frameSamples
    );
    const actualFrames = Math.min(framesToDrop, maxDroppableFrames);
    if (actualFrames <= 0) return 0;
    const sampleDrop = actualFrames * this._frameSamples;
    const readHead = Atomics.load(this._state, STATE_READ_HEAD);
    const nextReadHead = (readHead + sampleDrop) % this._capacitySamples;
    Atomics.store(this._state, STATE_READ_HEAD, nextReadHead);
    Atomics.sub(this._state, STATE_FILLED_SAMPLES, sampleDrop);
    Atomics.add(this._state, STATE_STALE_DROPS, actualFrames);
    return actualFrames;
  }

  dropFramesOlderThan(maxAgeMs: number, nowMs: number): number {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(nowMs)) {
      return 0;
    }
    let dropped = 0;
    while (this.filledSamples >= this._frameSamples) {
      const oldestAgeMs = this.oldestFrameAgeMs(nowMs);
      if (oldestAgeMs <= maxAgeMs) break;
      const droppedNow = this.dropOldestFrames(1);
      if (droppedNow <= 0) break;
      dropped += droppedNow;
    }
    return dropped;
  }

  getSharedBridgeConfig(): SharedPcmRingBridgeConfig {
    return {
      sampleBuffer: this._sampleBuffer,
      stateBuffer: this._stateBuffer,
      ingressTimestampBuffer: this._ingressTimestampBuffer,
      capacitySamples: this._capacitySamples,
      sampleRateHz: this._sampleRate,
      channels: this._channels,
      frameSamples: this._frameSamples,
      ingressCapacityFrames: this._ingressCapacityFrames,
    };
  }
}
