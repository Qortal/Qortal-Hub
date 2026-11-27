/**
 * Tests for read-watermark selection.
 *
 * The invariant under test: a watermark may never sit ahead of the newest event
 * it is meant to cover. Watermarks are compared against sender-stamped event
 * timestamps, so anchoring them to the local clock (`Date.now()`) strands any
 * message from a sender whose clock runs fast as permanently unread — which
 * shows up as a missing unread badge while notifications still fire.
 */

import { describe, expect, it } from 'vitest';
import {
  clampReadWatermark,
  resolveChannelReadWatermark,
  resolveChannelReadWatermarkFromSummaries,
} from './qChatReadWatermark';

describe('resolveChannelReadWatermark', () => {
  it('uses the newest event timestamp', () => {
    expect(
      resolveChannelReadWatermark({
        lastEvent: { timestamp: 1_700_000_000_000 },
      })
    ).toBe(1_700_000_000_000);
  });

  it('returns the greatest of event, read-through, and updatedAt', () => {
    expect(
      resolveChannelReadWatermark({
        lastEvent: { timestamp: 100 },
        readThroughTimestamp: 300,
        updatedAt: 200,
      })
    ).toBe(300);
  });

  it('returns 0 when nothing is known', () => {
    expect(resolveChannelReadWatermark(null)).toBe(0);
    expect(resolveChannelReadWatermark(undefined)).toBe(0);
    expect(resolveChannelReadWatermark({})).toBe(0);
  });

  it('ignores non-finite and non-positive candidates', () => {
    expect(
      resolveChannelReadWatermark({
        lastEvent: { timestamp: Number.NaN },
        readThroughTimestamp: -5,
        updatedAt: 0,
      })
    ).toBe(0);
  });
});

describe('resolveChannelReadWatermarkFromSummaries', () => {
  const summaries = {
    '7': {
      channels: [
        { channelId: 'general', lastEvent: { timestamp: 500 }, updatedAt: 500 },
        { channelId: 'random', lastEvent: { timestamp: 900 }, updatedAt: 900 },
      ],
    },
  };

  it('picks the watermark for the requested channel only', () => {
    expect(
      resolveChannelReadWatermarkFromSummaries(summaries, 7, 'general')
    ).toBe(500);
    expect(
      resolveChannelReadWatermarkFromSummaries(summaries, 7, 'random')
    ).toBe(900);
  });

  it('returns null for an unknown channel', () => {
    expect(
      resolveChannelReadWatermarkFromSummaries(summaries, 7, 'missing')
    ).toBeNull();
  });

  it('returns null for an unknown group', () => {
    expect(
      resolveChannelReadWatermarkFromSummaries(summaries, 8, 'general')
    ).toBeNull();
  });

  it('returns null when summaries are absent', () => {
    expect(
      resolveChannelReadWatermarkFromSummaries(null, 7, 'general')
    ).toBeNull();
    expect(
      resolveChannelReadWatermarkFromSummaries({}, 7, 'general')
    ).toBeNull();
  });

  it('returns null for a channel with no event data', () => {
    expect(
      resolveChannelReadWatermarkFromSummaries(
        { '7': { channels: [{ channelId: 'general' }] } },
        7,
        'general'
      )
    ).toBeNull();
  });

  it('never returns a wall-clock value', () => {
    const now = Date.now();
    const watermark = resolveChannelReadWatermarkFromSummaries(
      {
        '7': {
          channels: [{ channelId: 'general', lastEvent: { timestamp: 1 } }],
        },
      },
      7,
      'general'
    );
    expect(watermark).toBe(1);
    expect(watermark).toBeLessThan(now);
  });
});

describe('clampReadWatermark', () => {
  it('clamps a future-dated request to the newest known event', () => {
    // The reported bug: a wall-clock watermark ahead of the newest message.
    const requested = Date.now() + 5 * 60_000;
    expect(clampReadWatermark(requested, 1_700_000_000_000)).toBe(
      1_700_000_000_000
    );
  });

  it('leaves a request below the newest event untouched', () => {
    expect(clampReadWatermark(100, 900)).toBe(100);
  });

  it('accepts a request exactly at the newest event', () => {
    expect(clampReadWatermark(900, 900)).toBe(900);
  });

  it('rejects a request when the channel has no known events', () => {
    expect(clampReadWatermark(Date.now(), 0)).toBeNull();
    expect(clampReadWatermark(Date.now(), Number.NaN)).toBeNull();
  });

  it('rejects a non-positive or non-finite request', () => {
    expect(clampReadWatermark(0, 900)).toBeNull();
    expect(clampReadWatermark(-1, 900)).toBeNull();
    expect(clampReadWatermark(Number.NaN, 900)).toBeNull();
  });
});
