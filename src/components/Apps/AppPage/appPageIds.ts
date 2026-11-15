/**
 * QDN identifiers for an app's page. Everything lives in its own small
 * resource, so the publisher can change a part without uploading the app
 * again.
 *
 * - `JSON/<app name>/qhub_app_page_v1_<SERVICE>`: About, What's new, version
 *   and links (see appPageData.ts).
 * - `IMAGE/<app name>/qhub_app_shots_v1_<SERVICE>`: the screenshots, several
 *   files in one resource with a `shots.json` list.
 * - `JSON/<app name>/qhub_app_hidden_v1_<SERVICE>`: whether its publisher hid
 *   it from the library (appHidden.ts).
 */

export const APP_PAGE_IDENTIFIER_PREFIX = 'qhub_app_';

export type AppServiceName = 'APP' | 'WEBSITE';

export const normalizeAppService = (service: string | undefined): string =>
  String(service || 'APP').toUpperCase();

export const appPageIdentifier = (service: string): string =>
  `${APP_PAGE_IDENTIFIER_PREFIX}page_v1_${normalizeAppService(service)}`;

export const appShotsIdentifier = (service: string): string =>
  `${APP_PAGE_IDENTIFIER_PREFIX}shots_v1_${normalizeAppService(service)}`;

export const APP_HIDDEN_IDENTIFIER_PREFIX = `${APP_PAGE_IDENTIFIER_PREFIX}hidden_v1_`;

export const appHiddenIdentifier = (service: string): string =>
  `${APP_HIDDEN_IDENTIFIER_PREFIX}${normalizeAppService(service)}`;
