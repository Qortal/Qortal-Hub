import {
  getPinnedAppKey,
  removeBrokenPinnedApps,
  type PinnedApp,
} from '../../../utils/pinnedAppsSettings';

export type LauncherPin = {
  /** Stable key: the drag-and-drop id and the React key. */
  key: string;
  /** The pin, with the node's details (title, status) when the library has it. */
  app: PinnedApp;
  /** The account's own app or website: always shown, cannot be unpinned. */
  isMine: boolean;
};

const publicKey = (app: PinnedApp | null | undefined) =>
  `${app?.service}-${app?.name}`;

/**
 * The tiles of the Pinned section, in order: the saved pins, with the
 * account's own website and app added in front when they are not pinned yet.
 * Entries that cannot be opened are left out.
 */
export function buildLauncherPins(
  pinnedApps: PinnedApp[] | null | undefined,
  availableQapps: PinnedApp[] | null | undefined,
  myApp?: PinnedApp | null,
  myWebsite?: PinnedApp | null
): LauncherPin[] {
  const libraryApps = new Map<string, PinnedApp>();
  for (const app of availableQapps ?? []) {
    if (app?.name && app?.service) libraryApps.set(publicKey(app), app);
  }

  const mine = new Set<string>();
  const pins: PinnedApp[] = [...removeBrokenPinnedApps(pinnedApps)];
  // The app ends up first and the website second, as on the old dashboard.
  for (const own of [myWebsite, myApp]) {
    if (!own?.name || !own?.service) continue;
    const key = publicKey(own);
    mine.add(key);
    const isPinned = pins.some(
      (pin) => !pin.isPrivate && publicKey(pin) === key
    );
    if (!isPinned) pins.unshift({ name: own.name, service: own.service });
  }

  const seen = new Set<string>();
  const result: LauncherPin[] = [];
  for (const pin of pins) {
    const key = getPinnedAppKey(pin);
    if (seen.has(key)) continue;
    seen.add(key);
    if (pin.isPrivate) {
      result.push({ key, app: pin, isMine: false });
      continue;
    }
    const libraryApp = libraryApps.get(publicKey(pin));
    result.push({
      key,
      app: libraryApp ? { ...libraryApp, ...pin } : pin,
      isMine: mine.has(publicKey(pin)),
    });
  }
  return result;
}

/**
 * What is kept for a pin: enough to find the app again. A public app is its
 * service and name; a private app keeps what it needs to be decrypted.
 */
export function toStoredPin(app: PinnedApp): PinnedApp {
  if (app?.isPrivate) {
    return {
      isPrivate: true,
      isPreview: app.isPreview ?? true,
      privateAppProperties: app.privateAppProperties,
    };
  }
  return { name: app?.name, service: app?.service };
}

/** The name shown under a pinned tile. */
export function launcherPinLabel(app: PinnedApp, privateFallback: string) {
  if (app?.isPrivate) {
    return app.privateAppProperties?.appName || privateFallback;
  }
  const metadata = app?.metadata as { title?: string } | undefined;
  return metadata?.title || app?.name || '';
}
