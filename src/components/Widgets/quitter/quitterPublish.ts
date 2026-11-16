/**
 * Helpers for publishing Quitter-format posts, which Torq posts are: the
 * post body, its photos within Quitter's size limit, the @mention keyword,
 * and the publish request itself.
 */
import i18n from '../../../i18n/i18n';
import {
  compressImageFile,
  ensureImageMetadataFree,
} from '../../../utils/imageCompression';
import { quitterHashString } from './quitterIdentity';
import { TORQ_APP_NAME } from './torqFeed';

/**
 * qapp-core lists skip any QDN resource of 5 MiB or more, and Quitter and
 * Torq build their feeds, profiles and replies from those lists: a bigger
 * post never shows. (Same limit Torq enforces in its publishPost.)
 */
export const QUITTER_MAX_POST_BYTES = 5 * 1024 * 1024;
/** Base64 characters the photos may use, leaving room for text, poll, links. */
export const POST_IMAGE_BUDGET = QUITTER_MAX_POST_BYTES - 256 * 1024;
/** Stronger settings, tried in turn, when a post's photos are too big. */
const IMAGE_FIT_STEPS = [
  { quality: 0.7, maxSide: 1600 },
  { quality: 0.6, maxSide: 1280 },
  { quality: 0.5, maxSide: 1024 },
  { quality: 0.4, maxSide: 800 },
];

/** The publish was cancelled here, or declined in the approval dialog. */
export class QuitterPublishCancelledError extends Error {
  constructor(message = 'Publish cancelled') {
    super(message);
    this.name = 'QuitterPublishCancelledError';
  }
}

const throwIfPublishAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new QuitterPublishCancelledError();
  }
};

const composerError = (key: string, options: Record<string, unknown> = {}) =>
  new Error(
    i18n.t(`core:torq_composer.error.${key}`, {
      ...options,
      postProcess: 'capitalizeFirstChar',
    })
  );

const stripHtmlTags = (html: string): string => {
  if (!html) return '';
  // Prefer regex so we can keep paragraph breaks (textContent collapses them).
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const fileToRawBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64 || '');
    };
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

type FailedPublish = { reason?: unknown };

type PublishResponse = {
  error?: unknown;
  message?: unknown;
  unsuccessfulPublishes?: FailedPublish[];
  failedPublishes?: FailedPublish[];
};

/**
 * Hub answers a declined approval (or one left unanswered) with this error,
 * in the language it was in when the dialog closed.
 */
const isDeclinedResponse = (res: PublishResponse | undefined): boolean => {
  if (typeof res?.error !== 'string') return false;
  const answer = res.error.trim().toLowerCase();
  return [i18n.language, 'en'].some(
    (lng) =>
      answer ===
      i18n
        .t('question:message.generic.user_declined_request', { lng })
        .trim()
        .toLowerCase()
  );
};

/**
 * Publish through Hub's own PUBLISH_MULTIPLE_QDN_RESOURCES, which shows the
 * approval dialog. Declining it throws QuitterPublishCancelledError; once
 * the request is sent, `signal` no longer stops it.
 */
export const publishMultipleResources = async (
  resources: unknown[],
  signal?: AbortSignal,
  timeoutMs = 240000
) => {
  throwIfPublishAborted(signal);
  if (typeof window.sendMessage !== 'function') {
    throw composerError('publish_failed');
  }
  let res: PublishResponse | undefined;
  try {
    res = (await window.sendMessage(
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      { resources },
      timeoutMs,
      true
    )) as PublishResponse | undefined;
  } catch (err) {
    // sendMessage only rejects when Hub never answered.
    console.error('[Torq] PUBLISH_MULTIPLE_QDN_RESOURCES failed', err);
    throw composerError('publish_failed');
  }

  if (isDeclinedResponse(res)) {
    throw new QuitterPublishCancelledError();
  }

  // Success responses may carry a benign `message`: only fail on real errors.
  const nested =
    res?.error && typeof res.error === 'object'
      ? (res.error as PublishResponse)
      : undefined;
  const unsuccessful =
    nested?.unsuccessfulPublishes ||
    res?.unsuccessfulPublishes ||
    res?.failedPublishes;
  const hasFailedPublishes =
    Array.isArray(unsuccessful) && unsuccessful.length > 0;
  if (res?.error || hasFailedPublishes) {
    const reasons = hasFailedPublishes
      ? unsuccessful
          .map((item) => item?.reason)
          .filter((reason) => typeof reason === 'string' && reason)
          .join('; ')
      : '';
    console.error('[Torq] PUBLISH_MULTIPLE_QDN_RESOURCES failed', res);
    if (reasons) throw new Error(reasons);
    if (typeof res?.error === 'string' && res.error) {
      throw new Error(res.error);
    }
    if (typeof res?.message === 'string' && res.message) {
      throw new Error(res.message);
    }
    throw composerError('publish_failed');
  }
  return res;
};

/** Quitter `~@hash~` keyword for the first @mention, or ''. */
export async function firstMentionKeyword(text: string): Promise<string> {
  const mentionMatch = text.match(
    /@\{([^}]+)\}|(?:^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/
  );
  const mentionedName = mentionMatch?.[1] || mentionMatch?.[2];
  if (!mentionedName) return '';
  return `~@${await quitterHashString(mentionedName)}~`;
}

/** Quitter/Torq posts render `text` as plain pre-wrap; never send HTML there. */
export function normalizePostText(raw: string): string {
  const plainText = stripHtmlTags(raw)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // stripHtmlTags would also drop newlines-only markup; keep plain input as-is.
  return /<\/?[a-z][\s\S]*>/i.test(raw)
    ? plainText
    : raw
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Re-compress the largest photos (from their originals) until all of them fit
 * `budget` base64 characters together, like Torq's compressPostImages.
 */
export async function shrinkPostImagesToBudget(
  files: File[],
  encoded: string[],
  budget: number = POST_IMAGE_BUDGET,
  signal?: AbortSignal
): Promise<string[]> {
  const out = [...encoded];
  const total = () => out.reduce((sum, src) => sum + src.length, 0);
  for (const step of IMAGE_FIT_STEPS) {
    if (total() <= budget) break;
    const share = budget / Math.max(1, files.length);
    for (let i = 0; i < files.length; i += 1) {
      if (out[i].length <= share) continue;
      throwIfPublishAborted(signal);
      const pass = {
        quality: step.quality,
        maxWidth: step.maxSide,
        maxHeight: step.maxSide,
      };
      const smaller = await compressImageFile(files[i], {
        first: { ...pass, mimeType: 'image/webp' },
        fallback: { ...pass, mimeType: 'image/jpeg' },
      });
      // These start from the originals: only a result whose metadata is
      // known to be gone may replace the photo already encoded.
      const clean = await ensureImageMetadataFree(smaller);
      if (clean.ok === false) continue;
      const src = await fileToRawBase64(clean.file).catch(() => '');
      if (src && src.length < out[i].length) out[i] = src;
    }
  }
  if (total() > budget) {
    throw composerError('images_too_large');
  }
  return out;
}

/** Refuse a post that Torq and Quitter would silently leave out of a feed. */
export function assertPostFitsQuitter(postBase64: string): void {
  if (Math.ceil((postBase64.length * 3) / 4) >= QUITTER_MAX_POST_BYTES) {
    throw composerError('post_too_large', { app: TORQ_APP_NAME });
  }
}

/** Raw base64 (no data: prefix) for `images[].src`, as Quitter/Torq store it. */
export async function encodeImageForPost(
  prepared: File | Blob,
  index: number
): Promise<string> {
  if (!prepared || prepared.size < 32) {
    throw composerError('image_invalid', {
      index: index + 1,
      size: prepared?.size || 0,
    });
  }
  // Posts are public and permanent: refuse an image whose location/camera
  // metadata could not be removed (HEIC, which could not be re-encoded)
  // rather than publish it with that metadata.
  const clean = await ensureImageMetadataFree(prepared);
  if (clean.ok === false) {
    throw composerError('image_metadata_unremovable', { index: index + 1 });
  }
  const base64 = await fileToRawBase64(clean.file).catch(() => '');
  if (!base64) {
    throw composerError('image_encode_failed', { index: index + 1 });
  }
  return base64;
}
