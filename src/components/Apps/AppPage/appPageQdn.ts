import {
  APP_PAGE_IDENTIFIER_PREFIX,
  appHiddenIdentifier,
  appPageIdentifier,
  appShotsIdentifier,
  normalizeAppService,
} from './appPageIds';
import {
  AppHiddenState,
  HIDDEN_TITLE,
  hiddenAppsSearchPath,
  parseHiddenApps,
  parseHiddenState,
  serializeHiddenState,
  SHOWN_TITLE,
} from './appHidden';
import { REMOVED_PAGE_FILE } from './removedAppPage';
import {
  AppPageData,
  appPageFitsQdn,
  parseAppPage,
  parseShotsManifest,
  serializeAppPage,
  serializeShotsManifest,
  ShotEntry,
  ShotsManifest,
  SHOTS_MANIFEST_FILE,
} from './appPageData';
import { createZip, ZipEntry } from './zipStore';
import { blobBytes, bytesToBase64 } from './blobBytes';

export interface AppRef {
  service: string;
  name: string;
  /**
   * A widget's own identifier (an APP under `go-widget-…`): its reviews and
   * rating are its own. Absent for an app, the name's default resource.
   */
  identifier?: string | null;
}

export interface PageResource {
  identifier: string;
  signature: string;
  updated: number;
}

export interface AppPageResources {
  page: PageResource | null;
  shots: PageResource | null;
  /** Its hidden-from-the-library record (appHidden.ts), if it has one. */
  hidden: (PageResource & { isHidden: boolean }) | null;
}

export class AppPageError extends Error {
  code: string;
  constructor(code: string, message = code) {
    super(message);
    this.code = code;
  }
}

const enc = encodeURIComponent;

const sameName = (a: unknown, b: string) =>
  typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

const asResource = (item: any): PageResource => ({
  identifier: String(item.identifier),
  signature: String(item.latestSignature || ''),
  updated: Number(item.updated || item.created || 0),
});

/** Which of the app's page resources exist on QDN. */
export const findAppPageResources = async (
  base: string,
  app: AppRef,
  signal?: AbortSignal
): Promise<AppPageResources> => {
  // mode=ALL: by default Core keeps only one resource per name and service,
  // so a newer JSON or IMAGE of the same name would hide the page's.
  const url =
    `${base}/arbitrary/resources/search?name=${enc(app.name)}` +
    `&exactmatchnames=true&identifier=${enc(APP_PAGE_IDENTIFIER_PREFIX)}` +
    `&prefix=true&mode=ALL&limit=20&includemetadata=true`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new AppPageError('SEARCH_FAILED');
  const list = await response.json();
  const result: AppPageResources = { page: null, shots: null, hidden: null };
  if (!Array.isArray(list)) return result;
  const pageId = appPageIdentifier(app.service);
  const shotsId = appShotsIdentifier(app.service);
  const hiddenId = appHiddenIdentifier(app.service);
  list.forEach((item) => {
    if (!item || !sameName(item.name, app.name)) return;
    if (item.service === 'JSON' && item.identifier === pageId) {
      result.page = asResource(item);
    } else if (item.service === 'IMAGE' && item.identifier === shotsId) {
      result.shots = asResource(item);
    } else if (item.service === 'JSON' && item.identifier === hiddenId) {
      result.hidden = {
        ...asResource(item),
        isHidden: item.metadata?.title === HIDDEN_TITLE,
      };
    }
  });
  return result;
};

const TERMINAL_STATUSES = new Set([
  'NOT_PUBLISHED',
  'UNSUPPORTED',
  'BLOCKED',
  'BUILD_FAILED',
]);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });

/**
 * Asks the node to fetch and build a resource, then waits until it's READY.
 * False when it can't be had (not published, blocked) or it takes too long.
 */
export const waitForResource = async (
  base: string,
  service: string,
  name: string,
  identifier: string,
  {
    signal,
    tries = 40,
    interval = 1500,
  }: { signal?: AbortSignal; tries?: number; interval?: number } = {}
): Promise<boolean> => {
  const url = `${base}/arbitrary/resource/status/${service}/${enc(name)}/${enc(identifier)}?build=true`;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) {
        const status = await response.json();
        if (status?.status === 'READY') return true;
        if (TERMINAL_STATUSES.has(status?.status)) return false;
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
    }
    await sleep(interval, signal);
  }
  return false;
};

export const fetchAppPage = async (
  base: string,
  app: AppRef,
  signal?: AbortSignal
): Promise<AppPageData | null> => {
  const identifier = appPageIdentifier(app.service);
  const ready = await waitForResource(base, 'JSON', app.name, identifier, {
    signal,
  });
  if (!ready) return null;
  const response = await fetch(
    `${base}/arbitrary/JSON/${enc(app.name)}/${enc(identifier)}`,
    { signal }
  );
  if (!response.ok) return null;
  return parseAppPage(await response.text());
};

export const fetchShotsManifest = async (
  base: string,
  app: AppRef,
  signal?: AbortSignal
): Promise<ShotsManifest | null> => {
  const identifier = appShotsIdentifier(app.service);
  const ready = await waitForResource(base, 'IMAGE', app.name, identifier, {
    signal,
  });
  if (!ready) return null;
  const root = `${base}/arbitrary/IMAGE/${enc(app.name)}/${enc(identifier)}`;
  const withPath = await fetch(`${root}?filepath=${enc(SHOTS_MANIFEST_FILE)}`, {
    signal,
  });
  if (withPath.ok) {
    const manifest = parseShotsManifest(await withPath.text());
    if (manifest) return manifest;
  }
  // A resource that holds only the list (no screenshots left) is one file.
  const single = await fetch(root, { signal });
  if (!single.ok) return null;
  return parseShotsManifest(await single.text());
};

/** The publisher's hidden-from-the-library record, as published. */
export const fetchHiddenState = async (
  base: string,
  app: AppRef,
  signal?: AbortSignal
): Promise<AppHiddenState | null> => {
  const identifier = appHiddenIdentifier(app.service);
  const ready = await waitForResource(base, 'JSON', app.name, identifier, {
    signal,
  });
  if (!ready) return null;
  const response = await fetch(
    `${base}/arbitrary/JSON/${enc(app.name)}/${enc(identifier)}`,
    { signal }
  );
  if (!response.ok) return null;
  return parseHiddenState(await response.text());
};

/** Every app its publisher hid from the library, by appKey. */
export const fetchHiddenApps = async (
  base: string,
  signal?: AbortSignal
): Promise<Set<string>> => {
  const response = await fetch(`${base}${hiddenAppsSearchPath()}`, { signal });
  if (!response.ok) throw new AppPageError('SEARCH_FAILED');
  return parseHiddenApps(await response.json());
};

export const shotImageUrl = (
  base: string,
  app: AppRef,
  file: string,
  version?: string
): string =>
  `${base}/arbitrary/IMAGE/${enc(app.name)}/${enc(appShotsIdentifier(app.service))}` +
  `?filepath=${enc(file)}${version ? `&v=${enc(version.slice(0, 16))}` : ''}`;

export const appIconUrl = (base: string, name: string, version?: string) =>
  `${base}/arbitrary/THUMBNAIL/${enc(name)}/qortal_avatar?async=true${
    version ? `&v=${enc(version)}` : ''
  }`;

const utf8ToBase64 = (text: string): string =>
  bytesToBase64(new TextEncoder().encode(text));

const blobToBase64 = async (blob: Blob): Promise<string> =>
  bytesToBase64(await blobBytes(blob));

/** Publishes through the background, as the publish form does. */
export const publishOnQdn = (payload: Record<string, unknown>) =>
  new Promise<unknown>((resolve, reject) => {
    window
      .sendMessage('publishOnQDN', payload)
      .then((response: any) => {
        if (response?.error) {
          reject(new AppPageError('PUBLISH_FAILED', String(response.error)));
          return;
        }
        resolve(response);
      })
      .catch((error: any) =>
        reject(
          new AppPageError(
            'PUBLISH_FAILED',
            error?.message || String(error || '')
          )
        )
      );
  });

export const publishAppPage = async (
  app: AppRef,
  page: AppPageData,
  now = Date.now()
) => {
  const json = serializeAppPage({ ...page, updated: now }, app);
  if (!appPageFitsQdn(json)) throw new AppPageError('PAGE_TOO_LARGE');
  await publishOnQdn({
    data: utf8ToBase64(json),
    identifier: appPageIdentifier(app.service),
    name: app.name,
    service: 'JSON',
    uploadType: 'base64',
  });
};

export interface ShotUpload {
  data: Uint8Array;
  caption: string;
  width?: number;
  height?: number;
}

/** The zip that holds the screenshots and their list. */
export const buildShotsZip = (
  app: AppRef,
  shots: ShotUpload[],
  now = Date.now()
): Blob => {
  const entries: ShotEntry[] = shots.map((shot, index) => ({
    file: `${index + 1}.webp`,
    caption: shot.caption,
    width: shot.width,
    height: shot.height,
  }));
  const zipEntries: ZipEntry[] = [
    {
      path: SHOTS_MANIFEST_FILE,
      data: new TextEncoder().encode(serializeShotsManifest(entries, app, now)),
    },
    ...shots.map((shot, index) => ({
      path: entries[index].file,
      data: shot.data,
    })),
  ];
  return createZip(zipEntries, new Date(now));
};

export const publishAppShots = async (
  app: AppRef,
  shots: ShotUpload[],
  now = Date.now()
) => {
  await publishOnQdn({
    data: new File([buildShotsZip(app, shots, now)], 'screenshots.zip', {
      type: 'application/zip',
    }),
    identifier: appShotsIdentifier(app.service),
    name: app.name,
    service: 'IMAGE',
    uploadType: 'zip',
  });
};

/** The app's icon is its name's picture (THUMBNAIL qortal_avatar). */
export const publishAppIcon = async (app: AppRef, image: Blob) => {
  await publishOnQdn({
    data: await blobToBase64(image),
    identifier: 'qortal_avatar',
    name: app.name,
    service: 'THUMBNAIL',
    uploadType: 'base64',
  });
};

/**
 * Hides the app from the library, or shows it again: one small record under
 * the app's name, titled so the library can read it without downloading it.
 */
export const publishHiddenState = async (
  app: AppRef,
  state: { hidden: boolean; replaced: boolean },
  now = Date.now()
) => {
  await publishOnQdn({
    data: utf8ToBase64(serializeHiddenState(app, { ...state, updated: now })),
    identifier: appHiddenIdentifier(app.service),
    name: app.name,
    service: 'JSON',
    title: state.hidden ? HIDDEN_TITLE : SHOWN_TITLE,
    uploadType: 'base64',
  });
};

/**
 * Publishes the small page that says its publisher removed the app
 * (removedAppPage.ts) as the app itself, with the listing given.
 */
export const publishRemovedApp = async (
  app: AppRef,
  html: string,
  listing: { title: string; description: string; category?: string }
) => {
  const zip = new File(
    [
      createZip([
        { path: REMOVED_PAGE_FILE, data: new TextEncoder().encode(html) },
      ]),
    ],
    'app.zip',
    { type: 'application/zip' }
  );
  await publishOnQdn({
    ...(listing.category ? { category: listing.category } : {}),
    data: zip,
    description: listing.description,
    name: app.name,
    service: normalizeAppService(app.service),
    title: listing.title,
    uploadType: 'zip',
  });
};

export interface AppListingDetails {
  title: string;
  description: string;
  category: string;
  tags: string[];
}

export interface FilesProgress {
  done: number;
  total: number;
}

/** Most an app may hold (Core's APP limit); websites may be bigger. */
export const republishLimitBytes = (service: string) =>
  normalizeAppService(service) === 'APP' ? 50 * 1024 * 1024 : 200 * 1024 * 1024;

/**
 * Every file of the published app, read back from the node, so the app can be
 * published again with new details without its folder. Throws instead of
 * returning a partial list.
 */
export const fetchAppFiles = async (
  base: string,
  app: AppRef,
  {
    onProgress,
    signal,
  }: { onProgress?: (progress: FilesProgress) => void; signal?: AbortSignal }
): Promise<ZipEntry[]> => {
  const service = normalizeAppService(app.service);
  const ready = await waitForResource(base, service, app.name, 'default', {
    signal,
    tries: 80,
  });
  if (!ready) throw new AppPageError('APP_NOT_READY');
  const metaResponse = await fetch(
    `${base}/arbitrary/metadata/${service}/${enc(app.name)}/default`,
    { signal }
  );
  if (!metaResponse.ok) throw new AppPageError('FILES_UNKNOWN');
  const metadata = await metaResponse.json();
  const files: string[] = Array.isArray(metadata?.files)
    ? metadata.files.filter(
        (file: unknown) => typeof file === 'string' && file.length > 0
      )
    : [];
  if (files.length === 0) throw new AppPageError('FILES_UNKNOWN');

  const limit = republishLimitBytes(service);
  const entries: ZipEntry[] = new Array(files.length);
  let done = 0;
  let total = 0;
  let next = 0;
  onProgress?.({ done, total: files.length });

  const worker = async () => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      const response = await fetch(
        `${base}/arbitrary/${service}/${enc(app.name)}?filepath=${enc(file)}`,
        { signal }
      );
      if (!response.ok) throw new AppPageError('FILE_MISSING', file);
      const data = new Uint8Array(await response.arrayBuffer());
      total += data.length;
      if (total > limit) throw new AppPageError('APP_TOO_LARGE');
      entries[index] = { path: file, data };
      done += 1;
      onProgress?.({ done, total: files.length });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, files.length) }, () => worker())
  );
  return entries;
};

/** Publishes the app again, with its own files and new listing details. */
export const republishAppDetails = async (
  base: string,
  app: AppRef,
  details: AppListingDetails,
  options: {
    onProgress?: (progress: FilesProgress) => void;
    signal?: AbortSignal;
  } = {}
) => {
  const entries = await fetchAppFiles(base, app, options);
  const zip = new File([createZip(entries)], 'app.zip', {
    type: 'application/zip',
  });
  const tags = details.tags.filter(Boolean).slice(0, 5);
  return publishOnQdn({
    category: details.category,
    data: zip,
    description: details.description,
    name: app.name,
    service: normalizeAppService(app.service),
    tag1: tags[0],
    tag2: tags[1],
    tag3: tags[2],
    tag4: tags[3],
    tag5: tags[4],
    title: details.title,
    uploadType: 'zip',
  });
};
