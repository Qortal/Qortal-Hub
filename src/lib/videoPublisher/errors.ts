/**
 * Errors from the video publishing library carry a stable code, never
 * user-facing text: the window maps each code to its own i18n string
 * (`core:video_publisher.error.<code>`).
 */
export type VideoPublishErrorCode =
  // Input the builders refuse.
  | 'name-required'
  | 'title-required'
  | 'category-required'
  | 'cover-required'
  | 'video-required'
  | 'episodes-required'
  | 'invalid-language'
  | 'subtitle-too-large'
  | 'metadata-too-large'
  | 'post-too-large'
  | 'post-empty'
  | 'nothing-to-remove'
  // Images.
  | 'image-unreadable'
  | 'image-encode-failed'
  | 'image-too-large'
  // The converted file and its upload.
  | 'bridge-missing'
  | 'unsupported-operation'
  // Publishing.
  | 'network'
  | 'refused'
  | 'needs-api-key'
  | 'publish-failed'
  | 'dependency-failed'
  | 'stopped'
  | 'cancelled'
  | 'slot-timeout';

export class VideoPublishError extends Error {
  readonly code: VideoPublishErrorCode;
  /** The underlying message (node answer, exception), for logs only. */
  readonly detail?: string;

  constructor(
    code: VideoPublishErrorCode,
    detail?: string,
    options?: { cause?: unknown }
  ) {
    super(code);
    this.name = 'VideoPublishError';
    this.code = code;
    this.detail = detail;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export const isVideoPublishError = (
  value: unknown
): value is VideoPublishError => value instanceof VideoPublishError;
