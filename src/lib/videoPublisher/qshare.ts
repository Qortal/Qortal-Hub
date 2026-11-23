/**
 * A video shared on Q-Share (2.1.0, deployed 2026-11-10; its
 * src/utils/publishPayload.ts): the MP4 as a FILE, an optional THUMBNAIL,
 * then the share's DOCUMENT naming them. Q-Share's player has no subtitles,
 * so subtitle tracks go into the share as extra .vtt files for downloading.
 */
import { QSHARE_VIDEO_CATEGORY, isQshareVideoSubcategory } from './categories';
import {
  base64ByteLength,
  dataUrlBase64,
  dataUrlMimeType,
  jsonToBase64,
  textToBase64,
} from './encoding';
import { VideoPublishError } from './errors';
import { fullDescription, htmlDescription } from './html';
import {
  identifierSlug,
  qdnTitle,
  QTUBE_ID_LENGTH,
  randomVideoId,
  sliceText,
} from './ids';
import { QSHARE_THUMBNAIL_MAX_BYTES } from './images';
import { qshareLink, qshareTarget } from './links';
import { assertListingFits, requireName } from './qtube';
import { assertSubtitleTrack, subtitleFileName } from './subtitles';
import type {
  ConvertedVideo,
  PublishedRecord,
  PublishStep,
  SubtitleTrack,
} from './types';

export const QSHARE_FILE_BASE = 'qshare_file_';
export const QSHARE_THUMBNAIL_BASE = 'qshare_thumb_';
export const QSHARE_THUMBNAIL_FILENAME = 'thumbnail.webp';
export const QSHARE_METADATA_FILENAME = 'video_metadata.json';
export const QSHARE_TITLE_MAX_LENGTH = 180;

/** Characters Q-Share's title field drops as they are typed. */
const QSHARE_TITLE_DROPPED = /[^a-zA-Z0-9\s\-_!?()&'",.;:|—~@#$%^*+=<>]/g;
/** Q-Share strips these from a FILE resource's file name. */
const FILENAME_DROPPED = /[\r\n/<>:"'\\*|?]+/g;

/** A title as Q-Share's form would leave it (plain ASCII and punctuation). */
export const qshareTitle = (title: string): string =>
  sliceText(
    (title || '')
      .replace(/[\r\n]+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(QSHARE_TITLE_DROPPED, '')
      .replace(/\s+/g, ' ')
      .trim(),
    QSHARE_TITLE_MAX_LENGTH
  ).trim();

export type QshareFileRef = {
  filename: string;
  identifier: string;
  name: string;
  service: 'FILE';
  mimetype: string;
  size: number;
};

export type QshareThumbnailRef = {
  service: 'THUMBNAIL';
  name: string;
  identifier: string;
};

/** The share DOCUMENT's JSON, keys in Q-Share's order. */
export type QshareMetadata = {
  title: string;
  version: 1;
  fullDescription: string;
  htmlDescription: string;
  commentsId: string;
  category: string;
  subcategory: string;
  subcategory2: '';
  files: QshareFileRef[];
  thumbnail?: QshareThumbnailRef;
};

export type QshareVideoInput = {
  key?: string;
  name: string;
  title: string;
  description?: string;
  /** 404–423 or 499 (QSHARE_VIDEO_SUBCATEGORIES). */
  subcategory: number;
  video: ConvertedVideo;
  /** The video's file name in the share; ".mp4" is added when missing. */
  fileName?: string;
  /** WebP data URL within 200 KB (makeQshareThumbnail), or none. */
  thumbnail?: string | null;
  subtitles?: readonly SubtitleTrack[];
};

export type QshareVideoPlan = {
  steps: PublishStep[];
  metadataStepKey: string;
  metadataIdentifier: string;
  fileIdentifier: string;
  metadata: QshareMetadata;
  record: PublishedRecord;
};

function shareFileName(fileName: string | undefined, title: string): string {
  const base = (fileName || title || 'video')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .trim();
  return `${base || 'video'}.mp4`;
}

export async function buildQshareVideo(
  input: QshareVideoInput
): Promise<QshareVideoPlan> {
  const key = input.key || 'share';
  const name = requireName(input.name);
  const title = qshareTitle(input.title);
  if (!title) throw new VideoPublishError('title-required');
  if (!isQshareVideoSubcategory(input.subcategory)) {
    throw new VideoPublishError('category-required', String(input.subcategory));
  }
  const { video } = input;
  if (!video?.data || !(video.size > 0)) {
    throw new VideoPublishError('video-required');
  }
  const subtitles = input.subtitles || [];
  subtitles.forEach(assertSubtitleTrack);

  const slug = identifierSlug(title, 'share');
  const used = new Set<string>();
  const newIdentifier = (base: string) => {
    let identifier: string;
    do {
      identifier = `${base}${slug}_${randomVideoId(QTUBE_ID_LENGTH)}`;
    } while (used.has(identifier));
    used.add(identifier);
    return identifier;
  };

  const description = input.description || '';
  const plain = fullDescription(description);
  const qdnDescription =
    `**cat:${QSHARE_VIDEO_CATEGORY};sub:${input.subcategory}**` + plain;
  const shared = {
    title: qdnTitle(title),
    description: qdnDescription,
    tag1: QSHARE_FILE_BASE,
  };

  const steps: PublishStep[] = [];
  const files: QshareFileRef[] = [];
  const videoFileName = shareFileName(input.fileName, title);
  const videoIdentifier = newIdentifier(QSHARE_FILE_BASE);
  const videoStepKey = `${key}:file`;
  steps.push({
    key: videoStepKey,
    kind: 'file',
    service: 'FILE',
    identifier: videoIdentifier,
    ...shared,
    filename: videoFileName.replace(FILENAME_DROPPED, ''),
    data: { file: video.data },
    bytes: video.size,
  });
  files.push({
    filename: videoFileName,
    identifier: videoIdentifier,
    name,
    service: 'FILE',
    mimetype: video.mimeType || 'video/mp4',
    size: video.size,
  });

  const subtitleBase = videoFileName.replace(/\.mp4$/, '');
  for (const [index, track] of subtitles.entries()) {
    const filename = subtitleFileName(subtitleBase, track.language);
    const base64 = textToBase64(track.vtt);
    const identifier = newIdentifier(QSHARE_FILE_BASE);
    const size = base64ByteLength(base64);
    steps.push({
      key: `${key}:subtitle:${index}`,
      kind: 'subtitle',
      service: 'FILE',
      identifier,
      ...shared,
      filename: filename.replace(FILENAME_DROPPED, ''),
      data: { base64 },
      dependsOn: [videoStepKey],
      bytes: size,
    });
    files.push({
      filename,
      identifier,
      name,
      service: 'FILE',
      mimetype: 'text/vtt',
      size,
    });
  }

  let thumbnail: QshareThumbnailRef | undefined;
  if (input.thumbnail) {
    const base64 = dataUrlBase64(input.thumbnail);
    if (!base64 || !dataUrlMimeType(input.thumbnail)?.startsWith('image/')) {
      throw new VideoPublishError('image-unreadable');
    }
    const bytes = base64ByteLength(base64);
    if (bytes > QSHARE_THUMBNAIL_MAX_BYTES) {
      throw new VideoPublishError('image-too-large', String(bytes));
    }
    const identifier = newIdentifier(QSHARE_THUMBNAIL_BASE);
    thumbnail = { service: 'THUMBNAIL', name, identifier };
    steps.push({
      key: `${key}:thumbnail`,
      kind: 'thumbnail',
      service: 'THUMBNAIL',
      identifier,
      ...shared,
      tag1: QSHARE_THUMBNAIL_BASE,
      filename: QSHARE_THUMBNAIL_FILENAME,
      data: { base64 },
      // Only for a file that went up: else it would point at nothing.
      dependsOn: [videoStepKey],
      bytes,
    });
  }

  const metadataId = randomVideoId(QTUBE_ID_LENGTH);
  const metadataIdentifier = `${QSHARE_FILE_BASE}${slug}_${metadataId}_metadata`;
  const metadata: QshareMetadata = {
    title,
    version: 1,
    fullDescription: plain,
    htmlDescription: htmlDescription(description),
    commentsId: `${QSHARE_FILE_BASE}_cm_${metadataId}`,
    category: String(QSHARE_VIDEO_CATEGORY),
    subcategory: String(input.subcategory),
    subcategory2: '',
    files,
    ...(thumbnail ? { thumbnail } : {}),
  };
  const metadataBase64 = jsonToBase64(metadata);
  assertListingFits(metadataBase64);
  const metadataStepKey = `${key}:metadata`;
  steps.push({
    key: metadataStepKey,
    kind: 'metadata',
    service: 'DOCUMENT',
    identifier: metadataIdentifier,
    ...shared,
    filename: QSHARE_METADATA_FILENAME,
    data: { base64: metadataBase64 },
    // The share names every file and the thumbnail: list it only when all
    // of them went through.
    dependsOn: steps.map((step) => step.key),
    bytes: base64ByteLength(metadataBase64),
  });

  return {
    steps,
    metadataStepKey,
    metadataIdentifier,
    fileIdentifier: videoIdentifier,
    metadata,
    record: {
      app: 'qshare',
      name,
      title,
      link: qshareLink(name, metadataIdentifier),
      open: qshareTarget(name, metadataIdentifier),
      resources: steps.map((step) => ({
        service: step.service,
        name,
        identifier: step.identifier,
        kind: step.kind,
        filename: step.filename,
      })),
    },
  };
}
