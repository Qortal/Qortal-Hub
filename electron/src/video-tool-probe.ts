/**
 * Turns ffprobe's JSON (`-print_format json -show_format -show_streams`) into
 * the VideoProbe the window shows. Pure: no process or file access.
 */
import type { VideoProbe } from './video-tool-types';

type ProbeStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string | number;
  color_transfer?: string;
  field_order?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  channels?: number;
  bit_rate?: string | number;
  duration?: string | number;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
};

export type FfprobeJson = {
  streams?: ProbeStream[];
  format?: {
    format_name?: string;
    duration?: string | number;
    size?: string | number;
    bit_rate?: string | number;
  };
};

export type ProbeSource = { id: string; name: string; size: number };

export class ProbeSummaryError extends Error {
  constructor(readonly code: 'no-video' | 'probe-failed') {
    super(code);
  }
}

const PICTURE_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle',
  'dvd_subtitle',
  'dvb_subtitle',
  'xsub',
]);
/**
 * Text subtitles the bundled ffmpeg decodes (build-ffmpeg.mjs's decoders, by
 * the codec names ffprobe prints). Any other track (teletext, Blu-ray text,
 * broadcast captions…) can't be read by this build: 'unsupported'.
 */
export const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
  'microdvd',
  'subviewer',
  'subviewer1',
  'sami',
  'mpl2',
  'realtext',
  'vplayer',
  'pjs',
  'stl',
  'jacosub',
]);

const subtitleKind = (codec: string) =>
  PICTURE_SUBTITLE_CODECS.has(codec)
    ? ('picture' as const)
    : TEXT_SUBTITLE_CODECS.has(codec)
      ? ('text' as const)
      : ('unsupported' as const);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const INTERLACED_FIELD_ORDERS = new Set(['tt', 'bb', 'tb', 'bt']);
const PLAYABLE_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
// AV1 plays at 8 and 10 bits (4:2:0) wherever it plays: Chromium (Hub, GO's
// WebView), Firefox, and Safari on Apple devices that decode AV1.
const PLAYABLE_AV1_PIXEL_FORMATS = new Set(['yuv420p', 'yuv420p10le']);
// Above this, a frame rate is a timebase (MKV's 1000/1), not a real rate.
const MAX_PLAUSIBLE_FPS = 300;
const FALLBACK_FPS = 30;

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

export function parseRational(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator = '1'] = value.split(/[/:]/);
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) {
    return undefined;
  }
  return n / d;
}

/** Matroska keeps durations as tags: "00:01:23.456000000". */
function parseClock(value: string | undefined): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  return positiveNumber(
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  );
}

function tag(stream: ProbeStream, name: string): string | undefined {
  const tags = stream.tags ?? {};
  const key = Object.keys(tags).find(
    (candidate) => candidate.toLowerCase() === name
  );
  const value = key ? tags[key]?.trim() : undefined;
  return value || undefined;
}

/** Matroska writes per-stream statistics as BPS / BPS-eng tags. */
function streamBitrate(stream: ProbeStream): number | undefined {
  return (
    positiveNumber(stream.bit_rate) ??
    positiveNumber(tag(stream, 'bps')) ??
    positiveNumber(tag(stream, 'bps-eng'))
  );
}

function language(stream: ProbeStream): string | undefined {
  const value = tag(stream, 'language')?.toLowerCase();
  return value && value !== 'und' ? value : undefined;
}

function bitDepth(stream: ProbeStream): number {
  const raw = positiveNumber(stream.bits_per_raw_sample);
  if (raw) return raw;
  const match = /p(\d{2})(?:le|be)?$/.exec(stream.pix_fmt ?? '');
  return match ? Number(match[1]) : 8;
}

/** Clockwise degrees (0/90/180/270) the picture is turned when shown. */
function rotation(stream: ProbeStream): number {
  const matrix = stream.side_data_list?.find(
    (entry) =>
      entry.side_data_type === 'Display Matrix' &&
      typeof entry.rotation === 'number'
  );
  // The display matrix counts counterclockwise; the old rotate tag clockwise.
  const degrees = matrix
    ? -matrix.rotation
    : Number(tag(stream, 'rotate') ?? 0) || 0;
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

function fps(stream: ProbeStream): number {
  for (const rate of [stream.avg_frame_rate, stream.r_frame_rate]) {
    const value = parseRational(rate);
    if (value && value <= MAX_PLAUSIBLE_FPS) return value;
  }
  return FALLBACK_FPS;
}

function isDefault(stream: ProbeStream): boolean {
  return stream.disposition?.default === 1;
}

export function summarizeProbe(
  json: FfprobeJson,
  source: ProbeSource
): VideoProbe {
  if (!json || !Array.isArray(json.streams)) {
    throw new ProbeSummaryError('probe-failed');
  }
  const streams = json.streams.filter(
    (stream) => typeof stream?.index === 'number'
  );
  const videoStream = streams.find(
    (stream) =>
      stream.codec_type === 'video' &&
      stream.disposition?.attached_pic !== 1 &&
      positiveNumber(stream.width) &&
      positiveNumber(stream.height)
  );
  if (!videoStream) throw new ProbeSummaryError('no-video');

  const width = videoStream.width;
  const height = videoStream.height;
  const sar = parseRational(videoStream.sample_aspect_ratio) ?? 1;
  const shownWidth = Math.max(1, Math.round(width * sar));
  const turn = rotation(videoStream);
  const sideways = turn === 90 || turn === 270;
  const depth = bitDepth(videoStream);
  const pixFmt = videoStream.pix_fmt ?? '';
  const codec = videoStream.codec_name ?? 'unknown';
  const fieldOrder = videoStream.field_order ?? '';

  const audio = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name ?? 'unknown',
      language: language(stream),
      title: tag(stream, 'title'),
      isDefault: isDefault(stream),
      channels: positiveNumber(stream.channels) ?? 2,
      bitrate: streamBitrate(stream),
    }));
  const subtitles = streams
    .filter((stream) => stream.codec_type === 'subtitle')
    .map((stream) => ({
      index: stream.index,
      codec: stream.codec_name ?? 'unknown',
      language: language(stream),
      title: tag(stream, 'title'),
      isDefault: isDefault(stream),
      kind: subtitleKind(stream.codec_name ?? ''),
      isForced: stream.disposition?.forced === 1,
    }));

  const durationSec =
    positiveNumber(json.format?.duration) ??
    positiveNumber(videoStream.duration) ??
    parseClock(tag(videoStream, 'duration')) ??
    0;

  const mainAudio = audio.find((stream) => stream.isDefault) ?? audio[0];
  const playablePicture =
    (codec === 'h264' && PLAYABLE_PIXEL_FORMATS.has(pixFmt) && depth === 8) ||
    (codec === 'av1' && PLAYABLE_AV1_PIXEL_FORMATS.has(pixFmt));
  const playableAsIs =
    playablePicture && (!mainAudio || mainAudio.codec === 'aac');

  return {
    sourceId: source.id,
    name: source.name,
    size: source.size,
    durationSec,
    container: json.format?.format_name ?? '',
    video: {
      index: videoStream.index,
      codec,
      ...(videoStream.profile ? { profile: videoStream.profile } : {}),
      width,
      height,
      displayWidth: sideways ? height : shownWidth,
      displayHeight: sideways ? shownWidth : height,
      fps: fps(videoStream),
      bitDepth: depth,
      pixFmt,
      hdr: HDR_TRANSFERS.has(videoStream.color_transfer ?? ''),
      interlaced: INTERLACED_FIELD_ORDERS.has(fieldOrder),
      rotation: turn,
      ...(streamBitrate(videoStream)
        ? { bitrate: streamBitrate(videoStream) }
        : {}),
    },
    audio,
    subtitles,
    playableAsIs,
  };
}
