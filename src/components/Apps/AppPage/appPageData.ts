import { utf8ByteLength } from '../../../utils/qdnMetadataLimits';
import { normalizeAppService } from './appPageIds';

/** The parts of an app's page that live outside the app's own QDN metadata. */

export const APP_PAGE_LIMITS = {
  about: 4000,
  whatsNew: 1500,
  version: 32,
  link: 300,
};

/** Core keeps a JSON resource to 25 KiB. */
export const APP_PAGE_MAX_BYTES = 25 * 1024;

export const SHOT_LIMITS = {
  count: 5,
  caption: 80,
  /** Longest side of a stored screenshot, in pixels. */
  maxSide: 1600,
};

export const SHOTS_MANIFEST_FILE = 'shots.json';

export const APP_LINK_KINDS = ['website', 'source', 'support'] as const;
export type AppLinkKind = (typeof APP_LINK_KINDS)[number];
export type AppPageLinks = Partial<Record<AppLinkKind, string>>;

export interface AppPageData {
  about: string;
  whatsNew: string;
  version: string;
  links: AppPageLinks;
  /**
   * The app's QDN signature that the version and What's new describe. When
   * the app is published again without them, the page can say they're older.
   */
  appSignature: string;
  /** When the publisher last saved the page (ms). */
  updated: number;
}

export interface ShotEntry {
  file: string;
  caption: string;
  width?: number;
  height?: number;
}

export interface ShotsManifest {
  shots: ShotEntry[];
  updated: number;
}

export const EMPTY_APP_PAGE: AppPageData = {
  about: '',
  whatsNew: '',
  version: '',
  links: {},
  appSignature: '',
  updated: 0,
};

const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;

const asText = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

const asTime = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * A link the page may show: http(s) or qortal://, without spaces or control
 * characters. Anything else (javascript:, data:, file:) is refused.
 */
export const normalizeAppLink = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > APP_PAGE_LIMITS.link) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (/^qortal:\/\/\S+/i.test(trimmed)) {
    return `qortal://${trimmed.slice('qortal://'.length)}`;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const parseLinks = (value: unknown): AppPageLinks => {
  const links: AppPageLinks = {};
  if (!value || typeof value !== 'object') return links;
  APP_LINK_KINDS.forEach((kind) => {
    const link = normalizeAppLink((value as Record<string, unknown>)[kind]);
    if (link) links[kind] = link;
  });
  return links;
};

/** The page from a published JSON resource, or null if it isn't one. */
export const parseAppPage = (raw: unknown): AppPageData | null => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  return {
    about: asText(record.about, APP_PAGE_LIMITS.about),
    whatsNew: asText(record.whatsNew, APP_PAGE_LIMITS.whatsNew),
    version: asText(record.version, APP_PAGE_LIMITS.version),
    links: parseLinks(record.links),
    appSignature:
      typeof record.appSignature === 'string' &&
      SIGNATURE_PATTERN.test(record.appSignature)
        ? record.appSignature
        : '',
    updated: asTime(record.updated),
  };
};

export const serializeAppPage = (
  page: AppPageData,
  app: { service: string; name: string }
): string => {
  const links: AppPageLinks = {};
  APP_LINK_KINDS.forEach((kind) => {
    const link = normalizeAppLink(page.links?.[kind]);
    if (link) links[kind] = link;
  });
  return JSON.stringify({
    v: 1,
    app: { service: normalizeAppService(app.service), name: app.name },
    about: page.about.trim().slice(0, APP_PAGE_LIMITS.about),
    whatsNew: page.whatsNew.trim().slice(0, APP_PAGE_LIMITS.whatsNew),
    version: page.version.trim().slice(0, APP_PAGE_LIMITS.version),
    links,
    ...(SIGNATURE_PATTERN.test(page.appSignature || '')
      ? { appSignature: page.appSignature }
      : {}),
    updated: page.updated,
  });
};

/**
 * Whether the version and What's new were written for the app as it is now.
 * Unknown signatures count as current.
 */
export const isVersionCurrent = (
  page: AppPageData | null,
  appSignature: string | undefined
): boolean =>
  !page?.appSignature || !appSignature || page.appSignature === appSignature;

/** The next version after `version`: its last number plus one. */
export const suggestNextVersion = (version: string): string => {
  const trimmed = (version || '').trim();
  const match = trimmed.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return trimmed;
  const [, head, digits, tail] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${head}${next}${tail}`.slice(0, APP_PAGE_LIMITS.version);
};

export const appPageFitsQdn = (json: string): boolean =>
  utf8ByteLength(json) <= APP_PAGE_MAX_BYTES;

export const isAppPageEmpty = (page: AppPageData | null): boolean =>
  !page ||
  (!page.about.trim() &&
    !page.whatsNew.trim() &&
    !page.version.trim() &&
    APP_LINK_KINDS.every((kind) => !page.links?.[kind]));

export const sameAppPage = (
  a: AppPageData | null,
  b: AppPageData | null
): boolean => {
  const left = a || EMPTY_APP_PAGE;
  const right = b || EMPTY_APP_PAGE;
  return (
    (left.appSignature || '') === (right.appSignature || '') &&
    left.about.trim() === right.about.trim() &&
    left.whatsNew.trim() === right.whatsNew.trim() &&
    left.version.trim() === right.version.trim() &&
    APP_LINK_KINDS.every(
      (kind) =>
        (normalizeAppLink(left.links?.[kind]) || '') ===
        (normalizeAppLink(right.links?.[kind]) || '')
    )
  );
};

const SHOT_FILE_PATTERN = /^[1-9][0-9]?\.(webp|png|jpe?g)$/i;

/** The screenshot list from a resource's `shots.json`, or null. */
export const parseShotsManifest = (raw: unknown): ShotsManifest | null => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || !Array.isArray(record.shots)) return null;
  const seen = new Set<string>();
  const shots: ShotEntry[] = [];
  record.shots.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    if (typeof item.file !== 'string' || !SHOT_FILE_PATTERN.test(item.file))
      return;
    if (seen.has(item.file) || shots.length >= SHOT_LIMITS.count) return;
    seen.add(item.file);
    const width = asTime(item.width);
    const height = asTime(item.height);
    shots.push({
      file: item.file,
      caption: asText(item.caption, SHOT_LIMITS.caption),
      ...(width && height ? { width, height } : {}),
    });
  });
  return { shots, updated: asTime(record.updated) };
};

export const serializeShotsManifest = (
  shots: ShotEntry[],
  app: { service: string; name: string },
  updated: number
): string =>
  JSON.stringify({
    v: 1,
    app: { service: normalizeAppService(app.service), name: app.name },
    shots: shots.slice(0, SHOT_LIMITS.count).map((shot) => ({
      file: shot.file,
      caption: shot.caption.trim().slice(0, SHOT_LIMITS.caption),
      ...(shot.width && shot.height
        ? { width: shot.width, height: shot.height }
        : {}),
    })),
    updated,
  });
