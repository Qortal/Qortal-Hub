import { sha256 } from '@noble/hashes/sha256';

/**
 * QDN identifiers for an app's page. Everything lives in its own small
 * resource, so the publisher can change a part without uploading the app
 * again, and anyone's review is a resource of their own name.
 *
 * - `JSON/<app name>/qhub_app_page_v1_<SERVICE>`: About, What's new, version
 *   and links (see appPageData.ts).
 * - `IMAGE/<app name>/qhub_app_shots_v1_<SERVICE>`: the screenshots, several
 *   files in one resource with a `shots.json` list.
 * - `JSON/<app name>/qhub_app_hidden_v1_<SERVICE>`: whether its publisher hid
 *   it from the library (appHidden.ts).
 * - `COMMENT/<reviewer>/qhub_review_v1_<SERVICE>_<key>`: one review per name
 *   and app; publishing it again replaces it.
 * - `COMMENT/<author>/qhub_reply_v1_<SERVICE>_<key>_<random>`: a reply.
 *
 * `<key>` is the first 16 hex digits of SHA-256(`<SERVICE>:<lowercase name>`),
 * so an identifier never holds a name's spaces or symbols and stays far below
 * QDN's 64 characters. Reviews and replies have prefixes of their own, so a
 * prefix search for the reviews finds only reviews, and many replies can't
 * push them off a page.
 *
 * A widget is an APP under an identifier of its own (`go-widget-now`): its
 * key hashes `<SERVICE>:<lowercase name>` + a line break + the identifier as
 * published. A name can't hold a line break (Core turns any whitespace into
 * one space), so no app's key is ever a widget's. A widget published as the
 * name's default APP is that app, and shares its reviews.
 */

export const APP_PAGE_IDENTIFIER_PREFIX = 'qhub_app_';
export const REVIEW_IDENTIFIER_PREFIX = 'qhub_review_v1_';
export const REPLY_IDENTIFIER_PREFIX = 'qhub_reply_v1_';

export type AppServiceName = 'APP' | 'WEBSITE';

export const normalizeAppService = (service: string | undefined): string =>
  String(service || 'APP').toUpperCase();

/**
 * A resource's identifier, or null for the name's default one (no
 * identifier, '' or 'default'): an app is its name's default resource.
 */
export const normalizeAppIdentifier = (identifier: unknown): string | null =>
  typeof identifier === 'string' &&
  identifier.trim() !== '' &&
  identifier !== 'default'
    ? identifier
    : null;

export const appPageIdentifier = (service: string): string =>
  `${APP_PAGE_IDENTIFIER_PREFIX}page_v1_${normalizeAppService(service)}`;

export const appShotsIdentifier = (service: string): string =>
  `${APP_PAGE_IDENTIFIER_PREFIX}shots_v1_${normalizeAppService(service)}`;

export const APP_HIDDEN_IDENTIFIER_PREFIX = `${APP_PAGE_IDENTIFIER_PREFIX}hidden_v1_`;

export const appHiddenIdentifier = (service: string): string =>
  `${APP_HIDDEN_IDENTIFIER_PREFIX}${normalizeAppService(service)}`;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The app's (or widget's) part of every review identifier. */
export const appReviewKey = (
  service: string,
  name: string,
  identifier?: string | null
): string => {
  const normalizedService = normalizeAppService(service);
  const ownIdentifier = normalizeAppIdentifier(identifier);
  const source = new TextEncoder().encode(
    `${normalizedService}:${String(name || '')
      .trim()
      .toLowerCase()}${ownIdentifier ? `\n${ownIdentifier}` : ''}`
  );
  const digest = sha256(source);
  return `${REVIEW_IDENTIFIER_PREFIX}${normalizedService}_${toHex(digest).slice(0, 16)}`;
};

const randomSuffix = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
};

/** What every reply to the app's reviews starts with. */
export const replyPrefixOf = (reviewKey: string): string =>
  `${REPLY_IDENTIFIER_PREFIX}${reviewKey.slice(REVIEW_IDENTIFIER_PREFIX.length)}_`;

/** A new reply's identifier, from the app's review key. */
export const replyIdentifier = (reviewKey: string, suffix = randomSuffix()) =>
  `${replyPrefixOf(reviewKey)}${suffix}`;

export type ReviewIdentifierKind = 'review' | 'reply' | null;

/** Whether `identifier` is this app's review, one of its replies, or neither. */
export const reviewIdentifierKind = (
  identifier: string,
  reviewKey: string
): ReviewIdentifierKind => {
  if (identifier === reviewKey) return 'review';
  const replyPrefix = replyPrefixOf(reviewKey);
  if (
    identifier.startsWith(replyPrefix) &&
    identifier.length > replyPrefix.length
  ) {
    return 'reply';
  }
  return null;
};
