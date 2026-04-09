import { describe, expect, it } from 'vitest';
import { JitterBuffer } from './gcallJitterBuffer';

describe('gcallJitterBuffer', () => {
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

  it('does nothing when recovery escape tries to prime an empty buffer', () => {
    const jb = new JitterBuffer();

    jb.forcePrimeForRecoveryEscape();

    expect(jb.getBufferedFrames()).toBe(0);
    expect(jb.hasReadyFrame()).toBe(false);
    expect(jb.pop()).toBe(null);
  });
});
