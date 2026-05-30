import { describe, expect, it } from 'vitest';
import {
  computeMasterGainTarget,
  computePerSpeakerGainTarget,
  computeRecentSpeakerEstimate,
  computeRecentSpeakerEstimateExcluding,
  shouldUpdateAudioMix,
} from './audioMix';

describe('audioMix', () => {
  it('counts recent speakers without UI caps', () => {
    const speakers = new Map<string, number>([
      ['a', 10_000],
      ['b', 10_050],
      ['c', 10_100],
      ['d', 10_200],
    ]);
    expect(computeRecentSpeakerEstimate(speakers, 11_400, 1_500)).toBe(4);
  });

  it('can exclude local speaker activity from playback mix counts', () => {
    const speakers = new Map<string, number>([
      ['local', 10_000],
      ['remote-a', 10_050],
      ['remote-b', 10_100],
    ]);
    expect(
      computeRecentSpeakerEstimateExcluding(
        speakers,
        11_200,
        new Set(['local']),
        1_500
      )
    ).toBe(2);
    expect(
      computeRecentSpeakerEstimateExcluding(
        speakers,
        11_200,
        new Set(['local', 'remote-b']),
        1_500
      )
    ).toBe(1);
  });

  it('preserves single-speaker loudness for active speakers', () => {
    expect(
      computePerSpeakerGainTarget({
        recentSpeakerEstimate: 1,
        lastVadAtMs: 1_000,
        nowMs: 1_100,
      })
    ).toBe(1);
    expect(computeMasterGainTarget(1)).toBe(1);
  });

  it('attenuates multi-speaker and inactive speakers', () => {
    expect(
      computePerSpeakerGainTarget({
        recentSpeakerEstimate: 3,
        lastVadAtMs: 1_000,
        nowMs: 1_200,
      })
    ).toBe(0.78);
    expect(
      computePerSpeakerGainTarget({
        recentSpeakerEstimate: 3,
        lastVadAtMs: 1_000,
        nowMs: 1_400,
      })
    ).toBe(0.12);
  });

  it('applies master-gain floor and scaling predictably', () => {
    expect(computeMasterGainTarget(2)).toBeCloseTo(0.671751, 5);
    expect(computeMasterGainTarget(3)).toBe(0.55);
    expect(computeMasterGainTarget(10)).toBe(0.55);
  });

  it('uses cadence-based throttling for gain updates', () => {
    expect(shouldUpdateAudioMix(0, 119, 120)).toBe(false);
    expect(shouldUpdateAudioMix(0, 120, 120)).toBe(true);
  });
});
