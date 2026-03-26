import { describe, expect, it } from 'vitest';
import {
  bumpGroupCallAudioSessionToken,
  clearAdaptiveGroupCallPlayoutMaps,
  isCurrentGroupCallAudioStartupToken,
  shouldStartGroupCallAudioCapture,
} from './useGroupVoiceCall';

describe('useGroupVoiceCall lifecycle helpers', () => {
  it('suppresses startup when pipeline is active or startup is in flight', () => {
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: false, startupInFlight: false })
    ).toBe(true);
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: true, startupInFlight: false })
    ).toBe(false);
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: false, startupInFlight: true })
    ).toBe(false);
    expect(
      shouldStartGroupCallAudioCapture({ pipelineActive: true, startupInFlight: true })
    ).toBe(false);
  });

  it('uses monotonic tokens to invalidate stale async startups', () => {
    const tokenA = bumpGroupCallAudioSessionToken(0);
    const tokenB = bumpGroupCallAudioSessionToken(tokenA);

    expect(isCurrentGroupCallAudioStartupToken(tokenA, tokenA)).toBe(true);
    expect(isCurrentGroupCallAudioStartupToken(tokenA, tokenB)).toBe(false);
    expect(tokenB).toBeGreaterThan(tokenA);
  });

  it('clears all adaptive playout maps during cleanup', () => {
    const lastPacketArrivalAt = new Map([['alice', 10]]);
    const interArrivalSamples = new Map([['alice', [20, 22]]]);
    const smoothedPlayoutTarget = new Map([['alice', 95]]);
    const lastSentPlayoutTarget = new Map([['alice', 90]]);
    const lastPlayoutTargetPostAt = new Map([['alice', 1234]]);
    const lastDrainMissed = new Map([['alice', 2]]);

    clearAdaptiveGroupCallPlayoutMaps({
      lastPacketArrivalAt,
      interArrivalSamples,
      smoothedPlayoutTarget,
      lastSentPlayoutTarget,
      lastPlayoutTargetPostAt,
      lastDrainMissed,
    });

    expect(lastPacketArrivalAt.size).toBe(0);
    expect(interArrivalSamples.size).toBe(0);
    expect(smoothedPlayoutTarget.size).toBe(0);
    expect(lastSentPlayoutTarget.size).toBe(0);
    expect(lastPlayoutTargetPostAt.size).toBe(0);
    expect(lastDrainMissed.size).toBe(0);
  });
});
