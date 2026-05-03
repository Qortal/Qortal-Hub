import { describe, expect, it } from 'vitest';
import { decideReadyStallForcePrime } from './dmVoiceGcallInboundPlayout';

describe('DmVoiceGcallInboundPlayout startup force-prime', () => {
  it('arms after a 1:1 hidden playout startup stall with enough buffered frames', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 12,
        stallSinceMs: null,
        nowMs: 1000,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: 1000,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 12,
        stallSinceMs: 1000,
        nowMs: 1300,
      })
    ).toEqual({
      shouldForcePrime: true,
      nextStallSinceMs: null,
    });
  });

  it('arms after a sustained post-start 1:1 ready stall with enough buffered frames', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 4,
        stallSinceMs: 1000,
        nowMs: 1150,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: 1000,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 4,
        stallSinceMs: 1000,
        nowMs: 1205,
      })
    ).toEqual({
      shouldForcePrime: true,
      nextStallSinceMs: null,
    });
  });

  it('does not arm when the path is not a one-source buffered ready stall', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 2,
        hasReadyFrame: false,
        bufferedFrames: 12,
        stallSinceMs: 1000,
        nowMs: 1300,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: null,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 1,
        hasReadyFrame: true,
        bufferedFrames: 12,
        stallSinceMs: 1000,
        nowMs: 1300,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: null,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 4,
        stallSinceMs: 1000,
        nowMs: 1190,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: 1000,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 3,
        stallSinceMs: 1000,
        nowMs: 1400,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: null,
    });
  });
});
