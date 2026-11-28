import { describe, expect, it } from 'vitest';
import {
  FIRST_PASS_SHARE,
  FfmpegProgressParser,
  jobProgress,
} from './video-tool-progress';

const block = (outTimeUs: number, speed: string, progress = 'continue') =>
  [
    'frame=120',
    'fps=48.0',
    `out_time_us=${outTimeUs}`,
    `out_time_ms=${outTimeUs}`,
    'out_time=00:00:05.000000',
    `speed=${speed}`,
    `progress=${progress}`,
    '',
  ].join('\n');

describe('FfmpegProgressParser', () => {
  it('returns one sample per completed block', () => {
    const parser = new FfmpegProgressParser();
    expect(
      parser.push(block(5_000_000, '2.4x') + block(10_000_000, '2.5x'))
    ).toEqual([
      { ended: false, outTimeSec: 5, speed: 2.4 },
      { ended: false, outTimeSec: 10, speed: 2.5 },
    ]);
  });

  it('joins lines split across chunks, including CRLF', () => {
    const parser = new FfmpegProgressParser();
    const text = block(7_500_000, '1.1x', 'end').replace(/\n/g, '\r\n');
    expect(parser.push(text.slice(0, 23))).toEqual([]);
    expect(parser.push(text.slice(23, 60))).toEqual([]);
    expect(parser.push(text.slice(60))).toEqual([
      { ended: true, outTimeSec: 7.5, speed: 1.1 },
    ]);
  });

  it('leaves out unknown values (N/A at the start)', () => {
    const parser = new FfmpegProgressParser();
    expect(
      parser.push('out_time_us=N/A\nspeed=N/A\nprogress=continue\n')
    ).toEqual([{ ended: false }]);
  });

  it('falls back to out_time_ms (also microseconds)', () => {
    const parser = new FfmpegProgressParser();
    expect(parser.push('out_time_ms=2000000\nprogress=continue\n')).toEqual([
      { ended: false, outTimeSec: 2 },
    ]);
  });
});

describe('jobProgress', () => {
  it('measures one pass against the duration, with speed and ETA', () => {
    expect(
      jobProgress(
        { ended: false, outTimeSec: 30, speed: 2 },
        { durationSec: 120, pass: 1, passes: 1 }
      )
    ).toEqual({ percent: 25, speed: 2, etaSec: 45 });
  });

  it('weights pass 1 of two at 40 %, and prices pass 2 by it', () => {
    expect(FIRST_PASS_SHARE).toBe(0.4);
    const half = { ended: false, outTimeSec: 60, speed: 4 };
    // 60 s of pass 1 left, then pass 2 at 1.5× pass 1's time (180 s of
    // media at pass 1's speed): 240 / 4.
    expect(jobProgress(half, { durationSec: 120, pass: 1, passes: 2 })).toEqual(
      { percent: 20, speed: 4, etaSec: 60 }
    );
    // Pass 2 halfway: 70 %, its own 60 s left at its speed.
    expect(jobProgress(half, { durationSec: 120, pass: 2, passes: 2 })).toEqual(
      { percent: 70, speed: 4, etaSec: 15 }
    );
  });

  it('clamps, scales and copes with an unknown duration', () => {
    expect(
      jobProgress(
        { ended: false, outTimeSec: 500 },
        { durationSec: 120, pass: 1, passes: 1, scale: 97 }
      )
    ).toEqual({ percent: 97 });
    expect(
      jobProgress(
        { ended: true, speed: 3 },
        { durationSec: 0, pass: 1, passes: 1 }
      )
    ).toEqual({ percent: 100 });
  });
});
