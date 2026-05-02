import { describe, expect, it } from 'vitest';
import { decideStartupForcePrime } from './dmVoiceGcallInboundPlayout';

describe('DmVoiceGcallInboundPlayout startup force-prime', () => {
  it('arms after a 1:1 hidden playout startup stall with enough buffered frames', () => {
    expect(
      decideStartupForcePrime({
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
      decideStartupForcePrime({
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

  it('does not arm once playout has already started or the path is not a 1:1 startup stall', () => {
    expect(
      decideStartupForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
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
      decideStartupForcePrime({
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
      decideStartupForcePrime({
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
  });
});
