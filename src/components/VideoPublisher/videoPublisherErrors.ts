/**
 * Every failure the window can show is a stable code: the engine's
 * (VideoJobErrorCode, VideoToolErrorCode), the publishing library's
 * (VideoPublishErrorCode) and the window's own. Each has one sentence under
 * core:video_publisher.error.<code, with "_" for "-">, saying what happened
 * and what to do.
 */
import { videoToolErrorCode } from '../../../electron/src/video-tool-types';
import { isVideoPublishError } from '../../lib/videoPublisher';

export const VIDEO_PUBLISHER_ERROR_CODES = [
  // Engine: jobs and bridge calls.
  'probe-failed',
  'no-video',
  'too-long-for-limit',
  'disk-full',
  'ffmpeg-failed',
  'output-too-big',
  'source-missing',
  'keep-not-allowed',
  'burn-in-not-supported',
  'invalid-spec',
  'missing-binary',
  'job-missing',
  'not-ready',
  'invalid-request',
  'unsupported-encoding',
  'too-big',
  'frames-failed',
  'save-failed',
  'saved-missing',
  // Publishing.
  'name-required',
  'title-required',
  'category-required',
  'cover-required',
  'video-required',
  'episodes-required',
  'invalid-language',
  'subtitle-too-large',
  'metadata-too-large',
  'post-too-large',
  'post-empty',
  'nothing-to-remove',
  'image-unreadable',
  'image-encode-failed',
  'image-too-large',
  'bridge-missing',
  'unsupported-operation',
  'network',
  'refused',
  'needs-api-key',
  'publish-failed',
  'dependency-failed',
  'stopped',
  'cancelled',
  'slot-timeout',
  // The window's own.
  'no-quality-fits',
  'approval-declined',
  'fee-unknown',
  'balance',
  'removal-interrupted',
  'unknown',
] as const;

export type VideoPublisherErrorCode =
  (typeof VIDEO_PUBLISHER_ERROR_CODES)[number];

const KNOWN = new Set<string>(VIDEO_PUBLISHER_ERROR_CODES);

export const isKnownErrorCode = (
  code: unknown
): code is VideoPublisherErrorCode =>
  typeof code === 'string' && KNOWN.has(code);

/** The i18n key of a code's sentence ('unknown' for codes it doesn't know). */
export const errorMessageKey = (code: string | undefined): string =>
  `core:video_publisher.error.${(isKnownErrorCode(code) ? code : 'unknown').replace(/-/g, '_')}`;

/** The code of anything thrown by the bridge or the publishing library. */
export function errorCodeOf(error: unknown): VideoPublisherErrorCode {
  if (isVideoPublishError(error) && isKnownErrorCode(error.code)) {
    return error.code;
  }
  const tool = videoToolErrorCode(error);
  if (isKnownErrorCode(tool)) return tool;
  return 'unknown';
}
