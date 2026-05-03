import { describe, expect, it, vi } from 'vitest';
import { JitterBuffer } from './gcallJitterBuffer';

describe('gcallJitterBuffer', () => {
  it('reports accepted, duplicate, stale, and trimmed push results', () => {
    const jb = new JitterBuffer();

    expect(jb.push(1, new Uint8Array([1]))).toEqual({
      status: 'accepted',
      depth: 1,
      trimmed: 0,
    });
    expect(jb.push(1, new Uint8Array([1]))).toEqual({
      status: 'duplicate',
      depth: 1,
      trimmed: 0,
    });

    jb.forcePrimeForRecoveryEscape();
    expect(jb.pop()).toEqual(new Uint8Array([1]));
    expect(jb.push(1, new Uint8Array([1]))).toEqual({
      status: 'stale',
      depth: 0,
      trimmed: 0,
    });

    for (let seq = 2; seq <= 14; seq++) {
      jb.push(seq, new Uint8Array([seq]));
    }
    expect(jb.getBufferedFrames()).toBe(12);
    expect(jb.push(15, new Uint8Array([15]))).toEqual({
      status: 'accepted',
      depth: 12,
      trimmed: 1,
    });
  });

  it('can force-prime a live one-frame buffer for exact-1-remote recovery escape', () => {
    const jb = new JitterBuffer();
    jb.push(1, new Uint8Array([1, 2, 3]));

    expect(jb.getBufferedFrames()).toBe(1);
    expect(jb.hasReadyFrame()).toBe(false);

    jb.forcePrimeForRecoveryEscape();

    expect(jb.hasReadyFrame()).toBe(true);
    expect(jb.pop()).toEqual(new Uint8Array([1, 2, 3]));
    expect(jb.getBufferedFrames()).toBe(0);
  });

  it('with steadyPrimedHoldFrames=1 (N=1 group recovery), needs 2 frames after forcePrime before ready', () => {
    const jb = new JitterBuffer();
    jb.setSteadyPrimedHoldFrames(1);
    jb.push(1, new Uint8Array([1, 2, 3]));
    expect(jb.hasReadyFrame()).toBe(false);
    jb.forcePrimeForRecoveryEscape();
    expect(jb.getBufferedFrames()).toBe(1);
    expect(jb.hasReadyFrame()).toBe(false);
    jb.push(2, new Uint8Array([4, 5, 6]));
    expect(jb.hasReadyFrame()).toBe(true);
    expect(jb.pop()).toEqual(new Uint8Array([1, 2, 3]));
    expect(jb.getBufferedFrames()).toBe(1);
    expect(jb.hasReadyFrame()).toBe(false);
  });

  it('does nothing when recovery escape tries to prime an empty buffer', () => {
    const jb = new JitterBuffer();

    jb.forcePrimeForRecoveryEscape();

    expect(jb.getBufferedFrames()).toBe(0);
    expect(jb.hasReadyFrame()).toBe(false);
    expect(jb.pop()).toBe(null);
  });

  it('burst-recovery extra hold defers pops so late-decrypt frames are not dropped as stale', () => {
    const jb = new JitterBuffer();
    jb.setBurstRecoveryExtraHoldFrames(4);
    jb.setSteadyPrimedHoldFrames(1);

    // Worker delivers first 3 of a 5-frame preroll burst; pop must not start
    // yet (unprimed threshold = jitterStartBufferSize + burstHold).
    for (let seq = 1; seq <= 3; seq++) {
      jb.push(seq, new Uint8Array([seq]));
    }
    expect(jb.hasReadyFrame()).toBe(false);
    expect(jb.pop()).toBe(null);

    // Worker catches up with frames 4 and 5; force-prime to approximate the
    // early-release escape path but the burst hold should still keep pop
    // deferred while the buffered depth is under the hold threshold.
    jb.push(4, new Uint8Array([4]));
    jb.push(5, new Uint8Array([5]));
    jb.forcePrimeForRecoveryEscape();
    expect(jb.hasReadyFrame()).toBe(false);

    // A late-decrypt completion for seq=2 would have been stale without the
    // hold; with the hold active, pop has not advanced, so the in-order frame
    // is still eligible to play (the test re-pushes to prove push-after-prime
    // for a seq we have not yet popped is still `duplicate`, not `stale`).
    expect(jb.push(2, new Uint8Array([2]))).toEqual({
      status: 'duplicate',
      depth: 5,
      trimmed: 0,
    });

    // Once the buffer reaches the burst-hold threshold, pops proceed in order.
    jb.push(6, new Uint8Array([6]));
    expect(jb.hasReadyFrame()).toBe(true);
    expect(jb.pop()).toEqual(new Uint8Array([1]));
  });

  it('clearing burst-recovery hold restores the normal primed threshold', () => {
    const jb = new JitterBuffer();
    jb.setBurstRecoveryExtraHoldFrames(4);
    jb.setSteadyPrimedHoldFrames(1);
    for (let seq = 1; seq <= 2; seq++) {
      jb.push(seq, new Uint8Array([seq]));
    }
    jb.forcePrimeForRecoveryEscape();
    expect(jb.hasReadyFrame()).toBe(false);

    jb.setBurstRecoveryExtraHoldFrames(0);
    // Primed + steadyPrimedHoldFrames=1 → 2 frames suffice.
    expect(jb.hasReadyFrame()).toBe(true);
    expect(jb.pop()).toEqual(new Uint8Array([1]));
  });

  it('clear() resets the burst-recovery hold', () => {
    const jb = new JitterBuffer();
    jb.setBurstRecoveryExtraHoldFrames(4);
    expect(jb.getBurstRecoveryExtraHoldFrames()).toBe(4);
    jb.clear();
    expect(jb.getBurstRecoveryExtraHoldFrames()).toBe(0);
  });

  it('keeps a recovery-escape prime sticky for a short window so a one-source path does not immediately fall back to the full startup threshold', () => {
    vi.useFakeTimers();
    const jb = new JitterBuffer();
    jb.push(1, new Uint8Array([1]));
    jb.forcePrimeForRecoveryEscape(5000);
    expect(jb.hasReadyFrame()).toBe(true);
    expect(jb.pop()).toEqual(new Uint8Array([1]));

    vi.advanceTimersByTime(2000);
    jb.push(2, new Uint8Array([2]));
    expect(jb.hasReadyFrame()).toBe(true);
    expect(jb.pop()).toEqual(new Uint8Array([2]));

    vi.advanceTimersByTime(3500);
    jb.push(3, new Uint8Array([3]));
    expect(jb.hasReadyFrame()).toBe(false);
    vi.useRealTimers();
  });
});
