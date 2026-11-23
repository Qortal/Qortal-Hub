/**
 * Torq posts with a video (Torq's deployed bundle, 2026-11-14).
 *
 * - An uploaded video is a Q-Tube video (Torq's ids have 8 characters, so it
 *   also shows in Q-Tube), then the post DOCUMENT naming its metadata with
 *   `source: "upload"` (deleting the post in Torq deletes the video too) and
 *   `display: "card"` (shown as a Q-Tube card).
 * - A video already on Q-Tube is only named, without `mimeType` and
 *   `source`, and its Q-Tube link goes into the text for Quitter readers, as
 *   Torq does when a Q-Tube link is attached.
 *
 * The post itself is Hub's Torq composer's format (torqPublish.ts): Quitter's
 * identifier, text, the @mention and #hashtag keywords as description.
 */
import {
  assertPostFitsQuitter,
  firstMentionKeyword,
  normalizePostText,
} from '../../components/Widgets/quitter/quitterPublish';
import { buildQuitterPostIdentifier } from '../../components/Widgets/quitter/quitterIdentity';
import { packTorqHashtagKeywords } from '../../components/Widgets/quitter/torqPublish';
import { base64ByteLength, jsonToBase64 } from './encoding';
import { VideoPublishError } from './errors';
import { TORQ_VIDEO_ID_LENGTH } from './ids';
import { qtubeVideoLink, torqPostLink, torqPostTarget } from './links';
import {
  buildQtubeFormatVideo,
  type QtubeVideoInput,
  type QtubeVideoPlan,
  requireName,
} from './qtube';
import type { PublishedRecord, PublishStep } from './types';

/** Torq's video dialog. */
export const TORQ_VIDEO_TITLE_MAX_LENGTH = 100;

export type TorqPostVideo = {
  identifier: string;
  service: 'DOCUMENT';
  name: string;
  mimeType?: string;
  source?: 'upload';
  display: 'card';
};

export type TorqPost = {
  text: string;
  timestamp: number;
  name: string;
  videos: TorqPostVideo[];
};

export type TorqPostPlan = {
  steps: PublishStep[];
  postStepKey: string;
  postIdentifier: string;
  post: TorqPost;
  record: PublishedRecord;
};

function appendLinkIfMissing(text: string, link: string): string {
  if (text.includes(link)) return text;
  return text ? `${text}\n\n${link}` : link;
}

async function buildPostStep({
  key,
  name,
  text,
  video,
  dependsOn,
}: {
  key: string;
  name: string;
  text: string;
  video: TorqPostVideo;
  dependsOn: string[];
}): Promise<{ step: PublishStep; post: TorqPost; identifier: string }> {
  const identifier = await buildQuitterPostIdentifier();
  const post: TorqPost = {
    text,
    timestamp: Date.now(),
    name,
    videos: [video],
  };
  const base64 = jsonToBase64(post);
  try {
    assertPostFitsQuitter(base64);
  } catch (error) {
    throw new VideoPublishError('post-too-large', undefined, { cause: error });
  }
  const mention = await firstMentionKeyword(text);
  const hashtags = packTorqHashtagKeywords(text.match(/#\w+/g) ?? [], [
    mention,
  ]);
  const description = [hashtags, mention].filter(Boolean).join(',');
  return {
    identifier,
    post,
    step: {
      key: `${key}:post`,
      kind: 'post',
      service: 'DOCUMENT',
      identifier,
      ...(description ? { description } : {}),
      data: { base64 },
      dependsOn,
      bytes: base64ByteLength(base64),
    },
  };
}

export type TorqVideoPostInput = QtubeVideoInput & {
  /** The post's text (may be empty: the video is the post). */
  text?: string;
};

/** Upload a video and post it on Torq, in one go. */
export async function buildTorqVideoPost(
  input: TorqVideoPostInput
): Promise<TorqPostPlan & { video: QtubeVideoPlan }> {
  const key = input.key || 'torq';
  const name = requireName(input.name);
  const video = await buildQtubeFormatVideo(
    { ...input, key },
    {
      idLength: TORQ_VIDEO_ID_LENGTH,
      titleMaxLength: TORQ_VIDEO_TITLE_MAX_LENGTH,
    }
  );
  const { step, post, identifier } = await buildPostStep({
    key,
    name,
    text: normalizePostText(input.text || ''),
    video: {
      identifier: video.metadataIdentifier,
      service: 'DOCUMENT',
      name,
      mimeType: video.metadata.videoType,
      source: 'upload',
      display: 'card',
    },
    dependsOn: [video.metadataStepKey],
  });
  return {
    steps: [...video.steps, step],
    postStepKey: step.key,
    postIdentifier: identifier,
    post,
    video,
    record: {
      app: 'torq',
      name,
      title: video.title,
      link: torqPostLink(name, identifier),
      open: torqPostTarget(name, identifier),
      resources: [
        ...video.resources,
        { service: 'DOCUMENT', name, identifier, kind: 'post' },
      ],
    },
  };
}

export type TorqLinkPostInput = {
  key?: string;
  name: string;
  text?: string;
  /** The Q-Tube video: its publisher and metadata identifier. */
  video: { name: string; metadataIdentifier: string; title?: string };
};

/**
 * Post a video already on Q-Tube (or Subscreen) without uploading it again.
 * Removing this post later leaves the video where it is.
 */
export async function buildTorqLinkPost(
  input: TorqLinkPostInput
): Promise<TorqPostPlan> {
  const key = input.key || 'torq';
  const name = requireName(input.name);
  const videoName = input.video?.name?.trim();
  const metadataIdentifier = input.video?.metadataIdentifier?.trim();
  if (!videoName || !metadataIdentifier) {
    throw new VideoPublishError('video-required');
  }
  const text = appendLinkIfMissing(
    normalizePostText(input.text || ''),
    qtubeVideoLink(videoName, metadataIdentifier)
  );
  const { step, post, identifier } = await buildPostStep({
    key,
    name,
    text,
    video: {
      identifier: metadataIdentifier,
      service: 'DOCUMENT',
      name: videoName,
      display: 'card',
    },
    dependsOn: [],
  });
  return {
    steps: [step],
    postStepKey: step.key,
    postIdentifier: identifier,
    post,
    record: {
      app: 'torq',
      name,
      title: input.video.title || '',
      link: torqPostLink(name, identifier),
      open: torqPostTarget(name, identifier),
      resources: [{ service: 'DOCUMENT', name, identifier, kind: 'post' }],
    },
  };
}
