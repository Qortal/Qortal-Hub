import { describe, expect, it } from 'vitest';
import {
  computeN1SteadyPrimedHoldFrames,
  decideReadyStallForcePrime,
} from './dmVoiceGcallInboundPlayout';

describe('DmVoiceGcallInboundPlayout startup force-prime', () => {
  it('holds a 2-frame steady reserve for post-start 1:1 recovery only while the source is recently pushing and already ready', () => {
    expect(
      computeN1SteadyPrimedHoldFrames({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        hasObservedPlayoutStart: true,
        hasReadyFrame: true,
        bufferedFrames: 2,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
      })
    ).toBe(1);

    expect(
      computeN1SteadyPrimedHoldFrames({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        hasObservedPlayoutStart: true,
        hasReadyFrame: false,
        bufferedFrames: 1,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
      })
    ).toBe(0);

    expect(
      computeN1SteadyPrimedHoldFrames({
        activeSourceCount: 1,
        adaptiveNetworkMode: 'recovery',
        hasObservedPlayoutStart: true,
        hasReadyFrame: true,
        bufferedFrames: 2,
        lastPushAgeMs: 200,
        targetPlayoutMs: 145,
      })
    ).toBe(0);
  });

  it('arms after a 1:1 startup stall when recent buffered opus satisfies the N=1 preroll escape', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 3,
        stallSinceMs: null,
        nowMs: 1000,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
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
        bufferedFrames: 3,
        stallSinceMs: 1000,
        nowMs: 1200,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
      })
    ).toEqual({
      shouldForcePrime: true,
      nextStallSinceMs: null,
    });
  });

  it('arms after a sustained post-start 1:1 ready stall from the steady reserve gate', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 2,
        stallSinceMs: 1000,
        nowMs: 1150,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
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
        bufferedFrames: 2,
        stallSinceMs: 1000,
        nowMs: 1205,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
      })
    ).toEqual({
      shouldForcePrime: true,
      nextStallSinceMs: null,
    });
  });

  it('allows a severe post-start one-frame deadlock escape after a longer stall', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: true,
        activeSourceCount: 1,
        hasReadyFrame: false,
        bufferedFrames: 1,
        stallSinceMs: 1000,
        nowMs: 1500,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
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
        bufferedFrames: 3,
        stallSinceMs: 1000,
        nowMs: 1300,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
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
        bufferedFrames: 3,
        stallSinceMs: 1000,
        nowMs: 1300,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
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
        bufferedFrames: 2,
        stallSinceMs: 1000,
        nowMs: 1170,
        lastPushAgeMs: 40,
        targetPlayoutMs: 145,
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
        bufferedFrames: 2,
        stallSinceMs: 1000,
        nowMs: 1400,
        lastPushAgeMs: 180,
        targetPlayoutMs: 145,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: 1000,
    });
  });
});
