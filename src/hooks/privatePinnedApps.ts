type PrivateAppProperties = {
  name?: string;
  service?: string;
  identifier?: string;
};

type PinnedApp = {
  isPrivate?: boolean;
  isPreview?: boolean;
  privateAppProperties?: PrivateAppProperties;
};

/** Same identity rule the pinned-app context menu uses to unpin. */
export const isSamePrivateApp = (
  a: PrivateAppProperties | null | undefined,
  b: PrivateAppProperties | null | undefined
) =>
  !!a &&
  !!b &&
  a.name === b.name &&
  a.service === b.service &&
  a.identifier === b.identifier;

/**
 * Pins a private app, or refreshes it in place when it is already pinned, so
 * re-accessing an app never adds a duplicate and keeps its dashboard position.
 */
export const upsertPrivatePinnedApp = <T>(
  pinnedApps: T[] | null | undefined,
  entry: PinnedApp
): T[] => {
  const apps = pinnedApps ?? [];
  const index = apps.findIndex((app) => {
    const pinned = app as PinnedApp;
    return (
      pinned?.isPrivate &&
      isSamePrivateApp(pinned.privateAppProperties, entry.privateAppProperties)
    );
  });
  if (index === -1) return [...apps, entry as T];
  return apps.map((app, i) => (i === index ? (entry as T) : app));
};
