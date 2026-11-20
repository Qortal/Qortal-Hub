import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import { normalizeBookmarkPath } from '../AppBookmarks/bookmarkStorage';
import { resourceIdentifierKey } from '../resourceIdentifier';

/**
 * The keys that tell saved apps apart across devices.
 *
 * - A pinned app: `SERVICE|name|identifier`.
 * - A bookmark: `SERVICE|name|identifier|path`.
 *
 * The service is in upper case and the name trimmed and in lower case, since
 * Qortal names don't differ by case. The identifier is kept as it is, except
 * that a missing one, '', 'null' and 'default' all mean the name's default
 * resource. A bookmark's path loses its leading and trailing '/', its query
 * and its fragment. In each part '%' is written '%25' and '|' '%7C', so no
 * part can run into the next.
 */
const part = (value: string) =>
  value.replace(/%/g, '%25').replace(/\|/g, '%7C');

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export const resourceKey = (
  service: unknown,
  name: unknown,
  identifier?: unknown
): string =>
  [
    text(service).trim().toUpperCase(),
    text(name).trim().toLowerCase(),
    resourceIdentifierKey(identifier),
  ]
    .map(part)
    .join('|');

/** The key of a pinned app; a private app is its encrypted resource. */
export const pinKeyOf = (app: PinnedApp): string => {
  if (app?.isPrivate) {
    const properties = app.privateAppProperties;
    return resourceKey(
      properties?.service,
      properties?.name,
      properties?.identifier
    );
  }
  return resourceKey(app?.service, app?.name);
};

/** The key of a bookmark: the page it opens. */
export const bookmarkKeyOf = (bookmark: {
  service?: unknown;
  appName?: unknown;
  identifier?: unknown;
  path?: unknown;
}): string =>
  `${resourceKey(bookmark?.service, bookmark?.appName, bookmark?.identifier)}|${part(
    normalizeBookmarkPath(text(bookmark?.path))
  )}`;
