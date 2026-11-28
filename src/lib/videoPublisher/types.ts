import type { QAppFileReference } from '../../qortal/qapp-file-reference';

export type PublishService =
  | 'VIDEO'
  | 'DOCUMENT'
  | 'FILE'
  | 'THUMBNAIL'
  | 'PLAYLIST';

export type PublishStepKind =
  | 'video'
  | 'subtitle'
  | 'metadata'
  | 'thumbnail'
  | 'playlist'
  | 'post'
  | 'file'
  /** Subscreen: a title's cast & crew, and a person it names. */
  | 'credits'
  | 'person';

export type PublishStepData =
  | { base64: string }
  | { file: Blob | QAppFileReference };

/** One QDN publish: one resource, one transaction, one fee. */
export type PublishStep = {
  /** Unique within a run; `dependsOn` names other steps by it. */
  key: string;
  kind: PublishStepKind;
  service: PublishService;
  identifier: string;
  title?: string;
  description?: string;
  tag1?: string;
  filename?: string;
  data: PublishStepData;
  /** Published only when every one of these went through. */
  dependsOn?: string[];
  /** Bytes the step uploads. */
  bytes: number;
};

export type VideoPublishApp = 'qtube' | 'subscreen' | 'torq' | 'qshare';

/** What Hub's `addTab` event opens: a Q-App at a path inside it. */
export type AppTabTarget = { service: 'APP'; name: string; path: string };

export type PublishedResource = {
  service: PublishService;
  name: string;
  identifier: string;
  kind: PublishStepKind;
  filename?: string;
};

/**
 * What one item leaves on QDN once its steps went through: enough to link
 * to it and to remove it later (keep it with the window's results).
 */
export type PublishedRecord = {
  app: VideoPublishApp;
  name: string;
  title: string;
  link: string;
  open: AppTabTarget;
  /** Every resource this item publishes, in publishing order. */
  resources: PublishedResource[];
};

/** The converted MP4, as the engine reports it (VideoJobOutput). */
export type ConvertedVideo = {
  /** A job file reference (createJobFileReference) or, in tests, a Blob. */
  data: Blob | QAppFileReference;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  /** Default "video/mp4". */
  mimeType?: string;
};

/** A WebVTT subtitle track, read back from the job (readText). */
export type SubtitleTrack = {
  /** ISO 639-1 (normalizeLanguage). */
  language: string;
  vtt: string;
};
