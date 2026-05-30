import { describe, expect, it } from 'vitest';
import {
  decideFramesToPost,
  estimateWorkletBufferedMs,
} from './playoutDrainControl';

describe('playoutDrainControl', () => {
  it('uses reported worklet rate for buffer estimation', () => {
    expect(
      estimateWorkletBufferedMs({
        lastBufferedMs: 80,
        postedSinceReportMs: 20,
        reportAgeMs: 100,
        lastReportedRate: 0.95,
      })
    ).toBeCloseTo(5);
  });

  it('posts conservatively when there is no trustworthy estimate but upstream reserve is healthy', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: null,
        lastReportedBufferedMs: null,
        targetBufferMs: 120,
        upstreamBufferedMs: 120,
        ringJustRefilled: false,
        reportAgeMs: Number.POSITIVE_INFINITY,
      })
    ).toBe(1);
  });

  it('tops up more aggressively on ring refill when the last audible report was still low', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 40,
        lastReportedBufferedMs: 20,
        targetBufferMs: 120,
        upstreamBufferedMs: 180,
        ringJustRefilled: true,
        reportAgeMs: 30,
      })
    ).toBe(2);
  });

  it('stays modest on ring refill when the last audible report was already healthy', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 140,
        lastReportedBufferedMs: 115,
        targetBufferMs: 120,
        upstreamBufferedMs: 160,
        ringJustRefilled: true,
        reportAgeMs: 30,
      })
    ).toBe(1);
  });

  it('posts proportionally when buffer is materially under target', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 60,
        lastReportedBufferedMs: 60,
        targetBufferMs: 120,
        upstreamBufferedMs: 200,
        ringJustRefilled: false,
        reportAgeMs: 40,
      })
    ).toBe(2);
  });

  it('avoids the zero-gain trap just above target', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 128,
        lastReportedBufferedMs: 124,
        targetBufferMs: 120,
        upstreamBufferedMs: 180,
        ringJustRefilled: false,
        reportAgeMs: 30,
      })
    ).toBe(2);
  });

  it('soft-lands instead of zero-posting when the recent report was still low', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 165,
        lastReportedBufferedMs: 90,
        targetBufferMs: 120,
        upstreamBufferedMs: 100,
        ringJustRefilled: false,
        reportAgeMs: 80,
      })
    ).toBe(1);
  });

  it('uses a modest panic-recovery top-up between panic enter and exit bands', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 70,
        lastReportedBufferedMs: 68,
        targetBufferMs: 120,
        upstreamBufferedMs: 160,
        ringJustRefilled: false,
        reportAgeMs: 25,
      })
    ).toBe(2);
  });

  it('posts modest extra frames when upstream reserve is very large', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 175,
        lastReportedBufferedMs: 165,
        targetBufferMs: 120,
        upstreamBufferedMs: 520,
        ringJustRefilled: false,
        reportAgeMs: 70,
      })
    ).toBe(2);
  });

  it('does not add latency-drain posting from stale reports alone', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 170,
        lastReportedBufferedMs: 165,
        targetBufferMs: 120,
        upstreamBufferedMs: 520,
        ringJustRefilled: false,
        reportAgeMs: 300,
      })
    ).toBe(0);
  });

  it('recovers faster from stale low worklet reports when upstream reserve is healthy', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 170,
        lastReportedBufferedMs: 70,
        targetBufferMs: 120,
        upstreamBufferedMs: 190,
        ringJustRefilled: false,
        reportAgeMs: 300,
      })
    ).toBe(2);
  });

  it('does not drain extra when audible buffer is already too far above target', () => {
    expect(
      decideFramesToPost({
        estimatedBufferedMs: 240,
        lastReportedBufferedMs: 220,
        targetBufferMs: 120,
        upstreamBufferedMs: 600,
        ringJustRefilled: false,
        reportAgeMs: 50,
      })
    ).toBe(0);
  });
});
