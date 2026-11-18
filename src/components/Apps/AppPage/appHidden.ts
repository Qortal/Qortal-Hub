/**
 * A Q-App or website can't be deleted: every publish stays on Qortal's
 * blockchain and QDN. Its publisher can hide it from Hub's library instead,
 * with one small record under the app's own name, which only that name can
 * publish:
 *
 *   JSON/<app name>/qhub_app_hidden_v1_<SERVICE>
 *   {"v":1,"app":{"service":"APP","name":"Q-Blog"},"hidden":true,
 *    "replaced":false,"updated":1763150000000}
 *
 * The record's QDN title is "hidden" while the app is hidden and "shown" once
 * it is shown again, so the library reads every app's state from one search,
 * without downloading the records. `replaced` says the publisher also put a
 * small page in the app's place (removedAppPage.ts).
 */
import {
  APP_HIDDEN_IDENTIFIER_PREFIX,
  normalizeAppService,
} from './appPageIds';

export const HIDDEN_TITLE = 'hidden';
export const SHOWN_TITLE = 'shown';

export interface AppHiddenState {
  hidden: boolean;
  /** The publisher also put a small page in the app's place. */
  replaced: boolean;
  /** When the publisher hid or showed it (ms). */
  updated: number;
}

/** The apps their publishers hid, and the names the user publishes under. */
export interface HiddenApps {
  hidden: Set<string>;
  ownNames: string[];
}

const APP_SERVICES = new Set(['APP', 'WEBSITE']);

/** An app as the hidden list keys it: its service and name, in any case. */
export const appKey = (
  service: string | undefined,
  name: string | undefined
): string =>
  `${normalizeAppService(service)}/${String(name || '').toLowerCase()}`;

/** The search for every app's hidden-from-the-library record. */
export const hiddenAppsSearchPath = (): string =>
  `/arbitrary/resources/search?service=JSON` +
  `&identifier=${APP_HIDDEN_IDENTIFIER_PREFIX}&prefix=true` +
  // mode=ALL: by default Core keeps only one JSON resource per name.
  `&mode=ALL&limit=0&includemetadata=true`;

/** The service a hidden-from-the-library record is about, from its id. */
export const hiddenRecordService = (identifier: unknown): string | null => {
  if (
    typeof identifier !== 'string' ||
    !identifier.startsWith(APP_HIDDEN_IDENTIFIER_PREFIX)
  ) {
    return null;
  }
  const service = identifier.slice(APP_HIDDEN_IDENTIFIER_PREFIX.length);
  return APP_SERVICES.has(service) ? service : null;
};

/** The apps their publishers hid, by appKey, from the records' search. */
export const parseHiddenApps = (list: unknown): Set<string> => {
  const hidden = new Set<string>();
  if (!Array.isArray(list)) return hidden;
  list.forEach((item) => {
    if (!item || item.service !== 'JSON' || typeof item.name !== 'string') {
      return;
    }
    const service = hiddenRecordService(item.identifier);
    if (!service || item.metadata?.title !== HIDDEN_TITLE) return;
    hidden.add(appKey(service, item.name));
  });
  return hidden;
};

/**
 * The library without the apps their publishers hid. Apps under the user's
 * own names stay, so their publisher can still find them.
 */
export const withoutHiddenApps = <
  T extends { service?: string; name?: string },
>(
  apps: T[],
  hidden: Set<string>,
  ownNames: string[] = []
): T[] => {
  if (!Array.isArray(apps) || hidden.size === 0) return apps;
  const own = new Set(ownNames.map((name) => name.toLowerCase()));
  return apps.filter(
    (app) =>
      !hidden.has(appKey(app?.service, app?.name)) ||
      own.has(String(app?.name || '').toLowerCase())
  );
};

export const serializeHiddenState = (
  app: { service: string; name: string },
  state: AppHiddenState
): string =>
  JSON.stringify({
    v: 1,
    app: { service: normalizeAppService(app.service), name: app.name },
    hidden: state.hidden,
    replaced: state.replaced,
    updated: state.updated,
  });

export const parseHiddenState = (raw: unknown): AppHiddenState | null => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || typeof record.hidden !== 'boolean') return null;
  const updated = Number(record.updated);
  return {
    hidden: record.hidden,
    replaced: record.replaced === true,
    updated: Number.isFinite(updated) && updated > 0 ? updated : 0,
  };
};
