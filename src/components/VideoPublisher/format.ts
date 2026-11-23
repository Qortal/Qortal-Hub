/**
 * Numbers as the Video publisher shows them. Sizes count like Hub's limits
 * do: MiB, with 1000 of them shown as 1 GB (MAX_SIZE_PUBLISH, 2000 MiB, is
 * "2 GB").
 */
import type { TFunction } from 'i18next';
import type { VideoProbe } from '../../../electron/src/video-tool-types';
import type { LeftOutFile } from './videoPublisherTypes';

const MIB = 1024 * 1024;

/** A QORT amount in the reader's number format (0,03 in German). */
export const formatQort = (value: number, locale?: string): string => {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(
      value
    );
  } catch {
    return String(value);
  }
};

export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const mib = bytes / MIB;
  const [value, unit] =
    mib >= 1000
      ? [mib / 1000, 'gigabyte']
      : mib >= 1
        ? [mib, 'megabyte']
        : [bytes / 1024, 'kilobyte'];
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: value >= 100 ? 0 : 1,
      style: 'unit',
      unit,
      unitDisplay: 'short',
    }).format(value);
  } catch {
    return `${value.toFixed(1)} ${unit === 'gigabyte' ? 'GB' : 'MB'}`;
  }
}

/** 1:02:03, 4:05 */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '';
  const whole = Math.round(totalSec);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** "3 min left", "1 h 20 min left", "under a minute left". */
export function formatEta(t: TFunction, etaSec?: number): string {
  if (etaSec == null || !Number.isFinite(etaSec) || etaSec < 0) return '';
  if (etaSec < 60) {
    return etaSec < 1
      ? t('core:video_publisher.eta.under_minute')
      : t('core:video_publisher.eta.seconds', { seconds: Math.ceil(etaSec) });
  }
  const minutes = Math.ceil(etaSec / 60);
  if (minutes < 60) {
    return t('core:video_publisher.eta.minutes', { minutes });
  }
  return t('core:video_publisher.eta.hours', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

const VIDEO_CODECS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
  msmpeg4v3: 'DivX',
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  wmv3: 'WMV',
  vc1: 'VC-1',
  theora: 'Theora',
  prores: 'ProRes',
};

const AUDIO_CODECS: Record<string, string> = {
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'TrueHD',
  mp3: 'MP3',
  mp2: 'MP2',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  wmav2: 'WMA',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  alac: 'ALAC',
};

export const videoCodecName = (codec: string) =>
  VIDEO_CODECS[codec] ?? codec.toUpperCase();

export const audioCodecName = (codec: string) =>
  AUDIO_CODECS[codec] ?? codec.toUpperCase();

/** Surround layouts by channel count (mono and stereo are words). */
const SURROUND_LAYOUTS: Record<number, string> = {
  3: '2.1',
  4: '4.0',
  5: '5.0',
  6: '5.1',
  7: '6.1',
  8: '7.1',
};

/** "mono", "stereo", "5.1", "7.1"… */
export function channelLayout(t: TFunction, channels: number): string {
  if (channels === 1) return t('core:video_publisher.summary.mono');
  if (channels === 2) return t('core:video_publisher.summary.stereo');
  return SURROUND_LAYOUTS[channels] ?? `${channels}.0`;
}

/** "HEVC 10-bit · AC-3 5.1 · 2 subtitles" */
export function probeSummary(t: TFunction, probe: VideoProbe): string {
  const parts: string[] = [];
  if (probe.video) {
    const depth =
      probe.video.bitDepth > 8
        ? ` ${t('core:video_publisher.summary.bit_depth', {
            bits: probe.video.bitDepth,
          })}`
        : '';
    parts.push(`${videoCodecName(probe.video.codec)}${depth}`);
  }
  const audio =
    probe.audio.find((stream) => stream.isDefault) ?? probe.audio[0];
  if (audio) {
    parts.push(
      `${audioCodecName(audio.codec)} ${channelLayout(t, audio.channels)}`
    );
  }
  if (probe.audio.length > 1) {
    parts.push(
      t('core:video_publisher.summary.sound_tracks', {
        count: probe.audio.length,
      })
    );
  }
  if (probe.subtitles.length) {
    parts.push(
      t('core:video_publisher.summary.subtitles', {
        count: probe.subtitles.length,
      })
    );
  }
  return parts.join(' · ');
}

/** "1920×1080" as shown (after rotation). */
export const resolutionOf = (probe: VideoProbe): string =>
  probe.video ? `${probe.video.displayWidth}×${probe.video.displayHeight}` : '';

type ListFormatter = { format: (parts: string[]) => string };
// Intl.ListFormat is ES2021, newer than the TypeScript lib Hub builds with.
const ListFormat = (
  Intl as unknown as {
    ListFormat?: new (
      locale: string,
      options: { type: 'conjunction' | 'unit'; style?: 'long' | 'short' }
    ) => ListFormatter;
  }
).ListFormat;

/**
 * "a title, a category and a genre" (conjunction) or "a, b, c" (unit), in
 * the reader's language.
 */
export function listFormat(
  locale: string,
  parts: string[],
  type: 'conjunction' | 'unit' = 'conjunction'
): string {
  try {
    if (ListFormat) {
      return new ListFormat(locale, {
        type,
        ...(type === 'unit' ? { style: 'short' as const } : {}),
      }).format(parts);
    }
  } catch {
    // An unknown locale: the plain list below.
  }
  return parts.join(', ');
}

/** The sound a video goes up with: the chosen one, else its default. */
export function chosenAudio(
  probe: VideoProbe,
  audioIndex?: number | null
): VideoProbe['audio'][number] | undefined {
  if (audioIndex === null) return undefined;
  if (audioIndex === undefined) {
    return probe.audio.find((stream) => stream.isDefault) ?? probe.audio[0];
  }
  return probe.audio.find((stream) => stream.index === audioIndex);
}

/** "AV1 and AAC": the picture and the sound a video keeps, as they are. */
export function keptFormatText(
  locale: string,
  probe: VideoProbe,
  audioIndex?: number | null
): string {
  const parts = probe.video ? [videoCodecName(probe.video.codec)] : [];
  const audio = chosenAudio(probe, audioIndex);
  if (audio) parts.push(audioCodecName(audio.codec));
  return listFormat(locale, parts);
}

/** File names named in the "left out" note, at most. */
export const LEFT_OUT_NAMED = 3;

/**
 * "Left out: song.mp3 (audio only), notes.txt (not a video) and 2 more."
 * The file names are the user's, not translated.
 */
export function leftOutText(
  t: TFunction,
  locale: string,
  files: readonly LeftOutFile[]
): string {
  const named = files.slice(0, LEFT_OUT_NAMED).map((file) =>
    t('core:video_publisher.drop.left_out_file', {
      name: file.name,
      reason: t(`core:video_publisher.drop.reason_${file.reason}`),
    })
  );
  const list = listFormat(locale, named, 'unit');
  const extra = files.length - named.length;
  return extra > 0
    ? t('core:video_publisher.drop.left_out_more', { extra, files: list })
    : t('core:video_publisher.drop.left_out', { files: list });
}

/** ffprobe's format_name (its first name) as people know the file type. */
const CONTAINERS: Record<string, string> = {
  matroska: 'MKV',
  avi: 'AVI',
  mpeg: 'MPEG',
  mpegts: 'TS',
  mpegtsraw: 'TS',
  flv: 'FLV',
  asf: 'WMV',
  ogg: 'OGG',
  rm: 'RealMedia',
  dv: 'DV',
  mxf: 'MXF',
  nut: 'NUT',
  ivf: 'IVF',
};

/** Extensions ffprobe names as one family, told apart by the file name. */
const FAMILY_EXTENSIONS: Record<string, Record<string, string>> = {
  mov: { mov: 'MOV', m4v: 'M4V', '3gp': '3GP', '3g2': '3G2', mp4: 'MP4' },
  matroska: { webm: 'WebM', mkv: 'MKV' },
  mpeg: { vob: 'VOB', mpg: 'MPEG', mpeg: 'MPEG' },
  mpegts: { m2ts: 'M2TS', mts: 'MTS', ts: 'TS' },
  asf: { wmv: 'WMV', asf: 'ASF' },
};

/**
 * "MKV", "MP4", "WebM", "VOB": the original's file type. What ffprobe found
 * decides; the file name only tells apart the files of one family (an MP4
 * from a MOV, a WebM from an MKV).
 */
export function containerName(probe: VideoProbe, fileName = ''): string {
  const family = (probe.container ?? '').split(',')[0]?.trim() ?? '';
  const ext = /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const byName = FAMILY_EXTENSIONS[family]?.[ext];
  if (byName) return byName;
  if (family === 'mov') return 'MP4';
  return CONTAINERS[family] ?? family.toUpperCase();
}
