type PrivateAppProperties = {
  name?: string;
  service?: string;
  identifier?: string;
  groupId?: number | string;
  appName?: string;
  logo?: string | null;
};

export type PinnedApp = {
  name?: string;
  service?: string;
  isPrivate?: boolean;
  isPreview?: boolean;
  privateAppProperties?: PrivateAppProperties;
  [key: string]: unknown;
};

/**
 * A pinned entry that can be neither rendered nor opened. Older versions saved
 * private apps to QDN as `{}`; those entries carry no information to recover.
 */
export const isBrokenPinnedApp = (app: PinnedApp | null | undefined) => {
  if (!app) return true;
  if (app.isPrivate) {
    const properties = app.privateAppProperties;
    return !properties?.name || !properties?.service || !properties?.identifier;
  }
  return !app.name || !app.service;
};

export const removeBrokenPinnedApps = <T extends PinnedApp>(
  apps: T[] | null | undefined
): T[] => (apps ?? []).filter((app) => !isBrokenPinnedApp(app));

/** Stable per-app key; private apps have no top-level name or service. */
export const getPinnedAppKey = (app: PinnedApp) => {
  if (app?.isPrivate) {
    const properties = app.privateAppProperties;
    return `private-${properties?.service}-${properties?.name}-${properties?.identifier}`;
  }
  return `${app?.service}-${app?.name}`;
};

/**
 * This device's pins with those found in the saved settings, so that a pin
 * made on another device is not removed by saving a change made here. This
 * device's order comes first; a pin only the saved list has goes at the end.
 */
export const mergePinnedApps = <T extends PinnedApp>(
  apps: T[] | null | undefined,
  saved: T[] | null | undefined
): T[] => {
  const merged = removeBrokenPinnedApps(apps);
  const keys = new Set(merged.map(getPinnedAppKey));
  for (const app of removeBrokenPinnedApps(saved)) {
    const key = getPinnedAppKey(app);
    if (keys.has(key)) continue;
    keys.add(key);
    merged.push(app);
  }
  return merged;
};

/**
 * Shape a pinned app takes in the QDN settings publish. Private apps keep what
 * is needed to reopen them; the logo is left out to keep the publish small and
 * comes back the next time the app is opened.
 */
export const serializePinnedAppForQdn = (app: PinnedApp): PinnedApp => {
  if (app.isPrivate) {
    const properties = app.privateAppProperties;
    return {
      isPrivate: true,
      isPreview: app.isPreview ?? true,
      privateAppProperties: {
        name: properties?.name,
        service: properties?.service,
        identifier: properties?.identifier,
        groupId: properties?.groupId,
        appName: properties?.appName,
      },
    };
  }
  return { name: app.name, service: app.service };
};

export const serializePinnedAppsForQdn = (
  apps: PinnedApp[] | null | undefined
): PinnedApp[] => removeBrokenPinnedApps(apps).map(serializePinnedAppForQdn);
