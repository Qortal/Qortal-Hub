/**
 * Reads ffmpeg's `-progress pipe:1` output: blocks of key=value lines, each
 * ending with `progress=continue` (or `end`).
 */

export type ProgressSample = {
  /** Media time written so far, in seconds. */
  outTimeSec?: number;
  /** Encode speed vs real time (ffmpeg's "2.4x"). */
  speed?: number;
  ended: boolean;
};

export class FfmpegProgressParser {
  private pending = '';
  private block: Record<string, string> = {};

  /** Feeds stdout text; returns the blocks it completed. */
  push(text: string): ProgressSample[] {
    const samples: ProgressSample[] = [];
    const lines = (this.pending + text).split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    for (const line of lines) {
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key !== 'progress') {
        this.block[key] = value;
        continue;
      }
      samples.push(toSample(this.block, value === 'end'));
      this.block = {};
    }
    return samples;
  }
}

function toSample(
  block: Record<string, string>,
  ended: boolean
): ProgressSample {
  // out_time_ms is in microseconds too (an old ffmpeg naming slip).
  const micros = Number(block.out_time_us ?? block.out_time_ms);
  const speed = Number.parseFloat(block.speed ?? '');
  return {
    ended,
    ...(Number.isFinite(micros) && micros >= 0
      ? { outTimeSec: micros / 1_000_000 }
      : {}),
    ...(Number.isFinite(speed) && speed > 0 ? { speed } : {}),
  };
}

/**
 * Pass 1's share of a two-pass job's time: libx264's fast first pass. On a
 * real 1 h 43 min 1080p film pass 2 ran about 1.45× slower (0.41 of the
 * time in pass 1); a 20 s clip on a loaded machine gave about half, but a
 * film is what takes two passes.
 */
export const FIRST_PASS_SHARE = 0.4;

export type JobProgress = { percent: number; etaSec?: number; speed?: number };

/**
 * The whole job's progress from one sample: `pass` is 1-based, `passes` 1 or
 * 2; `scale` leaves room for steps after encoding (subtitle files).
 */
export function jobProgress(
  sample: ProgressSample,
  {
    durationSec,
    pass,
    passes,
    scale = 100,
  }: { durationSec: number; pass: number; passes: number; scale?: number }
): JobProgress {
  const fraction =
    durationSec > 0 && sample.outTimeSec !== undefined
      ? Math.min(1, sample.outTimeSec / durationSec)
      : sample.ended
        ? 1
        : 0;
  let overall = fraction;
  if (passes === 2) {
    overall =
      pass === 1
        ? fraction * FIRST_PASS_SHARE
        : FIRST_PASS_SHARE + fraction * (1 - FIRST_PASS_SHARE);
  }
  const percent = Math.round(overall * scale * 10) / 10;
  if (!sample.speed || durationSec <= 0) return { percent };
  // Pass 2 takes as much longer than pass 1 as their shares of the
  // percent say, so pass 1's speed prices it accordingly.
  const remainingMedia =
    durationSec * (1 - fraction) +
    (passes === 2 && pass === 1
      ? (durationSec * (1 - FIRST_PASS_SHARE)) / FIRST_PASS_SHARE
      : 0);
  return {
    percent,
    speed: sample.speed,
    etaSec: Math.max(0, Math.round(remainingMedia / sample.speed)),
  };
}
