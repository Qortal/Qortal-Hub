/**
 * Decides how a video becomes an MP4 that plays in Q-Apps (H.264 + AAC,
 * +faststart) under the node's publish limit, as ffmpeg argument lists.
 *
 * Pure and free of Node imports, so the renderer can import it too (for
 * example to grey out qualities a long video can't fit at): call
 * planVideoJob(probe, spec) without paths and read everything but `passes`.
 */
import type {
  VideoJobFailedSubtitle,
  VideoJobPlanSummary,
  VideoJobSpec,
  VideoProbe,
  VideoQualityId,
} from './video-tool-types';

export type VideoQualityStep = {
  id: VideoQualityId;
  /** The landscape box; a portrait video uses it turned. */
  width: number;
  height: number;
  crf: number;
  maxrateKbps: number;
  /** Two-pass never goes below this video bitrate. */
  floorKbps: number;
  audioKbps: number;
  fpsCap: number;
};

/** Largest first. */
export const VIDEO_QUALITIES: readonly VideoQualityStep[] = [
  {
    id: '1080',
    width: 1920,
    height: 1080,
    crf: 22,
    maxrateKbps: 5000,
    floorKbps: 2000,
    audioKbps: 160,
    fpsCap: 60,
  },
  {
    id: '720',
    width: 1280,
    height: 720,
    crf: 23,
    maxrateKbps: 2800,
    floorKbps: 1100,
    audioKbps: 128,
    fpsCap: 60,
  },
  {
    id: '540',
    width: 960,
    height: 540,
    crf: 23,
    maxrateKbps: 1800,
    floorKbps: 700,
    audioKbps: 128,
    fpsCap: 30,
  },
  {
    id: '480',
    width: 854,
    height: 480,
    crf: 24,
    maxrateKbps: 1400,
    floorKbps: 550,
    audioKbps: 128,
    fpsCap: 30,
  },
  {
    id: '360',
    width: 640,
    height: 360,
    crf: 26,
    maxrateKbps: 800,
    floorKbps: 300,
    audioKbps: 96,
    fpsCap: 30,
  },
];

/** The share of the limit a result may fill (the rest is MP4 overhead). */
export const BUDGET_SHARE = 0.98;
/**
 * What the MP4 adds to the streams' own bytes (the moov index, sample
 * tables, chunk headers): a share of them plus a fixed part. The estimate a
 * plan gives counts it, so "at most" holds; the budget checks above compare
 * the streams alone with the BUDGET_SHARE of the limit, as before.
 */
export const MUX_OVERHEAD_SHARE = 0.015;
export const MUX_OVERHEAD_BYTES = 256 * 1024;

/** The MP4's size at most for streams of `bytes`. */
export const withMuxOverhead = (bytes: number): number =>
  Math.ceil(bytes * (1 + MUX_OVERHEAD_SHARE)) + MUX_OVERHEAD_BYTES;
/** Copying a picture is fine up to this much over the quality's cap. */
const COPY_BITRATE_TOLERANCE = 1.25;
/**
 * How many bits an H.264 re-encode may spend for each of the source's own:
 * newer codecs pack the same picture into fewer. Older ones (H.264 itself,
 * MPEG-2, MPEG-4 Part 2) count 1, a ceiling that's safe for them too.
 */
const H264_BITS_PER_SOURCE_BIT: Readonly<Record<string, number>> = {
  hevc: 1.5,
  vp9: 1.4,
  av1: 1.8,
};
/**
 * The source's cap never goes below this (a near-still picture), unless the
 * file would then outgrow the original.
 */
const SOURCE_CAP_MIN_KBPS = 200;
/** Converted sound never goes over the original's own rate, nor below this. */
const AUDIO_MIN_KBPS = 64;
/**
 * Beside a copied picture, the converted sound gets at most what the
 * original's sound took; under this, the picture is encoded instead.
 */
const COPY_AUDIO_FLOOR_KBPS = 16;
/** Original quality's x264 CRF is this much under the step's own (finer). */
const ORIGINAL_CRF_DROP = 4;
/**
 * AV1 (SVT-AV1 2.3.0) against x264 on a 2-minute scene of a 1620×1080 film
 * (2026-11-16, 16 threads): preset 8 took x264 medium's time; CRF 30 came
 * within 0.3 dB of CRF 22's XPSNR at 62 % of its bitrate, and CRF 36 matched
 * its SSIM at 38 %. So AV1's caps and floors are x264's times this share,
 * and its CRF is x264's plus the offset (22 → 31 at 1080p).
 */
export const AV1_BITRATE_SHARE = 0.6;
export const AV1_CRF_OFFSET = 9;
export const AV1_PRESET = 8;
/** AAC sound is copied when it's no more than this over the planned rate. */
const AUDIO_COPY_TOLERANCE = 1.5;
// H.264 level 4.1 limits (macroblocks per frame and per second).
const LEVEL_41_FRAME_MBS = 8192;
const LEVEL_41_MBS_PER_SEC = 245760;

export type VideoJobPaths = {
  input: string;
  /** The MP4 written. */
  video: string;
  /** -passlogfile prefix for two-pass jobs. */
  passLogPrefix: string;
  subtitle: (id: string) => string;
};

const PLACEHOLDER_PATHS: VideoJobPaths = {
  input: 'input',
  video: 'video.mp4',
  passLogPrefix: 'passlog',
  subtitle: (id) => `subtitles/${id}.vtt`,
};

export type PlannedSubtitle = {
  /** Output id: the file is subtitles/<id>.vtt. */
  id: string;
  /** Its position in VideoJobSpec.subtitles. */
  specIndex: number;
  language: string;
  label?: string;
} & (
  | { source: 'stream'; streamIndex: number }
  | { source: 'file'; sourceId: string; encoding?: string }
);

export type VideoPlan = VideoJobPlanSummary & {
  ok: true;
  /**
   * ffmpeg runs in order (two for two-pass), for the video only: subtitles
   * are written afterwards, each in its own run (subtitleStreamArgs,
   * subtitleFileArgs), so a track that can't be converted leaves the video
   * fine.
   */
  passes: string[][];
  /** The frame rate written (the source's, or capped). */
  outputFps: number;
  hasAudio: boolean;
  audioIndex: number | null;
  /** Of the planned sound, copied or encoded. */
  audioKbps: number;
  /** Two-pass target, or an AV1 fit's cap; absent for CRF and copies. */
  videoKbps?: number;
  /** A one-pass encode's cap (`-maxrate`): CRF never goes above it. */
  maxrateKbps?: number;
  /** AV1 capped to fit the limit (it has no two-pass here). */
  capFit?: boolean;
  /** The quality whose caps apply. */
  quality: VideoQualityId;
  subtitles: PlannedSubtitle[];
  /** Chosen tracks that can't be written (picture subtitles as text). */
  skippedSubtitles: VideoJobFailedSubtitle[];
};

export type VideoPlanErrorCode =
  | 'no-video'
  | 'invalid-spec'
  | 'keep-not-allowed'
  | 'burn-in-not-supported'
  | 'too-long-for-limit';

export type VideoPlanError = {
  ok: false;
  error: VideoPlanErrorCode;
  detail?: string;
  /** too-long-for-limit: the longest video (s) this quality fits. */
  maxDurationSec?: number;
};

type Size = { width: number; height: number };

const evenFloor = (value: number) => {
  const whole = Math.floor(value);
  return Math.max(2, whole - (whole % 2));
};

function boxOf(step: VideoQualityStep, size: Size): Size {
  return size.height > size.width
    ? { width: step.height, height: step.width }
    : { width: step.width, height: step.height };
}

function fitsIn(size: Size, step: VideoQualityStep): boolean {
  const box = boxOf(step, size);
  return size.width <= box.width && size.height <= box.height;
}

/** Fits `size` in the step's box, keeping its shape, never enlarging. */
function fitInto(size: Size, step: VideoQualityStep): Size {
  const box = boxOf(step, size);
  const scale = Math.min(1, box.width / size.width, box.height / size.height);
  return {
    width: evenFloor(Math.round(size.width * scale)),
    height: evenFloor(Math.round(size.height * scale)),
  };
}

/** The smallest step whose box holds `size` (the largest if none does). */
function stepHolding(size: Size): VideoQualityStep {
  for (let index = VIDEO_QUALITIES.length - 1; index >= 0; index -= 1) {
    if (fitsIn(size, VIDEO_QUALITIES[index])) return VIDEO_QUALITIES[index];
  }
  return VIDEO_QUALITIES[0];
}

/** An ffmpeg rational for `fps / divisor`, exact for NTSC rates. */
function rateExpression(fps: number, divisor: number): string {
  const ntscBase = Math.round((fps * 1001) / 1000);
  if (Math.abs(fps - (ntscBase * 1000) / 1001) < 0.01 && fps % 1 !== 0) {
    return `${ntscBase * 1000}/${1001 * divisor}`;
  }
  return `${Math.round(fps * 1000)}/${1000 * divisor}`;
}

/**
 * A rate this close over the cap counts as at it. A phone's variable rate
 * averages a little off what it was shot at (157 frames in 5.2 s: 30.19).
 */
const FPS_CAP_TOLERANCE = 1.05;

/** Halves (thirds…) the rate until it's under the cap: 50 → 25, 120 → 60. */
function cappedRate(fps: number, cap: number) {
  const limit = cap * FPS_CAP_TOLERANCE;
  if (fps <= limit) return null;
  const divisor = Math.ceil(fps / limit);
  return { fps: fps / divisor, expression: rateExpression(fps, divisor) };
}

function h264Level(size: Size, fps: number): '4.1' | '4.2' {
  const frameMbs = Math.ceil(size.width / 16) * Math.ceil(size.height / 16);
  return frameMbs <= LEVEL_41_FRAME_MBS &&
    frameMbs * fps <= LEVEL_41_MBS_PER_SEC
    ? '4.1'
    : '4.2';
}

const fileArg = (path: string) => `file:${path}`;

const COMMON_INPUT_ARGS = [
  '-hide_banner',
  '-nostdin',
  '-loglevel',
  'error',
  '-y',
  '-progress',
  'pipe:1',
  '-nostats',
];

const MP4_OUTPUT_ARGS = [
  '-map_metadata',
  '-1',
  '-map_chapters',
  '-1',
  '-movflags',
  '+faststart',
  '-max_muxing_queue_size',
  '1024',
  '-f',
  'mp4',
];

/**
 * Converts one external subtitle file (already UTF-8) to WebVTT.
 * `inputOptions` go before -i (for example MicroDVD's -subfps).
 */
export function subtitleFileArgs(
  input: string,
  output: string,
  inputOptions: string[] = []
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    ...inputOptions,
    '-i',
    fileArg(input),
    '-map',
    '0:s:0',
    '-c:s',
    'webvtt',
    '-f',
    'webvtt',
    fileArg(output),
  ];
}

/**
 * Writes a video's own subtitle tracks to WebVTT, in one run that reads the
 * file once: each track's stream index and output file.
 */
export function subtitleStreamArgs(
  input: string,
  tracks: { streamIndex: number; output: string }[]
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    fileArg(input),
    ...tracks.flatMap((track) => [
      '-map',
      `0:${track.streamIndex}`,
      '-c:s',
      'webvtt',
      '-f',
      'webvtt',
      fileArg(track.output),
    ]),
  ];
}

/** A frame rate as an ffmpeg rational, exact for NTSC rates (24000/1001). */
export function fpsRational(fps: number): string {
  return rateExpression(fps, 1);
}

/**
 * The disk x264's two-pass stats need beside the MP4 while pass 2 runs: the
 * .mbtree file holds about one byte per 16×16 macroblock per frame, the .log
 * about 120 bytes per frame (both with a margin).
 */
export function twoPassLogBytes(plan: VideoPlan, durationSec: number): number {
  if (!plan.twoPass || !(durationSec > 0)) return 0;
  const frames = Math.ceil(durationSec * (plan.outputFps || 30));
  const macroblocks = Math.ceil(plan.width / 16) * Math.ceil(plan.height / 16);
  return Math.ceil(macroblocks * frames * 1.05 + frames * 256);
}

/** A second pass after an overshoot aims this far under the limit. */
const RETRY_SHARE = 0.96;

/**
 * The lower video bitrate for re-running the last pass when a result fitted
 * to the limit (two-pass, or AV1 capped to fit) came out over it, or null
 * when a retry can't help.
 */
export function retryTwoPassKbps(
  plan: VideoPlan,
  outputBytes: number,
  sizeLimitBytes: number,
  durationSec: number
): number | null {
  if (!(plan.twoPass || plan.capFit) || !plan.videoKbps || durationSec <= 0) {
    return null;
  }
  const audioBytes = (plan.audioKbps * 1000 * durationSec) / 8;
  const target = sizeLimitBytes * RETRY_SHARE - audioBytes;
  const actual = outputBytes - audioBytes;
  if (target <= 0 || actual <= 0) return null;
  const kbps = Math.floor((plan.videoKbps * target) / actual);
  return kbps > 0 && kbps < plan.videoKbps ? kbps : null;
}

/**
 * A lower bitrate for running an encode's last pass again when it came out
 * bigger than its original, which the window promises none does: the cap
 * (or two-pass target) scaled to land under RETRY_SHARE of the original.
 * CRF's cap binds only on hard pictures (grain, noise), and the encoder can
 * overshoot it a little. Null for copies, or when a retry can't help.
 */
export function retryUnderOriginalKbps(
  plan: VideoPlan,
  outputBytes: number,
  originalBytes: number,
  durationSec: number
): number | null {
  const current = plan.twoPass ? plan.videoKbps : plan.maxrateKbps;
  if (
    plan.mode !== 'encode' ||
    !current ||
    durationSec <= 0 ||
    !(originalBytes > 0) ||
    outputBytes <= originalBytes
  ) {
    return null;
  }
  const audioBytes = (plan.audioKbps * 1000 * durationSec) / 8;
  const target = originalBytes * RETRY_SHARE - audioBytes;
  const actual = outputBytes - audioBytes;
  if (target <= 0 || actual <= 0) return null;
  const kbps = Math.floor((current * target) / actual);
  return kbps >= SOURCE_CAP_MIN_KBPS && kbps < current ? kbps : null;
}

/** An AV1 pass capped to fit, with another cap. */
export function withVideoCap(args: string[], kbps: number): string[] {
  const values: Record<string, string> = {
    '-maxrate': `${kbps}k`,
    '-bufsize': `${kbps * 2}k`,
  };
  return args.map((arg, index) =>
    index > 0 && values[args[index - 1]] ? values[args[index - 1]] : arg
  );
}

/** A pass's arguments with another two-pass video bitrate. */
export function withVideoBitrate(args: string[], kbps: number): string[] {
  const values: Record<string, string> = {
    '-b:v': `${kbps}k`,
    '-maxrate': `${Math.round(kbps * 1.5)}k`,
    '-bufsize': `${kbps * 3}k`,
  };
  return args.map((arg, index) =>
    index > 0 && values[args[index - 1]] ? values[args[index - 1]] : arg
  );
}

/**
 * The source picture's bitrate in kb/s: its stream's own figure, but never
 * more than the whole file holds less its sound. A Matroska BPS tag can be
 * left over from before a re-encode: a 1.5 GB film of 1 h 43 min said
 * 5.98 Mb/s, where its file holds 1.6 at most. Undefined when unknown.
 */
export function sourceVideoKbps(probe: VideoProbe): number | undefined {
  const duration = probe?.durationSec > 0 ? probe.durationSec : 0;
  const room =
    duration && probe.size > 0
      ? (probe.size * 8) / duration / 1000 -
        probe.audio.reduce(
          (sum, stream) => sum + (stream.bitrate ?? 0) / 1000,
          0
        )
      : undefined;
  const fileHolds = room !== undefined && room > 0 ? room : undefined;
  const stated = probe?.video?.bitrate ? probe.video.bitrate / 1000 : undefined;
  if (stated !== undefined && fileHolds !== undefined) {
    return Math.min(stated, fileHolds);
  }
  return stated ?? fileHolds;
}

const isPositiveSafeInteger = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function planVideoJob(
  probe: VideoProbe,
  spec: VideoJobSpec,
  paths: VideoJobPaths = PLACEHOLDER_PATHS
): VideoPlan | VideoPlanError {
  const video = probe?.video;
  if (!video) return { ok: false, error: 'no-video' };
  if (!isPositiveSafeInteger(spec?.sizeLimitBytes)) {
    return { ok: false, error: 'invalid-spec', detail: 'sizeLimitBytes' };
  }

  // Sound: none, the chosen one, or the default-flagged (else first) one.
  let audio: VideoProbe['audio'][number] | null;
  if (spec.audioIndex === null) audio = null;
  else if (spec.audioIndex === undefined) {
    audio = probe.audio.find((stream) => stream.isDefault) ?? probe.audio[0];
  } else {
    audio = probe.audio.find((stream) => stream.index === spec.audioIndex);
    if (!audio) return { ok: false, error: 'invalid-spec', detail: 'audio' };
  }
  audio = audio ?? null;

  let burn: VideoProbe['subtitles'][number] | null = null;
  if (spec.burnSubtitleIndex != null) {
    burn = probe.subtitles.find(
      (stream) => stream.index === spec.burnSubtitleIndex
    );
    if (!burn) return { ok: false, error: 'invalid-spec', detail: 'burn' };
    // No libass in this build: text can't be drawn, only pictures.
    if (burn.kind !== 'picture') {
      return { ok: false, error: 'burn-in-not-supported' };
    }
  }

  const subtitles: PlannedSubtitle[] = [];
  const skippedSubtitles: VideoJobFailedSubtitle[] = [];
  const chosen = Array.isArray(spec.subtitles) ? spec.subtitles : [];
  for (const [specIndex, track] of chosen.entries()) {
    const common = {
      id: `s${specIndex}`,
      specIndex,
      language: track.language,
      ...(track.label ? { label: track.label } : {}),
    };
    if (track.source === 'stream') {
      const stream = probe.subtitles.find((s) => s.index === track.index);
      if (!stream) {
        return { ok: false, error: 'invalid-spec', detail: 'subtitle' };
      }
      if (stream.kind !== 'text') {
        skippedSubtitles.push({
          specIndex,
          language: track.language,
          ...(track.label ? { label: track.label } : {}),
          reason: stream.kind === 'picture' ? 'picture' : 'unsupported',
        });
        continue;
      }
      subtitles.push({
        ...common,
        source: 'stream',
        streamIndex: stream.index,
      });
    } else if (track.source === 'file' && typeof track.sourceId === 'string') {
      subtitles.push({
        ...common,
        source: 'file',
        sourceId: track.sourceId,
        ...(track.encoding ? { encoding: track.encoding } : {}),
      });
    } else {
      return { ok: false, error: 'invalid-spec', detail: 'subtitle' };
    }
  }

  const duration = probe.durationSec > 0 ? probe.durationSec : 0;
  const budget = Math.floor(spec.sizeLimitBytes * BUDGET_SHARE);
  const bytesAt = (kbps: number) => Math.ceil((kbps * 1000 * duration) / 8);
  const display: Size = {
    width: video.displayWidth,
    height: video.displayHeight,
  };
  const sideways = video.rotation === 90 || video.rotation === 270;
  const coded: Size = sideways
    ? { width: video.height, height: video.width }
    : { width: video.width, height: video.height };

  const audioKbpsKnown = audio?.bitrate ? audio.bitrate / 1000 : undefined;
  const sourceKbps = sourceVideoKbps(probe);
  const sharedResult = {
    ok: true as const,
    hasAudio: Boolean(audio),
    audioIndex: audio?.index ?? null,
    subtitles,
    skippedSubtitles,
  };

  if (spec.quality === 'keep') {
    const audioPlayable = !audio || audio.codec === 'aac';
    if (!probe.playableAsIs || !audioPlayable || burn) {
      return { ok: false, error: 'keep-not-allowed', detail: 'not-playable' };
    }
    const estimateBytes =
      sourceKbps !== undefined && (!audio || audioKbpsKnown) && duration
        ? bytesAt(sourceKbps + (audioKbpsKnown ?? 0))
        : probe.size;
    if (estimateBytes > budget) {
      return { ok: false, error: 'keep-not-allowed', detail: 'too-big' };
    }
    return {
      ...sharedResult,
      mode: 'keep',
      codec: video.codec === 'av1' ? 'av1' : 'h264',
      twoPass: false,
      outputFps: video.fps,
      // The original's own streams, repackaged: no bigger than the original.
      estimateBytes:
        probe.size > 0
          ? Math.min(withMuxOverhead(estimateBytes), probe.size)
          : withMuxOverhead(estimateBytes),
      width: display.width,
      height: display.height,
      audioKbps: audioKbpsKnown ?? 0,
      quality: stepHolding(display).id,
      passes: [
        [
          ...COMMON_INPUT_ARGS,
          '-i',
          fileArg(paths.input),
          '-map',
          `0:${video.index}`,
          ...(audio ? ['-map', `0:${audio.index}`] : []),
          '-c',
          'copy',
          ...MP4_OUTPUT_ARGS,
          fileArg(paths.video),
        ],
      ],
    };
  }

  const chosenStep =
    spec.quality === 'original'
      ? VIDEO_QUALITIES[0]
      : VIDEO_QUALITIES.find((step) => step.id === spec.quality);
  if (!chosenStep) {
    return { ok: false, error: 'invalid-spec', detail: 'quality' };
  }
  // Original quality: the source's own size (never above 1080p, level
  // 4.1), its picture copied whenever it can be, else encoded finer than the
  // step's own and without the step's cap. The steps keep their caps.
  const originalQuality = spec.quality === 'original';
  const output = fitInto(display, chosenStep);
  const step = stepHolding(output);
  const rateCap = cappedRate(video.fps, step.fpsCap);
  const outputFps = rateCap ? rateCap.fps : video.fps;

  const copyAudio =
    audio?.codec === 'aac' &&
    audio.channels <= 2 &&
    audioKbpsKnown !== undefined &&
    audioKbpsKnown <= step.audioKbps * AUDIO_COPY_TOLERANCE;
  // Converted sound: the step's rate, but no more than the original's own
  // (Opus at 32 kb/s gains nothing from AAC at 128), down to AUDIO_MIN_KBPS.
  const encodedAudioKbps =
    audioKbpsKnown !== undefined
      ? Math.min(
          step.audioKbps,
          Math.max(AUDIO_MIN_KBPS, Math.round(audioKbpsKnown))
        )
      : step.audioKbps;
  const audioKbps = !audio ? 0 : copyAudio ? audioKbpsKnown : encodedAudioKbps;
  const audioArgsAt = (kbps: number) =>
    !audio
      ? ['-an']
      : copyAudio
        ? ['-map', `0:${audio.index}`, '-c:a', 'copy']
        : [
            '-map',
            `0:${audio.index}`,
            '-c:a',
            'aac',
            '-b:a',
            `${kbps}k`,
            '-ac',
            '2',
            '-ar',
            '48000',
          ];
  const audioArgs = audioArgsAt(audioKbps);

  // AV1 writes the same picture in fewer bits: its caps are a share of x264's.
  const av1 = spec.codec === 'av1';
  const share = av1 ? AV1_BITRATE_SHARE : 1;
  const stepMaxrateKbps = Math.round(step.maxrateKbps * share);
  const stepFloorKbps = Math.round(step.floorKbps * share);

  // Fast path: a picture that already fits is copied, only the sound is
  // converted. H.264 with H.264 chosen (or for Original quality); AV1 with
  // AV1 chosen (8- or 10-bit, which every AV1 player decodes).
  // What the original holds besides its picture (its sound, its container):
  // a converted sound gets no more, so the file never outgrows the original.
  const soundRoomKbps =
    sourceKbps !== undefined && duration && probe.size > 0
      ? (probe.size * 8) / duration / 1000 - sourceKbps
      : undefined;
  const copyAudioKbps =
    !audio || copyAudio || soundRoomKbps === undefined
      ? audioKbps
      : Math.min(audioKbps, Math.floor(soundRoomKbps));
  const copyEstimate =
    sourceKbps !== undefined && duration
      ? bytesAt(sourceKbps + copyAudioKbps)
      : undefined;
  // The original's own picture and at most its sound's share: no bigger.
  const copyBound =
    soundRoomKbps !== undefined
      ? probe.size -
        Math.floor(
          (Math.max(0, soundRoomKbps - copyAudioKbps) * 1000 * duration) / 8
        )
      : undefined;
  const copyablePicture =
    video.codec === 'h264'
      ? (!av1 || originalQuality) &&
        video.bitDepth === 8 &&
        (video.pixFmt === 'yuv420p' || video.pixFmt === 'yuvj420p')
      : video.codec === 'av1' &&
        av1 &&
        (video.pixFmt === 'yuv420p' || video.pixFmt === 'yuv420p10le');
  if (
    copyablePicture &&
    !video.interlaced &&
    !burn &&
    !rateCap &&
    fitsIn(display, chosenStep) &&
    sourceKbps !== undefined &&
    (originalQuality ||
      sourceKbps <=
        (video.codec === 'av1' ? stepMaxrateKbps : step.maxrateKbps) *
          COPY_BITRATE_TOLERANCE) &&
    copyEstimate !== undefined &&
    copyEstimate <= budget &&
    (!audio || copyAudio || copyAudioKbps >= COPY_AUDIO_FLOOR_KBPS)
  ) {
    return {
      ...sharedResult,
      mode: 'copy-video',
      codec: video.codec === 'av1' ? 'av1' : 'h264',
      twoPass: false,
      outputFps: video.fps,
      estimateBytes:
        copyBound !== undefined
          ? Math.min(withMuxOverhead(copyEstimate), copyBound)
          : withMuxOverhead(copyEstimate),
      width: display.width,
      height: display.height,
      audioKbps: copyAudioKbps,
      quality: step.id,
      passes: [
        [
          ...COMMON_INPUT_ARGS,
          '-i',
          fileArg(paths.input),
          '-map',
          `0:${video.index}`,
          '-c:v',
          'copy',
          ...audioArgsAt(copyAudioKbps),
          ...MP4_OUTPUT_ARGS,
          fileArg(paths.video),
        ],
      ],
    };
  }

  // Encode. One pass at CRF with the cap when the cap fits the budget, else
  // two-pass at the bitrate that fills it, down to the quality's floor. The
  // cap is the quality's own (Original quality has none of its own), but
  //  - never above what the source had, in H.264's worth: a smaller picture
  //    gains no detail from more bits, only size (a 1080p H.264 film of
  //    1.6 Mb/s once came out of 720p at 2.5);
  //  - never so high that the file outgrows the original, the MP4's own
  //    bytes counted (an HEVC film of 1.6 GB was offered 2 GB at 720p).
  const sourceCapKbps =
    sourceKbps !== undefined
      ? Math.round(
          sourceKbps * (H264_BITS_PER_SOURCE_BIT[video.codec] ?? 1) * share
        )
      : undefined;
  const originalRoomKbps =
    duration && probe.size > MUX_OVERHEAD_BYTES
      ? Math.floor(
          (((probe.size - MUX_OVERHEAD_BYTES) / (1 + MUX_OVERHEAD_SHARE)) * 8) /
            duration /
            1000 -
            audioKbps
        )
      : undefined;
  const originalCapKbps =
    originalRoomKbps !== undefined && originalRoomKbps > 0
      ? originalRoomKbps
      : undefined;
  const caps = [
    originalQuality ? undefined : stepMaxrateKbps,
    sourceCapKbps,
    originalCapKbps,
  ].filter((cap): cap is number => cap !== undefined);
  // The near-still floor never lifts the file over the original.
  const capFloorKbps = Math.min(
    SOURCE_CAP_MIN_KBPS,
    originalCapKbps ?? SOURCE_CAP_MIN_KBPS
  );
  let maxrateKbps = caps.length
    ? Math.max(capFloorKbps, Math.min(...caps))
    : stepMaxrateKbps;
  let capBytes = bytesAt(maxrateKbps + audioKbps);
  let twoPassKbps: number | undefined;
  let capFit = false;
  if (duration && capBytes > budget) {
    const fitting = Math.floor((budget * 8) / duration / 1000 - audioKbps);
    if (fitting < stepFloorKbps) {
      return {
        ok: false,
        error: 'too-long-for-limit',
        maxDurationSec: Math.floor(
          (budget * 8) / ((stepFloorKbps + audioKbps) * 1000)
        ),
      };
    }
    if (av1) {
      // No two-pass for SVT-AV1 in ffmpeg: CRF capped at the bitrate that
      // fits (its average stays well under the cap).
      maxrateKbps = fitting;
      capBytes = bytesAt(fitting + audioKbps);
      capFit = true;
    } else {
      twoPassKbps = fitting;
    }
  }

  const filters: string[] = [];
  if (video.interlaced) filters.push('bwdif=mode=send_frame');
  const afterOverlay: string[] = [];
  if (rateCap) afterOverlay.push(`fps=${rateCap.expression}`);
  const squarePixels =
    coded.width === display.width && coded.height === display.height;
  const ownSize =
    output.width === evenFloor(display.width) &&
    output.height === evenFloor(display.height);
  if (!squarePixels || !ownSize) {
    afterOverlay.push(`scale=${output.width}:${output.height}`);
  } else if (
    output.width !== display.width ||
    output.height !== display.height
  ) {
    // Its own size but odd: trim a line rather than resample the picture.
    afterOverlay.push(`crop=${output.width}:${output.height}:0:0`);
  }
  afterOverlay.push('setsar=1', 'format=yuv420p');
  const pre = filters.length ? filters.join(',') : 'null';
  const graph = burn
    ? `[0:${video.index}]${pre}[base];[base][0:${burn.index}]` +
      // A subtitle canvas taller than a cropped film keeps its lines at the
      // bottom of the picture.
      `overlay=x=(W-w)/2:y=H-h:eof_action=pass,${afterOverlay.join(',')}[vout]`
    : `[0:${video.index}]${[...filters, ...afterOverlay].join(',')}[vout]`;

  const videoArgs = [
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    ...(av1
      ? [
          '-c:v',
          'libsvtav1',
          '-preset',
          String(AV1_PRESET),
          '-pix_fmt',
          'yuv420p',
        ]
      : [
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-profile:v',
          'high',
          '-level:v',
          h264Level(output, outputFps),
          '-pix_fmt',
          'yuv420p',
          '-g',
          String(Math.max(1, Math.round(outputFps * 2))),
        ]),
    // Phones' variable frame rate is kept unless the rate is being capped,
    // on a fine clock: on the frame rate's own, a film's millisecond
    // timestamps (41/42 ms apart) landed two on one tick and played back
    // jerkily (one film: 419 of its first 1,439 frames).
    ...(rateCap
      ? []
      : ['-fps_mode', 'passthrough', '-enc_time_base:v', '1:90000']),
  ];
  const crf =
    (originalQuality ? step.crf - ORIGINAL_CRF_DROP : step.crf) +
    (av1 ? AV1_CRF_OFFSET : 0);
  const input = ['-i', fileArg(paths.input)];
  const summary = {
    mode: 'encode' as const,
    codec: av1 ? ('av1' as const) : ('h264' as const),
    outputFps,
    width: output.width,
    height: output.height,
    audioKbps,
    quality: step.id,
  };

  if (twoPassKbps === undefined) {
    return {
      ...sharedResult,
      ...summary,
      twoPass: false,
      maxrateKbps,
      ...(capFit ? { capFit: true, videoKbps: maxrateKbps } : {}),
      estimateBytes: withMuxOverhead(capBytes),
      passes: [
        [
          ...COMMON_INPUT_ARGS,
          ...input,
          ...videoArgs,
          '-crf',
          String(crf),
          '-maxrate',
          `${maxrateKbps}k`,
          '-bufsize',
          `${maxrateKbps * 2}k`,
          ...audioArgs,
          ...MP4_OUTPUT_ARGS,
          fileArg(paths.video),
        ],
      ],
    };
  }

  const rateArgs = (pass: 1 | 2) => [
    '-b:v',
    `${twoPassKbps}k`,
    '-maxrate',
    `${Math.round(twoPassKbps * 1.5)}k`,
    '-bufsize',
    `${twoPassKbps * 3}k`,
    '-pass',
    String(pass),
    '-passlogfile',
    paths.passLogPrefix,
  ];
  return {
    ...sharedResult,
    ...summary,
    twoPass: true,
    videoKbps: twoPassKbps,
    estimateBytes: withMuxOverhead(bytesAt(twoPassKbps + audioKbps)),
    passes: [
      [
        ...COMMON_INPUT_ARGS,
        ...input,
        ...videoArgs,
        ...rateArgs(1),
        '-an',
        '-f',
        'null',
        '-',
      ],
      [
        ...COMMON_INPUT_ARGS,
        ...input,
        ...videoArgs,
        ...rateArgs(2),
        ...audioArgs,
        ...MP4_OUTPUT_ARGS,
        fileArg(paths.video),
      ],
    ],
  };
}
