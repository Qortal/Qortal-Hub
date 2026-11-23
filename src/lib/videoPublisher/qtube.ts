/**
 * A video in Q-Tube's format, which Subscreen and Torq publish too: the MP4
 * as a VIDEO, its subtitles, and the metadata DOCUMENT that lists it.
 *
 * Checked against the deployed Q-Tube (2026-08-01), Subscreen 1.1.3 and
 * real records (see __fixtures__/real-records.json). Unlike Q-Tube, which
 * sends the metadata first, the VIDEO goes first and the metadata only once
 * it went through, so a failed upload never leaves a listing that can't play.
 */
import { QUITTER_MAX_POST_BYTES } from '../../components/Widgets/quitter/quitterPublish';
import { isQtubeCategory, isQtubeSubcategoryOf } from './categories';
import { base64ByteLength, jsonToBase64 } from './encoding';
import { VideoPublishError } from './errors';
import {
  fullDescription as plainDescription,
  htmlDescription,
  qtubeQdnDescription,
} from './html';
import {
  identifierSlug,
  qdnTitle,
  QTUBE_ID_LENGTH,
  randomCode,
  randomVideoId,
  singleLineTitle,
  sliceText,
  videoFileName,
} from './ids';
import { isImageDataUrl } from './images';
import { qtubeVideoLink, qtubeVideoTarget } from './links';
import { buildSubtitleSteps } from './subtitles';
import type {
  ConvertedVideo,
  PublishedRecord,
  PublishedResource,
  PublishStep,
  SubtitleTrack,
} from './types';

export const QTUBE_VIDEO_BASE = 'qtube_vid_';
export const QTUBE_METADATA_SUFFIX = '_metadata';
export const QTUBE_METADATA_FILENAME = 'video_metadata.json';
/** Q-Tube's title field. Subscreen allows 120 and Torq 100. */
export const QTUBE_TITLE_MAX_LENGTH = 180;
/** qapp-core lists skip any resource of 5 MiB or more. */
export const LISTING_MAX_BYTES = QUITTER_MAX_POST_BYTES;
/** Q-Tube's hover frames: one from each quarter. */
export const EXTRACT_COUNT = 4;

export type QtubeVideoInput = {
  /** Prefix of this item's step keys. */
  key?: string;
  name: string;
  title: string;
  /** Plain text; blank lines separate paragraphs. */
  description?: string;
  category: number;
  subcategory?: number | null;
  /** The cover, a WebP data URL (makeCover). */
  cover: string;
  /** Hover frames, WebP data URLs (makeExtracts); the cover stands in. */
  extracts?: readonly string[];
  video: ConvertedVideo;
  subtitles?: readonly SubtitleTrack[];
};

/** How Subscreen and Torq differ from Q-Tube itself. */
export type QtubeFormatOptions = {
  idLength?: number;
  titleMaxLength?: number;
  /** `fullDescription`'s cut; null keeps it whole (Subscreen). */
  fullDescriptionLimit?: number | null;
  /** Subscreen: a film's year. */
  year?: number | null;
  /** Subscreen: 360, 480, 720 or 1080 (subscreenQuality). */
  quality?: number | null;
};

/** The metadata DOCUMENT's JSON, keys in the apps' order. */
export type QtubeVideoMetadata = {
  title: string;
  version: 1;
  fullDescription: string;
  htmlDescription: string;
  videoImage: string;
  videoReference: { name: string; identifier: string; service: 'VIDEO' };
  extracts: string[];
  commentsId: string;
  category: number;
  subcategory: number | '';
  year?: number;
  code: string;
  videoType: string;
  filename: string;
  fileSize: number;
  duration: number;
  quality?: number;
};

export type QtubeVideoPlan = {
  steps: PublishStep[];
  videoStepKey: string;
  metadataStepKey: string;
  videoIdentifier: string;
  metadataIdentifier: string;
  code: string;
  title: string;
  metadata: QtubeVideoMetadata;
  resources: PublishedResource[];
};

const DEFAULT_KEY = 'video';

export function assertQtubeCategory(
  category: number,
  subcategory?: number | null
): void {
  if (!isQtubeCategory(category)) {
    throw new VideoPublishError('category-required', String(category));
  }
  if (subcategory != null && !isQtubeSubcategoryOf(category, subcategory)) {
    throw new VideoPublishError(
      'category-required',
      `${category}/${subcategory}`
    );
  }
}

export function assertListingFits(base64: string): void {
  if (base64ByteLength(base64) >= LISTING_MAX_BYTES) {
    throw new VideoPublishError(
      'metadata-too-large',
      String(base64ByteLength(base64))
    );
  }
}

/** A title the app accepts: one line, cut to its limit; refuses an empty one. */
export function requireTitle(title: string, maxLength: number): string {
  const clean = sliceText(singleLineTitle(title || ''), maxLength).trim();
  if (!clean) throw new VideoPublishError('title-required');
  return clean;
}

export function requireName(name: string): string {
  const clean = (name || '').trim();
  if (!clean) throw new VideoPublishError('name-required');
  return clean;
}

/** Up to four hover frames; the cover four times when there are none. */
function hoverFrames(cover: string, extracts?: readonly string[]): string[] {
  const frames = (extracts || []).filter(isImageDataUrl);
  return (frames.length ? frames : Array(EXTRACT_COUNT).fill(cover)).slice(
    0,
    EXTRACT_COUNT
  );
}

/** The shared builder behind Q-Tube, Subscreen and Torq videos. */
export async function buildQtubeFormatVideo(
  input: QtubeVideoInput,
  options: QtubeFormatOptions = {}
): Promise<QtubeVideoPlan> {
  const key = input.key || DEFAULT_KEY;
  const name = requireName(input.name);
  const title = requireTitle(
    input.title,
    options.titleMaxLength ?? QTUBE_TITLE_MAX_LENGTH
  );
  assertQtubeCategory(input.category, input.subcategory);
  if (!isImageDataUrl(input.cover)) {
    throw new VideoPublishError('cover-required');
  }
  const { video } = input;
  if (!video?.data || !(video.size > 0)) {
    throw new VideoPublishError('video-required');
  }

  const id = randomVideoId(options.idLength ?? QTUBE_ID_LENGTH);
  const videoIdentifier = `${QTUBE_VIDEO_BASE}${identifierSlug(title)}_${id}`;
  const metadataIdentifier = `${videoIdentifier}${QTUBE_METADATA_SUFFIX}`;
  const code = randomCode();
  const description = input.description || '';
  const plain = plainDescription(description, null);
  const filename = videoFileName(title);
  const subcategory = input.subcategory ?? '';

  const metadata: QtubeVideoMetadata = {
    title,
    version: 1,
    fullDescription: plainDescription(
      description,
      options.fullDescriptionLimit
    ),
    htmlDescription: htmlDescription(description),
    videoImage: input.cover,
    videoReference: { name, identifier: videoIdentifier, service: 'VIDEO' },
    extracts: hoverFrames(input.cover, input.extracts),
    commentsId: `${QTUBE_VIDEO_BASE}_cm_${id}`,
    category: input.category,
    subcategory,
    ...(options.year ? { year: options.year } : {}),
    code,
    videoType: video.mimeType || 'video/mp4',
    filename,
    fileSize: video.size,
    duration: video.durationSec,
    ...(options.quality ? { quality: options.quality } : {}),
  };
  const metadataBase64 = jsonToBase64(metadata);
  assertListingFits(metadataBase64);

  const qdnDescription = qtubeQdnDescription(
    input.category,
    subcategory,
    code,
    plain
  );
  const shared = {
    title: qdnTitle(title),
    description: qdnDescription,
    tag1: QTUBE_VIDEO_BASE,
  };
  const videoStepKey = `${key}:video`;
  const metadataStepKey = `${key}:metadata`;

  const videoStep: PublishStep = {
    key: videoStepKey,
    kind: 'video',
    service: 'VIDEO',
    identifier: videoIdentifier,
    ...shared,
    filename,
    data: { file: video.data },
    bytes: video.size,
  };
  const subtitleSteps = await buildSubtitleSteps({
    key,
    name,
    videoIdentifier,
    baseName: filename.replace(/\.mp4$/, ''),
    tracks: input.subtitles || [],
    dependsOn: [videoStepKey],
  });
  const metadataStep: PublishStep = {
    key: metadataStepKey,
    kind: 'metadata',
    service: 'DOCUMENT',
    identifier: metadataIdentifier,
    ...shared,
    filename: QTUBE_METADATA_FILENAME,
    data: { base64: metadataBase64 },
    // It lists the subtitles too: no listing goes up while one is missing.
    dependsOn: [videoStepKey, ...subtitleSteps.map((step) => step.key)],
    bytes: base64ByteLength(metadataBase64),
  };

  const steps = [videoStep, ...subtitleSteps, metadataStep];
  return {
    steps,
    videoStepKey,
    metadataStepKey,
    videoIdentifier,
    metadataIdentifier,
    code,
    title,
    metadata,
    resources: steps.map((step) => ({
      service: step.service,
      name,
      identifier: step.identifier,
      kind: step.kind,
      filename: step.filename,
    })),
  };
}

/** A video for Q-Tube itself. */
export async function buildQtubeVideo(
  input: QtubeVideoInput
): Promise<QtubeVideoPlan & { record: PublishedRecord }> {
  const plan = await buildQtubeFormatVideo(input);
  const name = input.name.trim();
  return {
    ...plan,
    record: {
      app: 'qtube',
      name,
      title: plan.title,
      link: qtubeVideoLink(name, plan.metadataIdentifier),
      open: qtubeVideoTarget(name, plan.metadataIdentifier),
      resources: plan.resources,
    },
  };
}
