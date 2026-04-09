/**
 * Shared jitter buffer for group voice and DM Reticulum voice (same reorder/prime logic).
 */

import { GCALL_JITTER_SOFT_UNPRIME_MS } from './groupCallAudioProfile';

const DEFAULT_JITTER_BUFFER_SIZE = 6;
const DEFAULT_JITTER_START_BUFFER_SIZE = 4;

interface JitterEntry {
  seq: number;
  opusFrame: Uint8Array;
  receivedAt: number;
}

export function computeJitterReadyThresholdFrames(opts: {
  primed: boolean;
  jitterStartBufferSize: number;
  extraHoldFrames?: number;
  steadyPrimedHoldFrames?: number;
}): number {
  const extraHoldFrames = Math.max(0, opts.extraHoldFrames ?? 0);
  const steadyPrimedHoldFrames = Math.max(0, opts.steadyPrimedHoldFrames ?? 0);
  const base = opts.primed
    ? 1 + steadyPrimedHoldFrames
    : opts.jitterStartBufferSize;
  return base + extraHoldFrames;
}

export class JitterBuffer {
  private entries: JitterEntry[] = [];
  private lastPlayedSeq = -1;
  private pendingMissedSeq = 0;
  private primed = false;
  /** When buffer became empty after `pop`; delays resetting `primed` (Phase C/D soft un-prime). */
  private emptySinceMs: number | null = null;
  /** Phase D: scaled via `setSoftUnprimeMs` (tier-2 multi-source). */
  private softUnprimeMs = GCALL_JITTER_SOFT_UNPRIME_MS;
  /** Exact-1-remote steady-state floor after priming; keeps the Opus side off the 1-frame edge. */
  private steadyPrimedHoldFrames = 0;
  /** Raw seq gap for the last pop (for WASM FEC); cleared by consumeLastRawGapAfterPop. */
  private lastRawGapAfterPop = 0;
  private jitterBufferSize: number;
  private jitterStartBufferSize: number;

  constructor(
    private readonly extraHoldFrames = 0,
    tuning?: { jitterBufferSize: number; jitterStartBufferSize: number }
  ) {
    this.jitterBufferSize = tuning?.jitterBufferSize ?? DEFAULT_JITTER_BUFFER_SIZE;
    this.jitterStartBufferSize =
      tuning?.jitterStartBufferSize ?? DEFAULT_JITTER_START_BUFFER_SIZE;
  }

  applyJitterTuning(tuning: {
    jitterBufferSize: number;
    jitterStartBufferSize: number;
  }): void {
    this.jitterBufferSize = tuning.jitterBufferSize;
    this.jitterStartBufferSize = tuning.jitterStartBufferSize;
  }

  setSoftUnprimeMs(ms: number): void {
    if (ms > 0 && Number.isFinite(ms)) {
      this.softUnprimeMs = ms;
    }
  }

  setSteadyPrimedHoldFrames(frames: number): void {
    if (Number.isFinite(frames)) {
      this.steadyPrimedHoldFrames = Math.max(0, Math.trunc(frames));
    }
  }

  /**
   * Exact-1-remote recovery can intentionally leave preroll before the normal
   * unprimed threshold. Mark the buffer primed so a live one-frame trickle can
   * actually drain on the next tick instead of remaining stuck below threshold.
   */
  forcePrimeForRecoveryEscape(): void {
    if (this.entries.length <= 0) return;
    this.primed = true;
    this.emptySinceMs = null;
  }

  private checkSoftUnprime(): void {
    if (this.emptySinceMs === null) return;
    if (this.entries.length > 0) {
      this.emptySinceMs = null;
      return;
    }
    if (
      this.primed &&
      performance.now() - this.emptySinceMs >= this.softUnprimeMs
    ) {
      this.primed = false;
      this.emptySinceMs = null;
    }
  }

  /** Pop-side gap detection: call after pop; returns missed frame count since last pop. */
  consumePendingMissedFrames(): number {
    const m = this.pendingMissedSeq;
    this.pendingMissedSeq = 0;
    return m;
  }

  push(seq: number, opusFrame: Uint8Array): void {
    this.checkSoftUnprime();
    if (seq <= this.lastPlayedSeq) return; // already played or older
    let insertAt = this.entries.length;
    while (insertAt > 0) {
      const prev = this.entries[insertAt - 1];
      if (prev.seq === seq) return; // duplicate
      if (prev.seq < seq) break;
      insertAt--;
    }
    this.entries.splice(insertAt, 0, {
      seq,
      opusFrame,
      receivedAt: performance.now(),
    });
    this.emptySinceMs = null;
    const maxEntries = this.jitterBufferSize * 2;
    if (this.entries.length > maxEntries) {
      this.entries.splice(0, this.entries.length - maxEntries);
    }
  }

  /** Raw (mod 65536) seq gap before the frame just popped; 0 if first packet or no prior seq. */
  consumeLastRawGapAfterPop(): number {
    const g = this.lastRawGapAfterPop;
    this.lastRawGapAfterPop = 0;
    return g;
  }

  /** Returns next frame to play, or null if buffer not ready. */
  pop(): Uint8Array | null {
    this.checkSoftUnprime();
    const threshold = computeJitterReadyThresholdFrames({
      primed: this.primed,
      jitterStartBufferSize: this.jitterStartBufferSize,
      extraHoldFrames: this.extraHoldFrames,
      steadyPrimedHoldFrames: this.steadyPrimedHoldFrames,
    });
    if (this.entries.length < threshold) return null;
    const entry = this.entries.shift();
    if (!entry) return null;
    this.primed = true;
    if (this.lastPlayedSeq >= 0) {
      const expected = (this.lastPlayedSeq + 1) & 0xffff;
      const gap = (entry.seq - expected + 65536) % 65536;
      this.lastRawGapAfterPop = gap;
      if (gap > 0 && gap <= 48) this.pendingMissedSeq += gap;
    } else {
      this.lastRawGapAfterPop = 0;
    }
    this.lastPlayedSeq = entry.seq;
    if (this.entries.length === 0) {
      this.emptySinceMs = performance.now();
    } else {
      this.emptySinceMs = null;
    }
    return entry.opusFrame;
  }

  hasReadyFrame(): boolean {
    this.checkSoftUnprime();
    return (
      this.entries.length >=
      computeJitterReadyThresholdFrames({
        primed: this.primed,
        jitterStartBufferSize: this.jitterStartBufferSize,
        extraHoldFrames: this.extraHoldFrames,
        steadyPrimedHoldFrames: this.steadyPrimedHoldFrames,
      })
    );
  }

  getBufferedFrames(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.lastPlayedSeq = -1;
    this.pendingMissedSeq = 0;
    this.primed = false;
    this.emptySinceMs = null;
    this.lastRawGapAfterPop = 0;
    this.softUnprimeMs = GCALL_JITTER_SOFT_UNPRIME_MS;
    this.steadyPrimedHoldFrames = 0;
  }
}
