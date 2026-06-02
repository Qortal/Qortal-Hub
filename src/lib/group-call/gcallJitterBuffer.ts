/**
 * Shared jitter buffer for group voice and DM Reticulum voice (same reorder/prime logic).
 */

import { GCALL_JITTER_SOFT_UNPRIME_MS } from './groupCallAudioProfile';
import { gcallSeqIsAfter } from './gcallSequence';

const DEFAULT_JITTER_BUFFER_SIZE = 6;
const DEFAULT_JITTER_START_BUFFER_SIZE = 4;

interface JitterEntry {
  seq: number;
  opusFrame: Uint8Array;
  receivedAt: number;
}

export type JitterPushStatus = 'accepted' | 'stale' | 'duplicate';

export interface JitterPushResult {
  status: JitterPushStatus;
  depth: number;
  trimmed: number;
}

export function computeJitterReadyThresholdFrames(opts: {
  primed: boolean;
  jitterStartBufferSize: number;
  extraHoldFrames?: number;
  steadyPrimedHoldFrames?: number;
  /**
   * Additive hold while a decrypt-burst recovery window is active.
   * Protects late-decrypted frames from being rejected as `stale` by keeping
   * `lastPlayedSeq` from advancing past them before they land.
   */
  burstRecoveryExtraHoldFrames?: number;
}): number {
  const extraHoldFrames = Math.max(0, opts.extraHoldFrames ?? 0);
  const steadyPrimedHoldFrames = Math.max(0, opts.steadyPrimedHoldFrames ?? 0);
  const burstRecoveryExtraHoldFrames = Math.max(
    0,
    opts.burstRecoveryExtraHoldFrames ?? 0
  );
  const base = opts.primed
    ? 1 + steadyPrimedHoldFrames
    : opts.jitterStartBufferSize;
  return base + extraHoldFrames + burstRecoveryExtraHoldFrames;
}

export class JitterBuffer {
  private entries: JitterEntry[] = [];
  private lastPlayedSeq = -1;
  private pendingMissedSeq = 0;
  private trimSuppressedGapDebt = 0;
  private lastPoppedReceivedAtMs: number | null = null;
  private primed = false;
  /** When buffer became empty after `pop`; delays resetting `primed` (Phase C/D soft un-prime). */
  private emptySinceMs: number | null = null;
  /** Phase D: scaled via `setSoftUnprimeMs` (tier-2 multi-source). */
  private softUnprimeMs = GCALL_JITTER_SOFT_UNPRIME_MS;
  /** Optional sticky-primed window after an explicit recovery escape prime. */
  private forcePrimedUntilMs = 0;
  /** Exact-1-remote steady-state floor after priming; keeps the Opus side off the 1-frame edge. */
  private steadyPrimedHoldFrames = 0;
  /**
   * Additive hold active while a decrypt-burst recovery window is armed.
   * Prevents pops from advancing `lastPlayedSeq` past frames that are still
   * being decrypted on the worker; protects against the "late-decrypt stale"
   * loss mode at call start and after key/topology re-syncs.
   */
  private burstRecoveryExtraHoldFrames = 0;
  /** Raw seq gap for the last pop (for WASM FEC); cleared by consumeLastRawGapAfterPop. */
  private lastRawGapAfterPop = 0;
  private jitterBufferSize: number;
  private jitterStartBufferSize: number;

  constructor(
    private readonly extraHoldFrames = 0,
    tuning?: { jitterBufferSize: number; jitterStartBufferSize: number }
  ) {
    this.jitterBufferSize =
      tuning?.jitterBufferSize ?? DEFAULT_JITTER_BUFFER_SIZE;
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
   * Set the additive hold used during active decrypt-burst recovery windows.
   * Pass 0 to clear it when the window ends. Applies to both unprimed startup
   * and steady-state pops (i.e. re-armed mid-call), so late-decrypted frames
   * have a chance to land before `lastPlayedSeq` advances past them.
   */
  setBurstRecoveryExtraHoldFrames(frames: number): number {
    if (Number.isFinite(frames)) {
      const requested = Math.max(0, Math.trunc(frames));
      const unprimedBaseThreshold = computeJitterReadyThresholdFrames({
        primed: false,
        jitterStartBufferSize: this.jitterStartBufferSize,
        extraHoldFrames: this.extraHoldFrames,
        steadyPrimedHoldFrames: this.steadyPrimedHoldFrames,
        burstRecoveryExtraHoldFrames: 0,
      });
      const maxFeasible = Math.max(
        0,
        this.getMaxEntries() - unprimedBaseThreshold
      );
      this.burstRecoveryExtraHoldFrames = Math.min(requested, maxFeasible);
    }
    return this.burstRecoveryExtraHoldFrames;
  }

  getBurstRecoveryExtraHoldFrames(): number {
    return this.burstRecoveryExtraHoldFrames;
  }

  /**
   * Highest seq this buffer has handed to the Opus decoder ("played"). Returns -1 if no
   * frame has been popped yet. Consumed by the decrypt-worker pool's stale-seq pre-skip:
   * incoming packets not newer than `lastPlayedSeq` would be rejected on push anyway.
   */
  getLastPlayedSeq(): number {
    return this.lastPlayedSeq;
  }

  /**
   * Exact-1-remote recovery can intentionally leave preroll before the normal
   * unprimed threshold. Mark the buffer primed so a live one-frame trickle can
   * actually drain on the next tick instead of remaining stuck below threshold.
   */
  forcePrimeForRecoveryEscape(
    holdPrimedMs = 0,
    options?: { clearBurstRecoveryHold?: boolean }
  ): void {
    if (this.entries.length <= 0) return;
    this.primed = true;
    if (options?.clearBurstRecoveryHold !== false) {
      this.burstRecoveryExtraHoldFrames = 0;
    }
    this.emptySinceMs = null;
    if (holdPrimedMs > 0 && Number.isFinite(holdPrimedMs)) {
      this.forcePrimedUntilMs = Math.max(
        this.forcePrimedUntilMs,
        performance.now() + holdPrimedMs
      );
    }
  }

  private checkSoftUnprime(): void {
    if (this.emptySinceMs === null) return;
    if (this.entries.length > 0) {
      this.emptySinceMs = null;
      return;
    }
    if (
      this.primed &&
      performance.now() >= this.forcePrimedUntilMs &&
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

  consumeLastPoppedReceivedAtMs(): number | null {
    const value = this.lastPoppedReceivedAtMs;
    this.lastPoppedReceivedAtMs = null;
    return value;
  }

  push(seq: number, opusFrame: Uint8Array): JitterPushResult {
    this.checkSoftUnprime();
    if (!gcallSeqIsAfter(seq, this.lastPlayedSeq)) {
      return { status: 'stale', depth: this.entries.length, trimmed: 0 };
    }
    let insertAt = this.entries.length;
    while (insertAt > 0) {
      const prev = this.entries[insertAt - 1];
      if (prev.seq === seq) {
        return { status: 'duplicate', depth: this.entries.length, trimmed: 0 };
      }
      if (!gcallSeqIsAfter(prev.seq, seq)) break;
      insertAt--;
    }
    this.entries.splice(insertAt, 0, {
      seq,
      opusFrame,
      receivedAt: Date.now(),
    });
    this.emptySinceMs = null;
    const maxEntries = this.jitterBufferSize * 2;
    let trimmed = 0;
    if (this.entries.length > maxEntries) {
      trimmed = this.entries.length - maxEntries;
      this.entries.splice(0, trimmed);
      if (this.lastPlayedSeq >= 0) {
        this.trimSuppressedGapDebt += trimmed;
      }
    }
    return { status: 'accepted', depth: this.entries.length, trimmed };
  }

  /**
   * Drop oldest queued frames intentionally to shed latency after recovery has
   * overfilled the jitter queue. The skipped seqs are treated like capacity
   * trims, so the next pop does not report them as unexpected missing frames.
   */
  discardOldest(count: number): number {
    this.checkSoftUnprime();
    const n = Math.max(
      0,
      Math.min(
        this.entries.length,
        Number.isFinite(count) ? Math.trunc(count) : 0
      )
    );
    if (n <= 0) return 0;
    this.entries.splice(0, n);
    if (this.lastPlayedSeq >= 0) {
      this.trimSuppressedGapDebt += n;
    }
    if (this.entries.length === 0) {
      this.emptySinceMs = performance.now();
    }
    return n;
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
      burstRecoveryExtraHoldFrames: this.burstRecoveryExtraHoldFrames,
    });
    if (this.entries.length < threshold) return null;
    const entry = this.entries.shift();
    if (!entry) return null;
    this.primed = true;
    this.lastPoppedReceivedAtMs = entry.receivedAt;
    if (this.lastPlayedSeq >= 0) {
      const expected = (this.lastPlayedSeq + 1) & 0xffff;
      const gap = (entry.seq - expected + 65536) % 65536;
      this.lastRawGapAfterPop = gap;
      const trimSuppressedGap = Math.min(gap, this.trimSuppressedGapDebt);
      if (trimSuppressedGap > 0) {
        this.trimSuppressedGapDebt -= trimSuppressedGap;
      }
      const unexpectedGap = gap - trimSuppressedGap;
      if (unexpectedGap > 0 && unexpectedGap <= 48) {
        this.pendingMissedSeq += unexpectedGap;
      }
    } else {
      this.lastRawGapAfterPop = 0;
      this.trimSuppressedGapDebt = 0;
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
        burstRecoveryExtraHoldFrames: this.burstRecoveryExtraHoldFrames,
      })
    );
  }

  getBufferedFrames(): number {
    return this.entries.length;
  }

  getMaxEntries(): number {
    return this.jitterBufferSize * 2;
  }

  clear(): void {
    this.entries = [];
    this.lastPlayedSeq = -1;
    this.pendingMissedSeq = 0;
    this.trimSuppressedGapDebt = 0;
    this.lastPoppedReceivedAtMs = null;
    this.primed = false;
    this.emptySinceMs = null;
    this.lastRawGapAfterPop = 0;
    this.softUnprimeMs = GCALL_JITTER_SOFT_UNPRIME_MS;
    this.steadyPrimedHoldFrames = 0;
    this.burstRecoveryExtraHoldFrames = 0;
    this.forcePrimedUntilMs = 0;
  }
}
