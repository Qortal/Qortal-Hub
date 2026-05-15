import { describe, expect, it } from 'vitest';
import {
  computeN1SteadyPrimedHoldFrames,
  computeStarvedBacklogDrainBudget,
  decideReadyStallForcePrime,
  shouldCommitBurstGapRecovery,
  shouldStartBurstGapRecoveryWatch,
} from './dmVoiceGcallInboundPlayout';

describe('DmVoiceGcallInboundPlayout startup force-prime', () => {
  it('starts burst-gap watch only after post-start sustained receive gaps outside cooldown', () => {
    expect(
      shouldStartBurstGapRecoveryWatch({
        hasObservedPlayoutStart: true,
        gapMs: 950,
        nowMs: 5_000,
        lastRecoveryAtMs: 1_000,
      })
    ).toBe(true);

    expect(
      shouldStartBurstGapRecoveryWatch({
        hasObservedPlayoutStart: false,
        gapMs: 1_500,
        nowMs: 5_000,
        lastRecoveryAtMs: 1_000,
      })
    ).toBe(false);

    expect(
      shouldStartBurstGapRecoveryWatch({
        hasObservedPlayoutStart: true,
        gapMs: 500,
        nowMs: 5_000,
        lastRecoveryAtMs: 1_000,
      })
    ).toBe(false);

    expect(
      shouldStartBurstGapRecoveryWatch({
        hasObservedPlayoutStart: true,
        gapMs: 950,
        nowMs: 5_000,
        lastRecoveryAtMs: 3_000,
      })
    ).toBe(false);
  });

  it('commits burst-gap recovery only for faster-than-realtime damaged bursts', () => {
    expect(
      shouldCommitBurstGapRecovery({
        burstWindowAgeMs: 900,
        burstFrameCount: 80,
        jitterBufferedFrames: 36,
        jitterMaxEntries: 40,
        trimmedFramesDuringWatch: 4,
        pcmStarved: false,
      })
    ).toBe(true);

    expect(
      shouldCommitBurstGapRecovery({
        burstWindowAgeMs: 1_200,
        burstFrameCount: 80,
        jitterBufferedFrames: 36,
        jitterMaxEntries: 40,
        trimmedFramesDuringWatch: 4,
        pcmStarved: false,
      })
    ).toBe(false);

    expect(
      shouldCommitBurstGapRecovery({
        burstWindowAgeMs: 900,
        burstFrameCount: 80,
        jitterBufferedFrames: 16,
        jitterMaxEntries: 40,
        trimmedFramesDuringWatch: 0,
        pcmStarved: false,
      })
    ).toBe(false);
  });

  it('accelerates drain only when ready Opus backlog is high and PCM is starved', () => {
    expect(
      computeStarvedBacklogDrainBudget({
        hasReadyFrame: true,
        bufferedFrames: 40,
        maxEntries: 40,
        playoutBufferedMs: 0.3,
        preProcessBufferedMs: 0.3,
        outsideBandUnder: true,
        concealmentUsed: true,
      })
    ).toBeGreaterThan(1);

    expect(
      computeStarvedBacklogDrainBudget({
        hasReadyFrame: true,
        bufferedFrames: 40,
        maxEntries: 40,
        playoutBufferedMs: 80,
        preProcessBufferedMs: 80,
        outsideBandUnder: false,
        concealmentUsed: false,
      })
    ).toBe(1);

    expect(
      computeStarvedBacklogDrainBudget({
        hasReadyFrame: true,
        bufferedFrames: 12,
        maxEntries: 40,
        playoutBufferedMs: 0,
        preProcessBufferedMs: 0,
        outsideBandUnder: true,
        concealmentUsed: true,
      })
    ).toBe(1);
  });

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

  it('arms for a sustained multi-source ready stall with substantial fresh preroll', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 3,
        hasReadyFrame: false,
        bufferedFrames: 12,
        stallSinceMs: null,
        nowMs: 1000,
        lastPushAgeMs: 40,
        targetPlayoutMs: 185,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: 1000,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 3,
        hasReadyFrame: false,
        bufferedFrames: 12,
        stallSinceMs: 1000,
        nowMs: 1600,
        lastPushAgeMs: 40,
        targetPlayoutMs: 185,
      })
    ).toEqual({
      shouldForcePrime: true,
      nextStallSinceMs: null,
    });
  });

  it('does not arm multi-source force-prime for thin or stale preroll', () => {
    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 2,
        hasReadyFrame: false,
        bufferedFrames: 9,
        stallSinceMs: 1000,
        nowMs: 1700,
        lastPushAgeMs: 40,
        targetPlayoutMs: 185,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: null,
    });

    expect(
      decideReadyStallForcePrime({
        hasObservedPlayoutStart: false,
        activeSourceCount: 2,
        hasReadyFrame: false,
        bufferedFrames: 12,
        stallSinceMs: 1000,
        nowMs: 1700,
        lastPushAgeMs: 400,
        targetPlayoutMs: 185,
      })
    ).toEqual({
      shouldForcePrime: false,
      nextStallSinceMs: null,
    });
  });
});
