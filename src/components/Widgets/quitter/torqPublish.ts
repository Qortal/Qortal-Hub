/**
 * Publish a public Torq post from Home's Torq feed: text, photos and a poll.
 *
 * Mirrors Torq's `publishPost` (Torq repo, src/utils/postQdn.ts), as GO's
 * composer does: Torq posts ARE Quitter posts (same `quitter` identifiers
 * and DOCUMENT), plus Torq-only fields (`poll`, `richText`), and the post's
 * own Torq link appended to `text` when Quitter readers can't see all of it.
 */
import i18n from '../../../i18n/i18n';
import { objectToBase64 } from '../../../qdn/encryption/group-encryption';
import { compressImageFile } from '../../../utils/imageCompression';
import { buildQuitterPostIdentifier } from './quitterIdentity';
import {
  assertPostFitsQuitter,
  encodeImageForPost,
  firstMentionKeyword,
  normalizePostText,
  POST_IMAGE_BUDGET,
  publishMultipleResources,
  QuitterPublishCancelledError,
  shrinkPostImagesToBudget,
} from './quitterPublish';
import { torqPostLink } from './torqFeed';

export const TORQ_MAX_IMAGES = 10;
/** Quitter's grid shows two rows of two and clips the rest. */
const QUITTER_VISIBLE_IMAGES = 4;
export const TORQ_MIN_POLL_OPTIONS = 2;
export const TORQ_MAX_POLL_OPTIONS = 6;
export const TORQ_MAX_POLL_OPTION_LENGTH = 80;

const QDN_DESCRIPTION_MAX_BYTES = 240;
const HASHTAG_MAX_CHARS = 70;

type TorqPollOption = { id: string; text: string };

export type TorqPoll = {
  options: TorqPollOption[];
  anonymous?: true;
  voteKey?: string;
};

type TorqPublishInput = {
  /** Plain body; paragraphs separated by blank lines. */
  text: string;
  /** Sanitized HTML, only when the post has formatting. */
  richText?: string;
  userName: string;
  images?: { file: File }[];
  poll?: TorqPoll | null;
  onProgress?: (message: string, percent: number) => void;
  /**
   * Called as the post goes to Hub's approval dialog. From then on it is up
   * to the dialog: `signal` no longer cancels it.
   */
  onSubmitted?: () => void;
  signal?: AbortSignal;
};

/**
 * Quitter ignores polls and clips big photo sets, so those posts carry their
 * own Torq link (Torq's needsTorqPostLink; Torq hides that link again when it
 * renders the post, and so does Home's feed).
 */
export function needsTorqPostLink({
  hasPoll,
  imageCount,
}: {
  hasPoll: boolean;
  imageCount: number;
}): boolean {
  return hasPoll || imageCount > QUITTER_VISIBLE_IMAGES;
}

const createTorqPollOptionId = (index: number) => `opt_${index + 1}`;

/** Torq anon polls: votes are sealed with this 32-byte key (base64). */
function createTorqAnonVoteKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/** Torq's normalizePoll: trim, clip, drop empty and duplicate choices. */
export function normalizeTorqPoll(
  choices: string[],
  settings?: { anonymous?: boolean; voteKey?: string }
): TorqPoll | null {
  const seen = new Set<string>();
  const options: TorqPollOption[] = [];
  choices.forEach((raw, index) => {
    const text = raw.trim().slice(0, TORQ_MAX_POLL_OPTION_LENGTH);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ id: createTorqPollOptionId(index), text });
  });
  if (options.length < TORQ_MIN_POLL_OPTIONS) return null;
  if (!settings?.anonymous) return { options };
  const voteKey = settings.voteKey || createTorqAnonVoteKey();
  return { options, anonymous: true, voteKey };
}

/** `~#tag~` keywords that fit the 240-byte description beside the mention. */
export function packTorqHashtagKeywords(
  tags: string[],
  extras: string[] = []
): string {
  const seen = new Set<string>();
  const chosen: string[] = [];
  const reserved = extras.filter((part) => part.length > 0);
  const wrap = (tag: string) => `~${tag.trim().toLowerCase()}~`;
  for (const raw of tags) {
    const clipped = raw.trim().slice(0, HASHTAG_MAX_CHARS);
    if (!clipped) continue;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    const description = [
      [...chosen, clipped].map(wrap).join(','),
      ...reserved,
    ].join(',');
    if (
      new TextEncoder().encode(description).length > QDN_DESCRIPTION_MAX_BYTES
    ) {
      break;
    }
    seen.add(key);
    chosen.push(clipped);
  }
  return chosen.map(wrap).join(',');
}

function appendLinkIfMissing(text: string, url: string): string {
  const link = url.trim();
  if (!link || text.includes(link)) return text;
  const trimmed = text.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${link}` : link;
}

/** Same settings as Torq's compressImage: WebP 0.75, 1920 px wide. */
function compressImageForTorq(file: File): Promise<File> {
  return compressImageFile(file, {
    first: { quality: 0.75, maxWidth: 1920, mimeType: 'image/webp' },
    fallback: { quality: 0.72, maxWidth: 1920, mimeType: 'image/jpeg' },
  });
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new QuitterPublishCancelledError();
};

export async function publishTorqPost(
  input: TorqPublishInput
): Promise<{ postIdentifier: string }> {
  const { userName, onProgress, onSubmitted, signal } = input;
  const images = input.images || [];
  const poll = input.poll || null;
  const t = (key: string, options: Record<string, unknown> = {}) =>
    i18n.t(`core:torq_composer.${key}`, {
      ...options,
      postProcess: 'capitalizeFirstChar',
    });

  if (!userName?.trim()) throw new Error(t('error.name_required'));
  if (images.length > TORQ_MAX_IMAGES) {
    throw new Error(t('error.too_many_images', { count: TORQ_MAX_IMAGES }));
  }

  const text = normalizePostText(input.text || '');
  const hasContent =
    text ||
    images.length ||
    (poll && poll.options.length >= TORQ_MIN_POLL_OPTIONS);
  if (!hasContent) throw new Error(t('error.empty_post'));

  throwIfAborted(signal);
  onProgress?.(t('progress.preparing_post'), 5);

  const postIdentifier = await buildQuitterPostIdentifier();
  const postLink = torqPostLink(userName, postIdentifier);

  // Photos stay inline in the post, as raw base64.
  const postImages: { src: string }[] = [];
  for (let index = 0; index < images.length; index += 1) {
    throwIfAborted(signal);
    onProgress?.(
      t('progress.compressing_images', {
        current: index + 1,
        total: images.length,
      }),
      8 + Math.round((index / Math.max(1, images.length)) * 52)
    );
    const prepared = await compressImageForTorq(images[index].file);
    postImages.push({ src: await encodeImageForPost(prepared, index) });
  }
  // Ten full-size photos easily pass the 5 MiB Quitter lists allow.
  const fitted = await shrinkPostImagesToBudget(
    images.map((item) => item.file),
    postImages.map((item) => item.src),
    POST_IMAGE_BUDGET,
    signal
  );
  fitted.forEach((src, index) => {
    postImages[index] = { src };
  });

  // Compat link for Quitter readers, who can't see a poll or every photo.
  const publishedText = needsTorqPostLink({
    hasPoll: Boolean(poll),
    imageCount: postImages.length,
  })
    ? appendLinkIfMissing(text, postLink)
    : text;

  const post = {
    text: publishedText,
    timestamp: Date.now(),
    name: userName,
    ...(postImages.length > 0 ? { images: postImages } : {}),
    ...(poll ? { poll } : {}),
    ...(input.richText ? { richText: input.richText } : {}),
  };

  const mentionString = await firstMentionKeyword(text);
  const keywordString = packTorqHashtagKeywords(text.match(/#\w+/g) ?? [], [
    mentionString,
  ]);
  const postBase64 = String(await objectToBase64(post));
  assertPostFitsQuitter(postBase64);
  const postResource: Record<string, unknown> = {
    identifier: postIdentifier,
    service: 'DOCUMENT',
    base64: postBase64,
    name: userName,
  };
  const description = [keywordString, mentionString].filter(Boolean).join(',');
  if (description) postResource.description = description;

  throwIfAborted(signal);
  onProgress?.(t('progress.publishing_post'), 70);
  onSubmitted?.();
  await publishMultipleResources([postResource]);
  return { postIdentifier };
}
